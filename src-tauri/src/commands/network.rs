//! Network inspector commands: list requests, clear, pause, block.

use tauri::State;

use crate::network::{NetworkEvent, NetworkState};
use crate::storage::{BlockedOrigin, Storage};

#[tauri::command]
pub fn list_network_events(state: State<NetworkState>) -> Vec<NetworkEvent> {
    state.list()
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

#[tauri::command]
pub fn block_origin(storage: State<Storage>, origin: String) -> Result<BlockedOrigin, String> {
    storage
        .add_blocked_origin(&origin)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unblock_origin(storage: State<Storage>, origin: String) -> Result<(), String> {
    storage
        .remove_blocked_origin(&origin)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_blocked_origins(storage: State<Storage>) -> Result<Vec<BlockedOrigin>, String> {
    storage.list_blocked_origins().map_err(|e| e.to_string())
}
