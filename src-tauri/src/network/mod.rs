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

    // A tracker the observer saw is one that loaded — count it against
    // today for Home's graph. With ad blocking on, trackers are stopped
    // in WebKit and never reach here, so the count falls: it measures
    // exposure, not blocks (which are, by design, uncountable).
    if let Some(host) = url.host_str() {
        if crate::blocklist::is_tracker_host(host) {
            note_tracker_sighting(app);
        }
    }

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

/// Today as days since the Unix epoch, UTC. The graph is a calendar,
/// so day granularity is all it needs; UTC keeps it dependency-free at
/// the cost of a cell boundary that is not the viewer's local midnight.
fn utc_day() -> i64 {
    now_secs() / 86_400
}

/// Buffered tracker-sighting count. `record_subresource` runs on the
/// beacon path, once per observed subresource — an ad-heavy page fires
/// hundreds — so writing an fsync'd upsert each, on the one mutex the
/// UI also reads through, would jank the interface. Counts accrue here
/// and flush to SQLite at most once every `FLUSH_SECS`; the graph is
/// approximate exposure, so a few seconds of lag is invisible.
struct Sightings {
    day: i64,
    pending: i64,
    last_flush: i64,
}
static SIGHTINGS: Mutex<Sightings> = Mutex::new(Sightings {
    day: 0,
    pending: 0,
    last_flush: 0,
});
const FLUSH_SECS: i64 = 10;

fn note_tracker_sighting(app: &AppHandle) {
    let today = utc_day();
    let now = now_secs();
    // Under the lock: roll the day if needed, add this sighting, and
    // decide whether it is time to flush. The writes happen after the
    // lock is dropped.
    let (roll, flush) = {
        let mut s = SIGHTINGS.lock().unwrap_or_else(|e| e.into_inner());
        let mut roll = None;
        if s.day != today {
            if s.pending > 0 {
                roll = Some((s.day, s.pending)); // yesterday's tail
            }
            s.day = today;
            s.pending = 0;
            s.last_flush = now;
        }
        s.pending += 1;
        let flush = if now - s.last_flush >= FLUSH_SECS {
            let n = s.pending;
            s.pending = 0;
            s.last_flush = now;
            Some((s.day, n))
        } else {
            None
        };
        (roll, flush)
    };
    if roll.is_some() || flush.is_some() {
        if let Some(storage) = app.try_state::<Storage>() {
            for (day, n) in roll.into_iter().chain(flush) {
                let _ = storage.add_tracker_sightings(day, n);
            }
        }
    }
}

/// Force any buffered sightings to disk. Called before the graph reads,
/// so it never shows a count ~`FLUSH_SECS` stale.
pub fn flush_tracker_sightings(app: &AppHandle) {
    let flush = {
        let mut s = SIGHTINGS.lock().unwrap_or_else(|e| e.into_inner());
        if s.pending > 0 {
            let out = (s.day, s.pending);
            s.pending = 0;
            s.last_flush = now_secs();
            Some(out)
        } else {
            None
        }
    };
    if let Some((day, n)) = flush {
        if let Some(storage) = app.try_state::<Storage>() {
            let _ = storage.add_tracker_sightings(day, n);
        }
    }
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
