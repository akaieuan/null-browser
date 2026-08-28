//! Favicon read commands. Writes never come through here — the only
//! writer is `favicons::ingest`, fed by the `null-event://` beacon.
//!
//! Shell-only, like every command — see `crate::commands`.

use tauri::{State, Webview};

use crate::commands::ensure_shell;
use crate::storage::{Favicon, Storage};

/// Every stored origin → icon pair, loaded once by the shell at start;
/// later changes arrive as `favicon-set` events.
#[tauri::command]
pub fn get_favicons(webview: Webview, storage: State<Storage>) -> Result<Vec<Favicon>, String> {
    ensure_shell(&webview)?;
    storage.list_favicons().map_err(|e| e.to_string())
}
