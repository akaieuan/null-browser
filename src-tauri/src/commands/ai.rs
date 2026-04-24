//! AI router commands: store provider keys, run cloud calls.
//!
//! Every cloud call is recorded in the network inspector before the
//! request leaves the device, honoring the "every outbound connection
//! is visible" invariant. Keys are stored in the OS keychain and never
//! returned to the frontend.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Url};

use crate::ai::{anthropic, secrets};
use crate::network::{origin_of, NetworkEvent, NetworkState, NETWORK_EVENT};

#[derive(Serialize)]
pub struct ProviderStatus {
    pub anthropic: bool,
    pub openai: bool,
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    match provider.as_str() {
        "anthropic" | "openai" => {}
        _ => return Err(format!("unknown provider: {provider}")),
    }
    secrets::set_key(&provider, &key)
}

#[tauri::command]
pub fn ai_provider_status() -> Result<ProviderStatus, String> {
    Ok(ProviderStatus {
        anthropic: secrets::get_key("anthropic")?.is_some(),
        openai: secrets::get_key("openai")?.is_some(),
    })
}

#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    provider: String,
    model: String,
    prompt: String,
) -> Result<String, String> {
    let key = secrets::get_key(&provider)?
        .ok_or_else(|| format!("no key stored for {provider}"))?;

    let endpoint = match provider.as_str() {
        "anthropic" => anthropic::ENDPOINT,
        _ => return Err(format!("provider not implemented: {provider}")),
    };

    record_outbound(&app, &provider, endpoint);

    match provider.as_str() {
        "anthropic" => anthropic::send(&key, &model, &prompt).await,
        _ => Err(format!("provider not implemented: {provider}")),
    }
}

fn record_outbound(app: &AppHandle, provider: &str, endpoint: &str) {
    let Some(state) = app.try_state::<NetworkState>() else {
        return;
    };
    let Ok(url) = Url::parse(endpoint) else {
        return;
    };
    let event = NetworkEvent {
        id: 0,
        tab_id: None,
        url: url.to_string(),
        origin: origin_of(&url),
        kind: format!("ai:{provider}"),
        blocked: false,
        at: now_secs(),
    };
    if let Some(recorded) = state.record(event) {
        let _ = app.emit_to(EventTarget::webview("main"), NETWORK_EVENT, &recorded);
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
