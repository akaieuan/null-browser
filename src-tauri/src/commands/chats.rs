//! Chat conversation persistence.
//!
//! Conversations are local SQLite rows, not synced anywhere. Each
//! conversation is an ordered list of `(user, assistant)` pairs plus an
//! optional captured page (`page_url` + `page_title`) from when the
//! chat started. Page context is injected into the FIRST user turn —
//! follow-up turns rely on the model already having the page in
//! context. If you want a fresh page in scope, start a new chat.

use tauri::State;

use crate::storage::{ChatMessage, Conversation, Storage};

#[tauri::command]
pub fn chat_create_conversation(
    storage: State<Storage>,
    title: String,
    page_url: Option<String>,
    page_title: Option<String>,
) -> Result<Conversation, String> {
    let title = if title.trim().is_empty() {
        "New chat".to_string()
    } else {
        title
    };
    storage
        .create_conversation(&title, page_url.as_deref(), page_title.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_list_conversations(storage: State<Storage>) -> Result<Vec<Conversation>, String> {
    storage.list_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_get_messages(
    storage: State<Storage>,
    conversation_id: i64,
) -> Result<Vec<ChatMessage>, String> {
    storage
        .list_messages(conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_rename_conversation(
    storage: State<Storage>,
    id: i64,
    title: String,
) -> Result<(), String> {
    let title = if title.trim().is_empty() {
        "New chat".to_string()
    } else {
        title
    };
    storage
        .rename_conversation(id, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_delete_conversation(storage: State<Storage>, id: i64) -> Result<(), String> {
    storage.delete_conversation(id).map_err(|e| e.to_string())
}
