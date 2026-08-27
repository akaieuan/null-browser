//! Tab lifecycle commands: open, close, activate, navigate, resize.

use tauri::{AppHandle, Manager};

use crate::webview::{self, ContentRect};

#[tauri::command]
pub fn open_tab(app: AppHandle, id: String, url: String, rect: ContentRect) -> Result<(), String> {
    webview::create_tab(&app, &id, &url, rect)
}

#[tauri::command]
pub fn close_tab(app: AppHandle, id: String) -> Result<(), String> {
    webview::close_tab(&app, &id)
}

#[tauri::command]
pub fn activate_tab(app: AppHandle, id: String) -> Result<(), String> {
    webview::activate(&app, &id)
}

/// Split view: show this exact set of tabs, focus one of them.
#[tauri::command]
pub fn activate_tabs(app: AppHandle, ids: Vec<String>, focus: String) -> Result<(), String> {
    webview::activate_many(&app, &ids, &focus)
}

#[tauri::command]
pub fn hide_all_tabs(app: AppHandle) -> Result<(), String> {
    webview::hide_all(&app)
}

#[tauri::command]
pub fn navigate_tab(app: AppHandle, id: String, url: String) -> Result<(), String> {
    webview::navigate_tab(&app, &id, &url)
}

#[tauri::command]
pub fn resize_content(
    app: AppHandle,
    rect: ContentRect,
    only: Option<String>,
) -> Result<(), String> {
    webview::set_content_frame(&app, rect, only.as_deref())
}

#[tauri::command]
pub fn focus_shell(app: AppHandle) -> Result<(), String> {
    webview::focus_shell(&app)
}

/// ⌥⌘I — WebKit's own inspector on the active tab. Also reachable by
/// right-click → Inspect Element (the devtools build flag enables it).
#[tauri::command]
pub fn open_tab_devtools(app: AppHandle, id: String) {
    if let Some(webview) = app.get_webview(&format!("tab-{id}")) {
        webview.open_devtools();
    }
}

/// ⌘+ / ⌘− / ⌘0 — page zoom on one tab.
#[tauri::command]
pub fn set_tab_zoom(app: AppHandle, id: String, factor: f64) -> Result<(), String> {
    webview::set_tab_zoom(&app, &id, factor)
}

/// ⌘F — find-on-page. An empty query clears the page's selection.
#[tauri::command]
pub fn find_in_page(
    app: AppHandle,
    id: String,
    query: String,
    forward: bool,
    restart: bool,
) -> Result<(), String> {
    webview::find_in_page(&app, &id, &query, forward, restart)
}

/// Corners preference: restyle the native page cards.
#[tauri::command]
pub fn set_tab_corner_radius(app: AppHandle, radius: f64) {
    webview::set_corner_radius(&app, radius);
}

#[tauri::command]
pub fn go_back(app: AppHandle, id: String) -> Result<(), String> {
    webview::go_back(&app, &id)
}

#[tauri::command]
pub fn go_forward(app: AppHandle, id: String) -> Result<(), String> {
    webview::go_forward(&app, &id)
}

#[tauri::command]
pub fn reload(app: AppHandle, id: String) -> Result<(), String> {
    webview::reload(&app, &id)
}

#[tauri::command]
pub fn clear_tab_storage(app: AppHandle) -> Result<(), String> {
    webview::clear_tab_storage(&app)
}
