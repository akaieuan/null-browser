//! AI router commands: store provider keys, run cloud calls.
//!
//! Every cloud call is recorded in the network inspector before the
//! request leaves the device, honoring the "every outbound connection
//! is visible" invariant. Keys are stored in the OS keychain and never
//! returned to the frontend.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ai::{anthropic, cache::KeyCache};
use crate::network::record_ai_outbound;

#[derive(Serialize)]
pub struct ProviderStatus {
    pub anthropic: bool,
    pub openai: bool,
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
pub fn ai_provider_status(cache: State<KeyCache>) -> Result<ProviderStatus, String> {
    Ok(ProviderStatus {
        anthropic: cache.get("anthropic")?.is_some(),
        openai: cache.get("openai")?.is_some(),
    })
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
    let key = cache
        .get(&provider)?
        .ok_or_else(|| format!("no key stored for {provider}"))?;

    let endpoint = match provider.as_str() {
        "anthropic" => anthropic::ENDPOINT,
        _ => return Err(format!("provider not implemented: {provider}")),
    };

    record_ai_outbound(&app, &provider, endpoint);

    match provider.as_str() {
        "anthropic" => {
            anthropic::send_stream(&key, &model, &prompt, |text| {
                let _ = on_chunk.send(text.to_string());
            })
            .await
        }
        _ => Err(format!("provider not implemented: {provider}")),
    }
}
