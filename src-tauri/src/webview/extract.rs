//! Extraction bridge. Tabs cannot invoke Rust commands directly (the
//! `main` webview is the only one with Tauri IPC access), but they can
//! load a URL via `new Image().src = 'null-event://artifact?…'`. The
//! custom URI scheme handler in `lib.rs` routes those beacons here.
//!
//! The transport is a sequence of GETs, one per chunk of the JSON
//! payload. Each beacon carries `r` (reqId), `i` (chunk index),
//! `n` (total chunks), and `d` (URL-encoded slice of raw JSON). When
//! every chunk has arrived, the registry reconstructs the string,
//! parses it, and wakes the one-shot receiver the orchestrator is
//! awaiting.
//!
//! Why not `fetch`+POST? Sites with strict `connect-src` CSP (Medium,
//! most news, most docs) silently block `fetch` to a custom scheme.
//! `img-src` is almost always broader, so the Image path actually
//! works across the long tail.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::oneshot;

use super::run_extract;

/// What to pull out of the tab: the readable article, or whatever the
/// user has selected.
#[derive(Clone, Copy)]
pub enum ExtractKind {
    Article,
    Selection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractPayload {
    pub req_id: String,
    pub title: String,
    pub url: String,
    pub markdown: String,
}

/// Shape of the JSON the injected script chunk-encodes. `reqId` lives
/// in the beacon query string, not the JSON body, so it isn't here.
#[derive(Deserialize)]
struct InnerPayload {
    title: String,
    url: String,
    markdown: String,
}

/// Upper bounds on what a page may feed the reassembly buffer while an
/// extraction is in flight. The injected script chunks at 1500 chars,
/// so a real article tops out at a few hundred chunks; anything past
/// these caps is a page trying to exhaust memory, not an article.
const MAX_CHUNKS: u32 = 8192;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

struct ChunkBuffer {
    total: u32,
    parts: HashMap<u32, String>,
    bytes: usize,
}

#[derive(Default)]
struct Pending {
    senders: HashMap<String, oneshot::Sender<ExtractPayload>>,
    chunks: HashMap<String, ChunkBuffer>,
}

#[derive(Default)]
pub struct ExtractRegistry {
    pending: Mutex<Pending>,
}

impl ExtractRegistry {
    /// Register a reqId and return the receiver the orchestrator awaits.
    pub fn register(&self, req_id: String) -> oneshot::Receiver<ExtractPayload> {
        let (tx, rx) = oneshot::channel();
        let mut p = self.pending.lock().expect("extract registry poisoned");
        p.senders.insert(req_id, tx);
        rx
    }

    /// Drop both the sender and any partial chunks for this reqId.
    /// Called on timeout / cleanup.
    pub fn take(&self, req_id: &str) {
        let mut p = self.pending.lock().expect("extract registry poisoned");
        p.senders.remove(req_id);
        p.chunks.remove(req_id);
    }

    /// Ingest a single chunk. If this completes the payload, the
    /// matching sender is fulfilled and its state is cleared.
    ///
    /// The reqId is authoritative: we only accept chunks for a reqId
    /// we're actively awaiting. That keeps unrelated page JS from
    /// spamming the registry.
    pub fn ingest_chunk(&self, req_id: &str, index: u32, total: u32, data: &str) {
        if total == 0 || total > MAX_CHUNKS || index >= total {
            return;
        }
        let complete = {
            let mut p = self.pending.lock().expect("extract registry poisoned");
            if !p.senders.contains_key(req_id) {
                return;
            }
            let entry = p
                .chunks
                .entry(req_id.to_string())
                .or_insert_with(|| ChunkBuffer {
                    total,
                    parts: HashMap::new(),
                    bytes: 0,
                });
            if entry.total != total {
                *entry = ChunkBuffer {
                    total,
                    parts: HashMap::new(),
                    bytes: 0,
                };
            }
            if entry.bytes + data.len() > MAX_TOTAL_BYTES {
                return;
            }
            if let Some(old) = entry.parts.insert(index, data.to_string()) {
                entry.bytes -= old.len();
            }
            entry.bytes += data.len();
            entry.parts.len() as u32 == entry.total
        };
        if complete {
            self.try_finish(req_id);
        }
    }

    fn try_finish(&self, req_id: &str) {
        let (sender, joined) = {
            let mut p = self.pending.lock().expect("extract registry poisoned");
            let Some(buf) = p.chunks.remove(req_id) else {
                return;
            };
            let mut joined = String::new();
            for i in 0..buf.total {
                let Some(part) = buf.parts.get(&i) else {
                    return;
                };
                joined.push_str(part);
            }
            let Some(sender) = p.senders.remove(req_id) else {
                return;
            };
            (sender, joined)
        };
        let Ok(inner) = serde_json::from_str::<InnerPayload>(&joined) else {
            return;
        };
        let _ = sender.send(ExtractPayload {
            req_id: req_id.to_string(),
            title: inner.title,
            url: inner.url,
            markdown: inner.markdown,
        });
    }
}

const EXTRACT_TIMEOUT: Duration = Duration::from_secs(10);

/// Orchestrate a single extraction against a tab. Registers a reqId,
/// fires the injection, awaits the chunk-assembled payload, and
/// surfaces the failure modes every caller cares about.
///
/// Callers in `commands/` translate the `Err(msg)` into whatever
/// event shape their stream uses; this helper stays neutral.
pub async fn extract_tab(
    app: &AppHandle,
    registry: &ExtractRegistry,
    tab_id: &str,
    kind: ExtractKind,
) -> Result<ExtractPayload, String> {
    let req_id = uuid::Uuid::new_v4().to_string();
    let rx = registry.register(req_id.clone());

    if let Err(e) = run_extract(app, tab_id, &req_id, kind) {
        registry.take(&req_id);
        return Err(e);
    }

    let payload = match tokio::time::timeout(EXTRACT_TIMEOUT, rx).await {
        Ok(Ok(p)) => p,
        Ok(Err(_)) | Err(_) => {
            registry.take(&req_id);
            return Err(match kind {
                ExtractKind::Article => {
                    "couldn't read this page (strict CSP, or not an article)".to_string()
                }
                ExtractKind::Selection => {
                    "couldn't read the selection (strict CSP on this site?)".to_string()
                }
            });
        }
    };

    if payload.markdown.starts_with("[extraction failed:") {
        return Err(payload.markdown);
    }

    Ok(payload)
}
