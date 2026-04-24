//! Network inspector commands: list requests, clear, pause, export.

use tauri::State;

use crate::network::{NetworkEvent, NetworkState};

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
