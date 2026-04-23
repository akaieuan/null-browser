//! Tab lifecycle commands: open, close, navigate, persist across restarts.

use tauri::AppHandle;

use crate::webview;

#[tauri::command]
pub fn navigate(app: AppHandle, url: String) -> Result<(), String> {
    webview::navigate(&app, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_content(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    webview::resize(&app, width, height).map_err(|e| e.to_string())
}
