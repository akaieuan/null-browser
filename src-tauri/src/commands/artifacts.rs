//! Artifact CRUD and the three tab-aware orchestrators:
//!
//! - `summarize_current_tab` — extract → AI → save as `summary` artifact
//! - `save_current_tab`      — extract → save as `clip` artifact (no AI)
//! - `chat_with_page`        — extract (cached) → AI with page as context
//!
//! All three share `webview::extract::extract_tab` for the transport
//! and `record_ai_outbound` for the network inspector. The differences
//! are in the prompt and what (if anything) persists.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::ai::{anthropic, cache::KeyCache};
use crate::network::record_ai_outbound;
use crate::storage::{Artifact, Storage};
use crate::webview;
use crate::webview::extract::{strip_url_query, ExtractCache, ExtractRegistry};

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ArtifactEvent {
    Extracted { title: String, url: String },
    Chunk { text: String },
    Saved { id: i64 },
    Error { message: String },
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ChatEvent {
    Grounded { title: String, url: String },
    Chunk { text: String },
    Done,
    Error { message: String },
}

#[tauri::command]
pub fn list_artifacts(storage: State<Storage>) -> Result<Vec<Artifact>, String> {
    storage.list_artifacts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_artifact(storage: State<Storage>, id: i64) -> Result<Artifact, String> {
    storage.get_artifact(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_artifact(storage: State<Storage>, id: i64) -> Result<(), String> {
    storage.delete_artifact(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn summarize_current_tab(
    app: AppHandle,
    cache: State<'_, KeyCache>,
    storage: State<'_, Storage>,
    registry: State<'_, ExtractRegistry>,
    tab_id: String,
    provider: String,
    model: String,
    focus: Option<String>,
    on_event: Channel<ArtifactEvent>,
) -> Result<i64, String> {
    let key = match require_provider_key(&cache, &provider) {
        Ok(k) => k,
        Err(msg) => {
            let _ = on_event.send(ArtifactEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    };

    let payload = match webview::extract::extract_tab(&app, &registry, &tab_id).await {
        Ok(p) => p,
        Err(e) => {
            let _ = on_event.send(ArtifactEvent::Error {
                message: e.clone(),
            });
            return Err(e);
        }
    };

    let _ = on_event.send(ArtifactEvent::Extracted {
        title: payload.title.clone(),
        url: payload.url.clone(),
    });

    record_ai_outbound(&app, &provider, anthropic::ENDPOINT);

    let focus_line = match focus.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(f) => format!("Focus on: {f}\n\n"),
        None => String::new(),
    };
    let prompt = format!(
        "Summarize this web page as concise markdown. Keep the structure \
         (headings, lists, quotes). Don't pad, don't preface.\n\n\
         {focus_line}Title: {title}\nURL: {url}\n\n{body}",
        focus_line = focus_line,
        title = payload.title,
        url = strip_url_query(&payload.url),
        body = payload.markdown,
    );

    let summary = match anthropic::send_stream(&key, &model, &prompt, |text| {
        let _ = on_event.send(ArtifactEvent::Chunk {
            text: text.to_string(),
        });
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = on_event.send(ArtifactEvent::Error {
                message: e.clone(),
            });
            return Err(e);
        }
    };

    let artifact = match storage.insert_artifact(
        "summary",
        &payload.title,
        &payload.url,
        Some(&payload.title),
        &summary,
        &format!("{provider}:{model}"),
    ) {
        Ok(a) => a,
        Err(e) => {
            let msg = e.to_string();
            let _ = on_event.send(ArtifactEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    };

    let _ = on_event.send(ArtifactEvent::Saved { id: artifact.id });
    Ok(artifact.id)
}

#[tauri::command]
pub async fn save_current_tab(
    app: AppHandle,
    storage: State<'_, Storage>,
    registry: State<'_, ExtractRegistry>,
    tab_id: String,
) -> Result<i64, String> {
    let payload = webview::extract::extract_tab(&app, &registry, &tab_id).await?;
    let artifact = storage
        .insert_artifact(
            "clip",
            &payload.title,
            &payload.url,
            Some(&payload.title),
            &payload.markdown,
            "none",
        )
        .map_err(|e| e.to_string())?;
    Ok(artifact.id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_with_page(
    app: AppHandle,
    cache: State<'_, KeyCache>,
    registry: State<'_, ExtractRegistry>,
    extract_cache: State<'_, ExtractCache>,
    tab_id: String,
    provider: String,
    model: String,
    prompt: String,
    on_event: Channel<ChatEvent>,
) -> Result<String, String> {
    let key = match require_provider_key(&cache, &provider) {
        Ok(k) => k,
        Err(msg) => {
            let _ = on_event.send(ChatEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    };

    // Cache hit path: skip extraction if the tab is still on the same
    // URL we grounded on within the TTL.
    let current_url = webview::current_tab_url(&app, &tab_id).ok();
    let payload = match current_url
        .as_deref()
        .and_then(|u| extract_cache.get_fresh(&tab_id, u))
    {
        Some(p) => p,
        None => {
            let p = match webview::extract::extract_tab(&app, &registry, &tab_id).await {
                Ok(p) => p,
                Err(e) => {
                    let _ = on_event.send(ChatEvent::Error {
                        message: e.clone(),
                    });
                    return Err(e);
                }
            };
            if let Some(url) = current_url {
                extract_cache.put(tab_id.clone(), url, p.clone());
            }
            p
        }
    };

    let _ = on_event.send(ChatEvent::Grounded {
        title: payload.title.clone(),
        url: payload.url.clone(),
    });

    record_ai_outbound(&app, &provider, anthropic::ENDPOINT);

    let full_prompt = format!(
        "You are answering questions about this web page. Use it as your \
         primary source. If the question is unrelated, answer generally \
         and note that.\n\n\
         Title: {title}\nURL: {url}\n\n---\n{body}\n---\n\nQuestion: {q}",
        title = payload.title,
        url = strip_url_query(&payload.url),
        body = payload.markdown,
        q = prompt,
    );

    let answer = match anthropic::send_stream(&key, &model, &full_prompt, |text| {
        let _ = on_event.send(ChatEvent::Chunk {
            text: text.to_string(),
        });
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error {
                message: e.clone(),
            });
            return Err(e);
        }
    };

    let _ = on_event.send(ChatEvent::Done);
    Ok(answer)
}

fn require_provider_key(cache: &KeyCache, provider: &str) -> Result<String, String> {
    if provider != "anthropic" {
        return Err(format!("provider not implemented: {provider}"));
    }
    match cache.get(provider) {
        Ok(Some(k)) => Ok(k),
        Ok(None) => Err(format!("no key stored for {provider}")),
        Err(e) => Err(e),
    }
}
