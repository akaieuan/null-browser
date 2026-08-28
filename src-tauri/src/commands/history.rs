//! History read/write/clear commands. Local only — SQLite-backed, never
//! uploaded. User can clear it at any time.
//!
//! Shell-only, like every command — see `crate::commands`. History is a
//! record of everywhere the user has been, so a page reaching `list_history`
//! would be a first-order privacy leak.

use tauri::{State, Webview};

use crate::commands::ensure_shell;
use crate::storage::{HistoryEntry, Storage};

const DEFAULT_LIMIT: i64 = 500;

#[tauri::command]
pub fn list_history(
    webview: Webview,
    storage: State<Storage>,
    limit: Option<i64>,
) -> Result<Vec<HistoryEntry>, String> {
    ensure_shell(&webview)?;
    storage
        .list_history(limit.unwrap_or(DEFAULT_LIMIT))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_history(
    webview: Webview,
    storage: State<Storage>,
    url: String,
    title: String,
) -> Result<(), String> {
    ensure_shell(&webview)?;
    storage.add_history(&url, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_history(webview: Webview, storage: State<Storage>, id: i64) -> Result<(), String> {
    ensure_shell(&webview)?;
    storage.remove_history(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(webview: Webview, storage: State<Storage>) -> Result<(), String> {
    ensure_shell(&webview)?;
    storage.clear_history().map_err(|e| e.to_string())
}
