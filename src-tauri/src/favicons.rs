//! Favicon ingest — the second caller on the `null-event://` channel
//! (`docs/SECURITY.md` requires this note: the first is artifact
//! extraction).
//!
//! The injected observer re-encodes the page's icon through a canvas to
//! a 64px PNG and beacons it here. Everything in the beacon is
//! **page-controlled input that will be rendered inside the privileged
//! shell**, so nothing is trusted: the origin is re-parsed and
//! re-serialized rather than stored as sent, and the icon must be a
//! `data:image/png;base64,` URL whose payload actually decodes and
//! actually begins with the PNG magic bytes, under a hard size cap.
//! A rejected beacon is dropped silently — there is nothing useful to
//! tell a hostile page.
//!
//! The three questions: this **stores** a 64px icon per visited origin
//! in SQLite, **transmits** nothing, and **remembers** which origins
//! were visited (cleared together with history).

use base64::Engine;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Url};

/// Decoded-size cap. Our own capture path produces 64×64 PNGs of a few
/// KB; 32 KB leaves headroom without letting a page park a payload.
const MAX_DECODED_BYTES: usize = 32 * 1024;

const PNG_PREFIX: &str = "data:image/png;base64,";
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Validate one beacon and, if it holds, store it and tell the shell.
pub fn ingest(app: &AppHandle, origin: &str, data_url: &str) {
    let Some(origin) = normalized_web_origin(origin) else {
        eprintln!("null-favicon: REJECT bad origin");
        return;
    };
    let Some(payload) = data_url.strip_prefix(PNG_PREFIX) else {
        eprintln!(
            "null-favicon: REJECT not png data url: {}",
            &data_url[..data_url.len().min(40)]
        );
        return;
    };
    // 4/3 expansion plus padding: reject before decoding work.
    if payload.len() > MAX_DECODED_BYTES / 3 * 4 + 4 {
        eprintln!("null-favicon: REJECT too big");
        return;
    }
    let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(payload) else {
        eprintln!("null-favicon: REJECT base64");
        return;
    };
    if decoded.len() > MAX_DECODED_BYTES || !decoded.starts_with(&PNG_MAGIC) {
        eprintln!("null-favicon: REJECT magic/size");
        return;
    }

    let Some(storage) = app.try_state::<crate::storage::Storage>() else {
        eprintln!("null-favicon: REJECT no storage");
        return;
    };
    if let Err(e) = storage.set_favicon(&origin, data_url) {
        eprintln!("null-favicon: REJECT sql {e}");
        return;
    }
    let _ = app.emit_to(
        EventTarget::webview("main"),
        "favicon-set",
        serde_json::json!({ "origin": origin, "data": data_url }),
    );
}

/// Parse and re-serialize so what we store is our own idea of the
/// origin, not the page's string. Only web origins qualify.
fn normalized_web_origin(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    Some(url.origin().ascii_serialization())
}
