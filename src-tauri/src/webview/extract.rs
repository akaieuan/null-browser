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
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Url};
use tokio::sync::oneshot;

use super::run_extract;

/// Drop query string and fragment from a URL before including it in
/// an AI prompt. URLs routinely carry session tokens, auth params,
/// and tracking ids in their query strings; stripping them keeps
/// that content out of the outbound payload without forcing users
/// to think about it. The saved artifact still uses the real URL.
pub fn strip_url_query(url_str: &str) -> String {
    match Url::parse(url_str) {
        Ok(mut u) => {
            u.set_query(None);
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => url_str.to_string(),
    }
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

struct ChunkBuffer {
    total: u32,
    parts: HashMap<u32, String>,
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
                });
            if entry.total != total {
                *entry = ChunkBuffer {
                    total,
                    parts: HashMap::new(),
                };
            }
            entry.parts.insert(index, data.to_string());
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
) -> Result<ExtractPayload, String> {
    let req_id = uuid::Uuid::new_v4().to_string();
    let rx = registry.register(req_id.clone());

    if let Err(e) = run_extract(app, tab_id, &req_id) {
        registry.take(&req_id);
        return Err(e);
    }

    let payload = match tokio::time::timeout(EXTRACT_TIMEOUT, rx).await {
        Ok(Ok(p)) => p,
        Ok(Err(_)) | Err(_) => {
            registry.take(&req_id);
            return Err("couldn't read this page (strict CSP, or not an article)".to_string());
        }
    };

    if payload.markdown.starts_with("[extraction failed:") {
        return Err(payload.markdown);
    }

    Ok(payload)
}

/// Small in-memory cache of the last successful extraction per tab.
/// Used by Chat mode so that a conversation grounded in the current
/// tab doesn't re-extract on every user message. Keyed by tab_id; an
/// entry is considered stale if the tab's current URL has changed
/// (we re-check on each lookup) or if it's older than CACHE_TTL.
///
/// Nothing persists. Closing the app drops the cache.
#[derive(Default)]
pub struct ExtractCache {
    entries: Mutex<HashMap<String, CachedEntry>>,
}

struct CachedEntry {
    url: String,
    payload: ExtractPayload,
    at: Instant,
}

const CACHE_TTL: Duration = Duration::from_secs(300);

impl ExtractCache {
    pub fn get_fresh(&self, tab_id: &str, current_url: &str) -> Option<ExtractPayload> {
        let guard = self.entries.lock().ok()?;
        let e = guard.get(tab_id)?;
        if e.url != current_url {
            return None;
        }
        if e.at.elapsed() > CACHE_TTL {
            return None;
        }
        Some(e.payload.clone())
    }

    pub fn put(&self, tab_id: String, url: String, payload: ExtractPayload) {
        if let Ok(mut g) = self.entries.lock() {
            g.insert(
                tab_id,
                CachedEntry {
                    url,
                    payload,
                    at: Instant::now(),
                },
            );
        }
    }
}
