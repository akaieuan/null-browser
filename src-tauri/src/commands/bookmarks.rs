//! Bookmark CRUD commands. Storage lives in SQLite.

use tauri::State;

use crate::storage::{Bookmark, Storage};

#[tauri::command]
pub fn list_bookmarks(storage: State<Storage>) -> Result<Vec<Bookmark>, String> {
    storage.list_bookmarks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark(
    storage: State<Storage>,
    url: String,
    title: String,
) -> Result<Bookmark, String> {
    storage
        .add_bookmark(&url, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_bookmark(storage: State<Storage>, id: i64) -> Result<(), String> {
    storage.remove_bookmark(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_bookmark_by_url(storage: State<Storage>, url: String) -> Result<(), String> {
    storage
        .remove_bookmark_by_url(&url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_bookmarks(storage: State<Storage>, ordered_ids: Vec<i64>) -> Result<(), String> {
    storage
        .reorder_bookmarks(&ordered_ids)
        .map_err(|e| e.to_string())
}
