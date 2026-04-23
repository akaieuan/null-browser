//! Tab lifecycle commands: open, close, navigate, persist across restarts.

use tauri::AppHandle;

use crate::webview;

#[tauri::command]
pub fn navigate(app: AppHandle, url: String) -> Result<(), String> {
    webview::navigate(&app, &url)
}

#[tauri::command]
pub fn resize_content(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    webview::resize(&app, width, height)
}

#[tauri::command]
pub fn go_back(app: AppHandle) -> Result<(), String> {
    webview::go_back(&app)
}

#[tauri::command]
pub fn go_forward(app: AppHandle) -> Result<(), String> {
    webview::go_forward(&app)
}

#[tauri::command]
pub fn reload(app: AppHandle) -> Result<(), String> {
    webview::reload(&app)
}
