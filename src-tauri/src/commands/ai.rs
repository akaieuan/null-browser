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

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ai::{cache::KeyCache, dispatch, ollama};
use crate::network::record_ai_outbound;

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
pub async fn ai_send(
    app: AppHandle,
    cache: State<'_, KeyCache>,
    provider: String,
    model: String,
    prompt: String,
    on_chunk: Channel<String>,
) -> Result<String, String> {
    let endpoint = dispatch::endpoint_for(&provider)?;
    record_ai_outbound(&app, &provider, endpoint);
    dispatch::send_stream(&cache, &provider, &model, &prompt, |text| {
        let _ = on_chunk.send(text.to_string());
    })
    .await
}
