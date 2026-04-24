//! Outbound request monitoring for the network inspector.
//!
//! Every navigation the WebView makes is captured here and pushed to
//! the UI in real time. Not a devtool — a first-class surface that
//! makes Null's 'zero telemetry' invariant provable.
//!
//! Phase 1 captures main-frame navigations via Tauri's on_navigation
//! callback. Phase 2 will add subresources (scripts, fonts, XHR,
//! fetch) via an injected PerformanceObserver + native message
//! handler — that path needs CSP-bypassing plumbing, so it's a
//! separate commit.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Url};

use crate::storage::Storage;

/// Most recent events kept in memory. Older ones are dropped. Intentionally
/// modest — the inspector is for 'what's happening now', not forensics.
const MAX_EVENTS: usize = 2000;

/// Event name the inspector emits to the UI whenever a new request lands.
pub const NETWORK_EVENT: &str = "network-event";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEvent {
    pub id: u64,
    pub tab_id: Option<String>,
    pub url: String,
    pub origin: String,
    /// "navigation" today; "resource", "fetch", "xhr", etc. in later phases.
    pub kind: String,
    /// True if this request was prevented by the user's blocklist.
    pub blocked: bool,
    /// Unix epoch seconds.
    pub at: i64,
}

pub struct NetworkState {
    events: Mutex<VecDeque<NetworkEvent>>,
    next_id: AtomicU64,
    paused: AtomicBool,
}

impl Default for NetworkState {
    fn default() -> Self {
        Self {
            events: Mutex::new(VecDeque::with_capacity(MAX_EVENTS)),
            next_id: AtomicU64::new(1),
            paused: AtomicBool::new(false),
        }
    }
}

impl NetworkState {
    /// Record an event. No-op if paused. Returns the recorded event
    /// (with its assigned id) so the caller can emit it to the UI.
    pub fn record(&self, mut event: NetworkEvent) -> Option<NetworkEvent> {
        if self.paused.load(Ordering::Relaxed) {
            return None;
        }
        event.id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut q = self.events.lock().ok()?;
        if q.len() >= MAX_EVENTS {
            q.pop_front();
        }
        q.push_back(event.clone());
        Some(event)
    }

    pub fn list(&self) -> Vec<NetworkEvent> {
        self.events
            .lock()
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut q) = self.events.lock() {
            q.clear();
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
}

/// Extract the origin (scheme://host[:port]) from a URL.
/// Falls back to the URL's string form if it has no host.
pub fn origin_of(url: &Url) -> String {
    let host = url.host_str().unwrap_or("");
    if host.is_empty() {
        return url.as_str().to_string();
    }
    if let Some(port) = url.port() {
        format!("{}://{}:{}", url.scheme(), host, port)
    } else {
        format!("{}://{}", url.scheme(), host)
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// JS payload we ship back from the injected observer script. The `kind`
/// is the PerformanceEntry's initiatorType (script/css/xmlhttprequest/
/// fetch/img/link/…).
#[derive(Debug, Deserialize)]
pub struct SubresourceRecord {
    pub url: String,
    #[serde(rename = "init")]
    pub initiator: String,
}

/// Capture a subresource request — scripts, fonts, images, XHRs, fetches.
/// Called from the custom URI scheme handler when the injected
/// PerformanceObserver fires. Best-effort: sites with strict `img-src` CSP
/// may block our callback, which means their subresources stay invisible
/// until Phase 3 (native message handler).
pub fn record_subresource(app: &AppHandle, url_str: &str, initiator: &str) {
    // Skip our own scheme + non-web schemes (data:, blob:, chrome:, about:).
    if !(url_str.starts_with("https://") || url_str.starts_with("http://")) {
        return;
    }
    let Ok(url) = Url::parse(url_str) else {
        return;
    };
    let origin = origin_of(&url);
    let blocked = app
        .try_state::<Storage>()
        .and_then(|s| s.is_origin_blocked(&origin).ok())
        .unwrap_or(false);

    let event = NetworkEvent {
        id: 0,
        tab_id: None,
        url: url_str.to_string(),
        origin,
        kind: initiator.to_string(),
        blocked,
        at: now_secs(),
    };

    if let Some(state) = app.try_state::<NetworkState>() {
        if let Some(recorded) = state.record(event) {
            let _ = app.emit_to(EventTarget::webview("main"), NETWORK_EVENT, &recorded);
        }
    }
}

/// Record an outbound AI provider call for the inspector. Called from
/// every command that's about to hit a cloud AI endpoint, so "every
/// outbound connection is visible" (invariant 4) holds for AI traffic.
pub fn record_ai_outbound(app: &AppHandle, provider: &str, endpoint: &str) {
    record_outbound(app, &format!("ai:{provider}"), endpoint);
}

/// Record an outbound search provider call. The URL logged is the
/// endpoint root, not the fully-parameterized query URL — the query
/// itself is user data that we don't mirror to inspector history.
pub fn record_search_outbound(app: &AppHandle, provider: &str, endpoint: &str) {
    record_outbound(app, &format!("search:{provider}"), endpoint);
}

fn record_outbound(app: &AppHandle, kind: &str, endpoint: &str) {
    let Ok(url) = Url::parse(endpoint) else {
        return;
    };
    let event = NetworkEvent {
        id: 0,
        tab_id: None,
        url: url.to_string(),
        origin: origin_of(&url),
        kind: kind.to_string(),
        blocked: false,
        at: now_secs(),
    };
    if let Some(state) = app.try_state::<NetworkState>() {
        if let Some(recorded) = state.record(event) {
            let _ = app.emit_to(EventTarget::webview("main"), NETWORK_EVENT, &recorded);
        }
    }
}

/// Capture a main-frame navigation for the inspector and broadcast it to
/// the main webview. Returns `true` if the navigation should proceed,
/// `false` if it hit a blocked origin and should be cancelled.
///
/// Called from `WebviewBuilder::on_navigation` for every tab. Cheap and
/// fallible by design — if state is missing or the broadcast fails, the
/// navigation itself still proceeds.
pub fn record_navigation(app: &AppHandle, tab_id: &str, url: &Url) -> bool {
    let origin = origin_of(url);
    let blocked = app
        .try_state::<Storage>()
        .and_then(|s| s.is_origin_blocked(&origin).ok())
        .unwrap_or(false);

    let event = NetworkEvent {
        id: 0,
        tab_id: Some(tab_id.to_string()),
        url: url.to_string(),
        origin,
        kind: "navigation".to_string(),
        blocked,
        at: now_secs(),
    };

    if let Some(state) = app.try_state::<NetworkState>() {
        if let Some(recorded) = state.record(event) {
            let _ = app.emit_to(EventTarget::webview("main"), NETWORK_EVENT, &recorded);
        }
    }

    !blocked
}
