//! Bookmark CRUD commands. Storage lives in SQLite.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Runtime, State, WebviewWindow};

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
pub fn update_bookmark(
    storage: State<Storage>,
    id: i64,
    url: String,
    title: String,
) -> Result<(), String> {
    storage
        .update_bookmark(id, &url, &title)
        .map_err(|e| e.to_string())
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

/// Pop up a native OS context menu for a bookmark. Uses the platform menu
/// surface so it paints above the native webview regardless of the React
/// layer's z-index. Each item's id is `bmk:<action>:<bookmark_id>`; the
/// global menu event handler in `crate::menu` parses these and emits a
/// `bookmark-menu-action` event the frontend listens for.
#[tauri::command]
pub fn show_bookmark_menu<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    id: i64,
) -> Result<(), String> {
    let open_new_tab = MenuItem::with_id(
        &app,
        format!("bmk:open_new_tab:{id}"),
        "Open in New Tab",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let edit = MenuItem::with_id(
        &app,
        format!("bmk:edit:{id}"),
        "Edit…",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let copy_url = MenuItem::with_id(
        &app,
        format!("bmk:copy_url:{id}"),
        "Copy URL",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let delete = MenuItem::with_id(
        &app,
        format!("bmk:delete:{id}"),
        "Delete",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep_a = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let sep_b = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        &app,
        &[&open_new_tab, &sep_a, &edit, &copy_url, &sep_b, &delete],
    )
    .map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}
