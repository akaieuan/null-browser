//! AI router commands: store provider keys, probe local Ollama,
//! run streaming completions.
//!
//! Every call leaving the device is recorded in the network inspector
//! before the request goes out, honoring "every outbound connection is
//! visible". Cloud-provider keys live in the OS keychain and are never
//! returned to the frontend. Ollama is treated as keyless — no key
//! lookup, no failure when no key is stored, but its calls are still
//! logged (origin `127.0.0.1:11434`, kind `ai:ollama`) so the user can
//! see that a chat happened, even when nothing left the machine.
//!
//! `ai_send` accepts an optional `conversation_id`. When present, the
//! command loads prior turns from SQLite, sends the full history to the
//! provider, and persists both the user message and the assistant
//! reply. When absent, it's a one-shot — no persistence, no history,
//! same shape as before.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ai::{cache::KeyCache, dispatch, dispatch::ChatTurn, ollama};
use crate::network::record_ai_outbound;
use crate::storage::Storage;

#[derive(Serialize)]
pub struct ProviderStatus {
    pub anthropic: bool,
    pub openai: bool,
    pub ollama: bool,
}

#[tauri::command]
pub fn ai_set_key(cache: State<KeyCache>, provider: String, key: String) -> Result<(), String> {
    match provider.as_str() {
        "anthropic" | "openai" => {}
        _ => return Err(format!("unknown provider: {provider}")),
    }
    cache.set(&provider, &key)
}

#[tauri::command]
pub async fn ai_provider_status(cache: State<'_, KeyCache>) -> Result<ProviderStatus, String> {
    let ollama_status = ollama::status().await;
    Ok(ProviderStatus {
        anthropic: cache.get("anthropic")?.is_some(),
        openai: cache.get("openai")?.is_some(),
        ollama: ollama_status.running,
    })
}

#[tauri::command]
pub async fn ai_ollama_status() -> Result<ollama::OllamaStatus, String> {
    Ok(ollama::status().await)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_send(
    app: AppHandle,
    cache: State<'_, KeyCache>,
    storage: State<'_, Storage>,
    provider: String,
    model: String,
    prompt: String,
    conversation_id: Option<i64>,
    on_chunk: Channel<String>,
) -> Result<String, String> {
    let endpoint = dispatch::endpoint_for(&provider)?;

    // Build the turn list: prior history (if any) + the new user turn.
    let history = match conversation_id {
        Some(cid) => storage.list_messages(cid).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };

    // Persist the user turn before the call so it survives a hard kill
    // mid-stream — the assistant message gets persisted on success.
    if let Some(cid) = conversation_id {
        storage
            .append_message(cid, "user", &prompt, Some(&provider), Some(&model))
            .map_err(|e| e.to_string())?;
    }

    let mut turns: Vec<ChatTurn> = history
        .iter()
        .map(|m| ChatTurn {
            role: m.role.as_str(),
            content: m.content.as_str(),
        })
        .collect();
    turns.push(ChatTurn {
        role: "user",
        content: &prompt,
    });

    record_ai_outbound(&app, &provider, endpoint);

    let answer = dispatch::send_stream(&cache, &provider, &model, &turns, |text| {
        let _ = on_chunk.send(text.to_string());
    })
    .await?;

    if let Some(cid) = conversation_id {
        storage
            .append_message(cid, "assistant", &answer, Some(&provider), Some(&model))
            .map_err(|e| e.to_string())?;
    }

    Ok(answer)
}
