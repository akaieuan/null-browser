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

use crate::ai::{cache::KeyCache, dispatch, dispatch::ChatTurn};
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
    let endpoint = match dispatch::endpoint_for(&provider) {
        Ok(e) => e,
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
            let _ = on_event.send(ArtifactEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    let _ = on_event.send(ArtifactEvent::Extracted {
        title: payload.title.clone(),
        url: payload.url.clone(),
    });

    record_ai_outbound(&app, &provider, endpoint);

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

    let turns = [ChatTurn {
        role: "user",
        content: &prompt,
    }];
    let summary = match dispatch::send_stream(&cache, &provider, &model, &turns, |text| {
        let _ = on_event.send(ArtifactEvent::Chunk {
            text: text.to_string(),
        });
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = on_event.send(ArtifactEvent::Error { message: e.clone() });
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

/// Chat about the current tab with persistence + multi-turn context.
///
/// Three behaviours:
///
/// 1. **First turn of a new conversation** (`conversation_id == None`):
///    extract the page, wrap the user prompt with page context, send,
///    return the answer. Caller decides whether to start persisting.
/// 2. **First turn of a persisted conversation** (`conversation_id ==
///    Some(_)`, no prior messages): same as above, but persist the user
///    turn (with page context) and the assistant reply.
/// 3. **Follow-up turn** (`conversation_id == Some(_)`, prior messages
///    exist): skip extraction, send the full history + the new plain
///    user message. The model already has the page context from turn 1.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_with_page(
    app: AppHandle,
    cache: State<'_, KeyCache>,
    storage: State<'_, Storage>,
    registry: State<'_, ExtractRegistry>,
    extract_cache: State<'_, ExtractCache>,
    tab_id: String,
    provider: String,
    model: String,
    prompt: String,
    conversation_id: Option<i64>,
    on_event: Channel<ChatEvent>,
) -> Result<String, String> {
    let endpoint = match dispatch::endpoint_for(&provider) {
        Ok(e) => e,
        Err(msg) => {
            let _ = on_event.send(ChatEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    };

    let history = match conversation_id {
        Some(cid) => storage.list_messages(cid).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };
    let is_first_turn = history.is_empty();

    // Only extract on the first turn — once the page is in the
    // conversation, the model carries it.
    let user_content = if is_first_turn {
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
                        let _ = on_event.send(ChatEvent::Error { message: e.clone() });
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

        format!(
            "You are answering questions about this web page. Use it as your \
             primary source. If the question is unrelated, answer generally \
             and note that.\n\n\
             Title: {title}\nURL: {url}\n\n---\n{body}\n---\n\nQuestion: {q}",
            title = payload.title,
            url = strip_url_query(&payload.url),
            body = payload.markdown,
            q = prompt,
        )
    } else {
        prompt.clone()
    };

    // Persist user turn before the call so it survives a hard kill mid-stream.
    if let Some(cid) = conversation_id {
        if let Err(e) =
            storage.append_message(cid, "user", &user_content, Some(&provider), Some(&model))
        {
            let msg = e.to_string();
            let _ = on_event.send(ChatEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
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
        content: &user_content,
    });

    record_ai_outbound(&app, &provider, endpoint);

    let answer = match dispatch::send_stream(&cache, &provider, &model, &turns, |text| {
        let _ = on_event.send(ChatEvent::Chunk {
            text: text.to_string(),
        });
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    if let Some(cid) = conversation_id {
        if let Err(e) =
            storage.append_message(cid, "assistant", &answer, Some(&provider), Some(&model))
        {
            // Don't fail the whole call — the user already saw the
            // streamed answer. Log via the error channel and move on.
            let _ = on_event.send(ChatEvent::Error {
                message: format!("save failed: {e}"),
            });
        }
    }

    let _ = on_event.send(ChatEvent::Done);
    Ok(answer)
}
