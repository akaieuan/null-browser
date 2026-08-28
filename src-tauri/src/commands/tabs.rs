//! Tab lifecycle commands: open, close, activate, navigate, resize.
//!
//! Every command here is shell-only: it opens with a `Webview`-label
//! guard so page content in a tab or popup cannot drive the tab strip.
//! See `crate::commands` and docs/SECURITY.md.

use tauri::{AppHandle, Manager, Webview};

use crate::commands::{ensure_shell, is_shell_label};
use crate::webview::{self, ContentRect};

#[tauri::command]
pub fn open_tab(
    webview: Webview,
    app: AppHandle,
    id: String,
    url: String,
    rect: ContentRect,
) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::create_tab(&app, &id, &url, rect)
}

#[tauri::command]
pub fn close_tab(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::close_tab(&app, &id)
}

#[tauri::command]
pub fn activate_tab(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::activate(&app, &id)
}

/// Split view: show this exact set of tabs, focus one of them.
#[tauri::command]
pub fn activate_tabs(
    webview: Webview,
    app: AppHandle,
    ids: Vec<String>,
    focus: String,
) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::activate_many(&app, &ids, &focus)
}

#[tauri::command]
pub fn hide_all_tabs(webview: Webview, app: AppHandle) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::hide_all(&app)
}

#[tauri::command]
pub fn navigate_tab(webview: Webview, app: AppHandle, id: String, url: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::navigate_tab(&app, &id, &url)
}

#[tauri::command]
pub fn resize_content(
    webview: Webview,
    app: AppHandle,
    rect: ContentRect,
    only: Option<String>,
) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::set_content_frame(&app, rect, only.as_deref())
}

#[tauri::command]
pub fn focus_shell(webview: Webview, app: AppHandle) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::focus_shell(&app)
}

/// ⌥⌘I — WebKit's own inspector on the active tab. Also reachable by
/// right-click → Inspect Element (the devtools build flag enables it).
#[tauri::command]
pub fn open_tab_devtools(webview: Webview, app: AppHandle, id: String) {
    if !is_shell_label(webview.label()) {
        return;
    }
    if let Some(tab) = app.get_webview(&format!("tab-{id}")) {
        tab.open_devtools();
    }
}

/// ⌘+ / ⌘− / ⌘0 — page zoom on one tab.
#[tauri::command]
pub fn set_tab_zoom(webview: Webview, app: AppHandle, id: String, factor: f64) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::set_tab_zoom(&app, &id, factor)
}

/// ⌘F — find-on-page. An empty query clears the page's selection.
#[tauri::command]
pub fn find_in_page(
    webview: Webview,
    app: AppHandle,
    id: String,
    query: String,
    forward: bool,
    restart: bool,
) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::find_in_page(&app, &id, &query, forward, restart)
}

/// Corners preference: restyle the native page cards.
#[tauri::command]
pub fn set_tab_corner_radius(webview: Webview, app: AppHandle, radius: f64) {
    if !is_shell_label(webview.label()) {
        return;
    }
    webview::set_corner_radius(&app, radius);
}

#[tauri::command]
pub fn go_back(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::go_back(&app, &id)
}

#[tauri::command]
pub fn go_forward(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::go_forward(&app, &id)
}

#[tauri::command]
pub fn reload(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::reload(&app, &id)
}

#[tauri::command]
pub fn clear_tab_storage(webview: Webview, app: AppHandle) -> Result<(), String> {
    ensure_shell(&webview)?;
    webview::clear_tab_storage(&app)
}
