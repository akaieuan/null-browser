//! WebView management: multi-tab content webviews.
//!
//! Every browser tab is its own child webview under the main window,
//! labelled `tab-<uuid>`. Switching tabs toggles visibility via the
//! native `show`/`hide` APIs — no off-screen hacks. All tabs share
//! the same position and size (directly below the top bar); only
//! one is visible at a time.
//!
//! The React shell in the `main` webview never sees user page
//! content. It just manages the tab list and the address bar.

use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, EventTarget, Manager, PhysicalPosition,
    PhysicalSize, Url, WebviewBuilder, WebviewUrl,
};

use crate::network;

/// Prefix used for all tab webview labels. Keeps them separable from
/// the `main` webview in the `app.webviews()` map.
const TAB_PREFIX: &str = "tab-";

/// Event name the content webview emits to the UI when a tab's URL changes.
pub const TAB_UPDATED: &str = "tab-updated";

/// Event name for load start/finish, used to drive the top progress bar.
pub const TAB_LOAD_STATE: &str = "tab-load-state";

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn tab_label(tab_id: &str) -> String {
    format!("{TAB_PREFIX}{tab_id}")
}

/// Create a new tab webview, positioned under the top bar. The frontend
/// passes `top` (in CSS pixels) so the webview stays in sync with a
/// dynamic top bar (tabs + toolbar + optional bookmarks bar).
pub fn create_tab(app: &AppHandle, tab_id: &str, url: &str, top: f64) -> Result<(), String> {
    let label = tab_label(tab_id);
    let url: Url = url.parse().map_err(s)?;

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let scale = window.scale_factor().map_err(s)?;
    let inner = window.inner_size().map_err(s)?;
    let top_px = (top.max(0.0) * scale).round() as u32;

    let emit_id = tab_id.to_string();
    let nav_id = tab_id.to_string();
    let nav_app = app.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(move |url| {
            network::record_navigation(&nav_app, &nav_id, url);
            true
        })
        .on_page_load(move |webview, payload| {
            let url_string = payload.url().to_string();
            let app = webview.app_handle();
            let state = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            let _ = app.emit_to(
                EventTarget::webview("main"),
                TAB_LOAD_STATE,
                serde_json::json!({ "id": &emit_id, "state": state, "url": &url_string }),
            );
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = app.emit_to(
                    EventTarget::webview("main"),
                    TAB_UPDATED,
                    serde_json::json!({ "id": &emit_id, "url": &url_string }),
                );
            }
        });

    window
        .add_child(
            builder,
            PhysicalPosition::new(0i32, top_px as i32),
            PhysicalSize::new(inner.width, inner.height.saturating_sub(top_px)),
        )
        .map_err(s)?;

    Ok(())
}

/// Close (destroy) a tab webview.
pub fn close_tab(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(s)?;
    }
    Ok(())
}

/// Show the given tab; hide every other tab.
pub fn activate(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    let target = tab_label(tab_id);
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        if label == target {
            webview.show().map_err(s)?;
        } else {
            webview.hide().map_err(s)?;
        }
    }
    Ok(())
}

/// Hide every tab webview. Used when the active tab has no URL yet — the
/// React shell shows the Null landing page through.
pub fn hide_all(app: &AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        webview.hide().map_err(s)?;
    }
    Ok(())
}

/// Navigate a specific tab to a new URL.
pub fn navigate_tab(app: &AppHandle, tab_id: &str, url: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("tab {tab_id} not found"))?;
    let url: Url = url.parse().map_err(s)?;
    webview.navigate(url).map_err(s)?;
    Ok(())
}

/// Reposition and resize every tab webview. Called by the frontend any time
/// the window resizes *or* the top bar changes height (e.g. when the
/// bookmarks bar toggles). `top`, `width`, `height` are CSS (= logical) pixels.
pub fn set_content_frame(app: &AppHandle, top: f64, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_window("main") else {
        return Ok(());
    };
    let scale = window.scale_factor().map_err(s)?;
    let t = (top.max(0.0) * scale).round() as u32;
    let w = (width.max(0.0) * scale).round() as u32;
    let h = (height.max(0.0) * scale).round() as u32;
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        webview
            .set_position(PhysicalPosition::new(0i32, t as i32))
            .map_err(s)?;
        webview.set_size(PhysicalSize::new(w, h)).map_err(s)?;
    }
    Ok(())
}

fn eval_on(app: &AppHandle, tab_id: &str, script: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.eval(script).map_err(s)
}

pub fn go_back(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "history.back()")
}

pub fn go_forward(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "history.forward()")
}

pub fn reload(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "location.reload()")
}

/// Wipe per-origin storage on every live tab (cookies, localStorage,
/// sessionStorage, IndexedDB). Runs as a page script, so it clears only
/// what JS can see for the current document's origin — not the OS-level
/// network cache. Good enough to log the user out of most sites.
pub fn clear_tab_storage(app: &AppHandle) -> Result<(), String> {
    const SCRIPT: &str = r#"
        try { localStorage.clear(); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        try {
            document.cookie.split(';').forEach(function (c) {
                var eq = c.indexOf('=');
                var name = (eq > -1 ? c.substr(0, eq) : c).trim();
                if (!name) return;
                var host = location.hostname;
                var paths = ['/', location.pathname];
                var domains = ['', host, '.' + host];
                paths.forEach(function (p) {
                    domains.forEach(function (d) {
                        var base = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=' + p;
                        document.cookie = d ? base + ';domain=' + d : base;
                    });
                });
            });
        } catch (e) {}
        try {
            if (indexedDB.databases) {
                indexedDB.databases().then(function (dbs) {
                    dbs.forEach(function (d) {
                        if (d && d.name) indexedDB.deleteDatabase(d.name);
                    });
                });
            }
        } catch (e) {}
    "#;
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        webview.eval(SCRIPT).map_err(s)?;
    }
    Ok(())
}
