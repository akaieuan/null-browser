//! Favicon read commands. Writes never come through here — the only
//! writer is `favicons::ingest`, fed by the `null-event://` beacon.

use tauri::State;

use crate::storage::{Favicon, Storage};

/// Every stored origin → icon pair, loaded once by the shell at start;
/// later changes arrive as `favicon-set` events.
#[tauri::command]
pub fn get_favicons(storage: State<Storage>) -> Result<Vec<Favicon>, String> {
    storage.list_favicons().map_err(|e| e.to_string())
}
