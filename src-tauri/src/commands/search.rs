//! Search commands: provider config + the search call itself.
//!
//! Every search records an outbound network event before the request
//! leaves the device (invariant 4). Only the instance URL is logged —
//! the query is the user's, not ours to keep.

use tauri::{AppHandle, State};

use crate::network::record_search_outbound;
use crate::search::{searxng_endpoint, searxng_search, SearchResult};
use crate::storage::Storage;

const INSTANCE_KEY: &str = "search_instance";

#[tauri::command]
pub fn search_get_instance(storage: State<Storage>) -> Result<Option<String>, String> {
    storage.get_setting(INSTANCE_KEY).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_set_instance(storage: State<Storage>, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("instance URL is empty".to_string());
    }
    // Reject obvious junk early so the user sees a real error instead of a
    // timeout on first search.
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("instance URL must start with http:// or https://".to_string());
    }
    storage
        .set_setting(INSTANCE_KEY, trimmed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_clear_instance(storage: State<Storage>) -> Result<(), String> {
    storage
        .delete_setting(INSTANCE_KEY)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_web(
    app: AppHandle,
    storage: State<'_, Storage>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("query is empty".to_string());
    }
    let instance = storage
        .get_setting(INSTANCE_KEY)
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "no search provider configured".to_string())?;

    record_search_outbound(&app, "searxng", &searxng_endpoint(&instance));

    searxng_search(&instance, trimmed).await
}
