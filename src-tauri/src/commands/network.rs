//! Network inspector commands: list requests, clear, pause, block.

use tauri::{AppHandle, State};

use crate::blocklist;
use crate::network::{NetworkEvent, NetworkState};
use crate::storage::{BlockedOrigin, Storage, TrackerDay};

#[tauri::command]
pub fn list_network_events(state: State<NetworkState>) -> Vec<NetworkEvent> {
    state.list()
}

/// Home's data-movement graph: one row per UTC day that saw a tracker.
#[tauri::command]
pub fn list_tracker_sightings(
    app: AppHandle,
    storage: State<Storage>,
) -> Result<Vec<TrackerDay>, String> {
    // Push the in-memory buffer to disk first, so the graph is current.
    crate::network::flush_tracker_sightings(&app);
    storage.list_tracker_sightings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_network_events(state: State<NetworkState>) {
    state.clear();
}

#[tauri::command]
pub fn set_network_paused(state: State<NetworkState>, paused: bool) {
    state.set_paused(paused);
}

#[tauri::command]
pub fn network_is_paused(state: State<NetworkState>) -> bool {
    state.is_paused()
}

/// SQLite is the record; the compiled rule list is a projection of it,
/// so every write to the table is followed by a recompile. Enforcement
/// arrives on the next request — an already-rendered page is not
/// reloaded out from under the user.
#[tauri::command]
pub fn block_origin(
    app: AppHandle,
    storage: State<Storage>,
    origin: String,
) -> Result<BlockedOrigin, String> {
    let row = storage
        .add_blocked_origin(&origin)
        .map_err(|e| e.to_string())?;
    blocklist::recompile_user_rules(&app);
    Ok(row)
}

#[tauri::command]
pub fn unblock_origin(
    app: AppHandle,
    storage: State<Storage>,
    origin: String,
) -> Result<(), String> {
    storage
        .remove_blocked_origin(&origin)
        .map_err(|e| e.to_string())?;
    blocklist::recompile_user_rules(&app);
    Ok(())
}

#[tauri::command]
pub fn list_blocked_origins(storage: State<Storage>) -> Result<Vec<BlockedOrigin>, String> {
    storage.list_blocked_origins().map_err(|e| e.to_string())
}

/// Whether Null's bundled ad and tracker list is switched on. Absent
/// means off — the default is not stored, so a fresh profile and a
/// profile that has never touched the toggle read the same.
#[tauri::command]
pub fn ad_blocking_enabled(storage: State<Storage>) -> Result<bool, String> {
    storage
        .get_setting(blocklist::SETTING_KEY)
        .map(|v| v.as_deref() == Some("true"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_ad_blocking(
    app: AppHandle,
    storage: State<Storage>,
    enabled: bool,
) -> Result<(), String> {
    storage
        .set_setting(
            blocklist::SETTING_KEY,
            if enabled { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())?;
    blocklist::set_ads_enabled(&app, enabled);
    Ok(())
}
