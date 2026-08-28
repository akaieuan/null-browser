//! Clip commands. Two capture paths, no AI anywhere:
//!
//! - `save_current_tab` — extract the readable article → `clip` artifact
//! - `clip_selection`   — convert the tab's selection → `selection` artifact
//!
//! Both persist to SQLite (the index) and mirror the clip to
//! `~/Documents/Null/` as a markdown file (the user-facing copy).
//!
//! What this stores: page title, source URL, markdown body — locally.
//! What this transmits: nothing. What this remembers: the clip, until
//! the user deletes it.

use tauri::{AppHandle, State, Webview};

use crate::commands::{ensure_shell, is_shell_label};
use crate::notes;
use crate::storage::{Artifact, Storage};
use crate::webview;
use crate::webview::extract::{ExtractKind, ExtractRegistry};

#[tauri::command]
pub fn list_artifacts(webview: Webview, storage: State<Storage>) -> Result<Vec<Artifact>, String> {
    ensure_shell(&webview)?;
    storage.list_artifacts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_artifact(
    webview: Webview,
    storage: State<Storage>,
    id: i64,
) -> Result<Artifact, String> {
    ensure_shell(&webview)?;
    let artifact = storage.get_artifact(id).map_err(|e| e.to_string())?;
    // Opening is when external edits to the file mirror get adopted —
    // see notes::sync_from_disk for the contract.
    Ok(notes::sync_from_disk(&storage, &artifact).unwrap_or(artifact))
}

#[tauri::command]
pub fn delete_artifact(webview: Webview, storage: State<Storage>, id: i64) -> Result<(), String> {
    ensure_shell(&webview)?;
    // Captured before the row goes: delete_note needs the content Null
    // wrote so it can refuse to delete a file the user has since edited.
    let doomed = storage.get_artifact(id).ok();
    storage.delete_artifact(id).map_err(|e| e.to_string())?;
    // Best-effort: the SQLite row is gone either way; a stray file is
    // the user's to keep or toss.
    if let Some(a) = doomed {
        if let Some(path) = a.file_path {
            let expected = notes::note_content(&a.title, &a.source_url, &a.markdown);
            let _ = notes::delete_note(&path, &expected);
        }
    }
    Ok(())
}

/// The notes directory clips are mirrored to, for display in settings.
#[tauri::command]
pub fn get_notes_dir(webview: Webview) -> Option<String> {
    if !is_shell_label(webview.label()) {
        return None;
    }
    notes::notes_dir().map(|p| p.to_string_lossy().into_owned())
}

/// Persist an extracted payload as an artifact + note file.
///
/// Saving the same page twice with the same content returns the
/// existing note instead of minting a new row and a new file — the
/// notes directory must not fill with `0007-title.md`, `0008-title.md`
/// duplicates of one unchanged article. A changed page is a genuinely
/// new capture and still saves.
fn save_clip(
    storage: &Storage,
    kind: &str,
    payload: &webview::extract::ExtractPayload,
) -> Result<Artifact, String> {
    if let Ok(Some(id)) = storage.find_identical_artifact(kind, &payload.url, &payload.markdown) {
        if let Ok(existing) = storage.get_artifact(id) {
            return Ok(existing);
        }
    }
    let artifact = storage
        .insert_artifact(
            kind,
            &payload.title,
            &payload.url,
            Some(&payload.title),
            &payload.markdown,
            "none",
        )
        .map_err(|e| e.to_string())?;
    // File mirror is best-effort: a full disk or odd permissions must
    // not lose the clip, which is already safe in SQLite.
    match notes::write_note(
        artifact.id,
        &artifact.title,
        &artifact.source_url,
        &artifact.markdown,
    ) {
        Ok(path) => {
            let path = path.to_string_lossy().into_owned();
            let _ = storage.set_artifact_file_path(artifact.id, &path);
        }
        Err(e) => eprintln!("null: failed to write note file: {e}"),
    }
    Ok(artifact)
}

/// A blank note the user is about to type into. `source_url` is the
/// page they were on — the "taking notes on this video" link — or
/// empty for a standalone note.
#[tauri::command]
pub fn create_note(
    webview: Webview,
    storage: State<Storage>,
    title: String,
    source_url: String,
) -> Result<Artifact, String> {
    ensure_shell(&webview)?;
    let artifact = storage
        .insert_artifact("note", &title, &source_url, None, "", "none")
        .map_err(|e| e.to_string())?;
    if let Ok(path) = notes::write_note(artifact.id, &artifact.title, &artifact.source_url, "") {
        let path = path.to_string_lossy().into_owned();
        let _ = storage.set_artifact_file_path(artifact.id, &path);
    }
    storage.get_artifact(artifact.id).map_err(|e| e.to_string())
}

/// Autosave from the editor: rewrite the row and the file mirror.
/// A renamed note moves its file (new slug), and the old file goes
/// through the same guarded delete as everything else — one that was
/// edited externally survives on disk.
#[tauri::command]
pub fn update_note(
    webview: Webview,
    storage: State<Storage>,
    id: i64,
    title: String,
    markdown: String,
) -> Result<Artifact, String> {
    ensure_shell(&webview)?;
    let old = storage.get_artifact(id).map_err(|e| e.to_string())?;
    storage
        .update_artifact(id, &title, &markdown)
        .map_err(|e| e.to_string())?;
    match notes::write_note(id, &title, &old.source_url, &markdown) {
        Ok(path) => {
            let new_path = path.to_string_lossy().into_owned();
            if let Some(old_path) = &old.file_path {
                if old_path != &new_path {
                    let expected = notes::note_content(&old.title, &old.source_url, &old.markdown);
                    let _ = notes::delete_note(old_path, &expected);
                }
            }
            let _ = storage.set_artifact_file_path(id, &new_path);
        }
        Err(e) => eprintln!("null: failed to write note file: {e}"),
    }
    storage.get_artifact(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_current_tab(
    webview: Webview,
    app: AppHandle,
    storage: State<'_, Storage>,
    registry: State<'_, ExtractRegistry>,
    tab_id: String,
) -> Result<i64, String> {
    ensure_shell(&webview)?;
    let payload =
        webview::extract::extract_tab(&app, &registry, &tab_id, ExtractKind::Article).await?;
    Ok(save_clip(&storage, "clip", &payload)?.id)
}

#[tauri::command]
pub async fn clip_selection(
    webview: Webview,
    app: AppHandle,
    storage: State<'_, Storage>,
    registry: State<'_, ExtractRegistry>,
    tab_id: String,
) -> Result<i64, String> {
    ensure_shell(&webview)?;
    let payload =
        webview::extract::extract_tab(&app, &registry, &tab_id, ExtractKind::Selection).await?;
    Ok(save_clip(&storage, "selection", &payload)?.id)
}
