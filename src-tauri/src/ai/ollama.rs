//! Local Ollama provider. Talks to `127.0.0.1:11434`.
//!
//! Ollama is the AI provider that should run by default — no keychain
//! access, no API key, no cloud round-trip. If the daemon is running we
//! use it; if it isn't, the drawer surfaces install instructions and
//! the rest of the browser keeps working.
//!
//! Two transports differ from the Anthropic path:
//!   - `/api/tags` is a plain JSON GET for model discovery
//!   - `/api/chat` streams NDJSON, not SSE — each line is a complete
//!     `{message: {content}, done}` object
//!
//! Status probes time out aggressively (800ms) so the drawer never
//! stalls on a missing daemon.

use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::ai::dispatch::ChatTurn;

pub const CHAT_ENDPOINT: &str = "http://127.0.0.1:11434/api/chat";
pub const TAGS_ENDPOINT: &str = "http://127.0.0.1:11434/api/tags";

const STATUS_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatChunk {
    message: Option<ChunkMessage>,
    #[serde(default)]
    done: bool,
}

#[derive(Deserialize)]
struct ChunkMessage {
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<ModelInfo>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ModelInfo {
    pub name: String,
}

#[derive(Serialize, Clone, Default)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<ModelInfo>,
}

/// Probe the local Ollama daemon. Returns `running: false` for any
/// failure (daemon down, port collision, firewall, JSON shape mismatch
/// from a non-Ollama service squatting on 11434). Ollama not running is
/// a normal state — never log, never error.
pub async fn status() -> OllamaStatus {
    let Ok(client) = reqwest::Client::builder().timeout(STATUS_TIMEOUT).build() else {
        return OllamaStatus::default();
    };

    let Ok(res) = client.get(TAGS_ENDPOINT).send().await else {
        return OllamaStatus::default();
    };
    if !res.status().is_success() {
        return OllamaStatus::default();
    }
    let Ok(tags) = res.json::<TagsResponse>().await else {
        // Something is on 11434 but it isn't Ollama — treat as "not running"
        // so we don't pretend a random service is a model server.
        return OllamaStatus::default();
    };
    OllamaStatus {
        running: true,
        models: tags.models,
    }
}

/// Stream a completion from the local Ollama daemon, calling `on_text`
/// with each content delta as it arrives. Returns the full assembled
/// response on completion.
///
/// NDJSON transport (newline-delimited JSON), distinct from Anthropic's
/// SSE. Each line is a complete `{message: {content}, done}` object.
pub async fn send_stream<F>(
    model: &str,
    turns: &[ChatTurn<'_>],
    mut on_text: F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    let body = ChatRequest {
        model,
        messages: turns
            .iter()
            .map(|t| ChatMessage {
                role: t.role,
                content: t.content,
            })
            .collect(),
        stream: true,
    };

    let res = reqwest::Client::new()
        .post(CHAT_ENDPOINT)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama not reachable: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.map_err(|e| e.to_string())?;
        return Err(format!("{status}: {text}"));
    }

    let mut stream = res.bytes_stream();
    let mut buffer = String::new();
    let mut full = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(boundary) = buffer.find('\n') {
            let line: String = buffer.drain(..boundary + 1).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(evt) = serde_json::from_str::<ChatChunk>(line) else {
                continue;
            };
            if let Some(msg) = evt.message {
                if !msg.content.is_empty() {
                    on_text(&msg.content);
                    full.push_str(&msg.content);
                }
            }
            if evt.done {
                return Ok(full);
            }
        }
    }

    Ok(full)
}
