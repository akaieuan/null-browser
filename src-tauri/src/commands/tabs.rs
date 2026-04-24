//! Tab lifecycle commands: open, close, activate, navigate, resize.

use tauri::AppHandle;

use crate::webview;

#[tauri::command]
pub fn open_tab(app: AppHandle, id: String, url: String, top: f64) -> Result<(), String> {
    webview::create_tab(&app, &id, &url, top)
}

#[tauri::command]
pub fn close_tab(app: AppHandle, id: String) -> Result<(), String> {
    webview::close_tab(&app, &id)
}

#[tauri::command]
pub fn activate_tab(app: AppHandle, id: String) -> Result<(), String> {
    webview::activate(&app, &id)
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
pub fn resize_content(app: AppHandle, top: f64, width: f64, height: f64) -> Result<(), String> {
    webview::set_content_frame(&app, top, width, height)
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
