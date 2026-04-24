//! History read/write/clear commands. Local only — SQLite-backed, never
//! uploaded. User can clear it at any time.

use tauri::State;

use crate::storage::{HistoryEntry, Storage};

const DEFAULT_LIMIT: i64 = 500;

#[tauri::command]
pub fn list_history(
    storage: State<Storage>,
    limit: Option<i64>,
) -> Result<Vec<HistoryEntry>, String> {
    storage
        .list_history(limit.unwrap_or(DEFAULT_LIMIT))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_history(
    storage: State<Storage>,
    url: String,
    title: String,
) -> Result<(), String> {
    storage.add_history(&url, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_history(storage: State<Storage>, id: i64) -> Result<(), String> {
    storage.remove_history(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(storage: State<Storage>) -> Result<(), String> {
    storage.clear_history().map_err(|e| e.to_string())
}
