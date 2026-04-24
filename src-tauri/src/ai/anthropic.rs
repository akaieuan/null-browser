//! Anthropic cloud provider. Opt-in, user-supplied API key.
//!
//! Keys live in the OS keychain via the `keyring` crate. This module is a
//! pure HTTP client — the command layer is responsible for reading the
//! key, recording the call in the network inspector, and dispatching.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

pub const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Serialize)]
struct Request<'a> {
    model: &'a str,
    max_tokens: u32,
    stream: bool,
    messages: Vec<Message<'a>>,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct StreamEvent {
    #[serde(rename = "type")]
    kind: String,
    delta: Option<Delta>,
}

#[derive(Deserialize)]
struct Delta {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

/// Stream a completion from Anthropic, calling `on_text` with each text
/// delta as it arrives. Returns the full assembled response on completion.
pub async fn send_stream<F>(
    key: &str,
    model: &str,
    prompt: &str,
    mut on_text: F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    let body = Request {
        model,
        max_tokens: 1024,
        stream: true,
        messages: vec![Message {
            role: "user",
            content: prompt,
        }],
    };

    let res = reqwest::Client::new()
        .post(ENDPOINT)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

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

        // SSE events are terminated by a blank line.
        while let Some(boundary) = buffer.find("\n\n") {
            let event: String = buffer.drain(..boundary + 2).collect();
            for line in event.lines() {
                let Some(data) = line.strip_prefix("data: ") else {
                    continue;
                };
                if data == "[DONE]" {
                    continue;
                }
                let Ok(evt) = serde_json::from_str::<StreamEvent>(data) else {
                    continue;
                };
                if evt.kind != "content_block_delta" {
                    continue;
                }
                let Some(delta) = evt.delta else { continue };
                if delta.kind.as_deref() != Some("text_delta") {
                    continue;
                }
                if let Some(text) = delta.text {
                    on_text(&text);
                    full.push_str(&text);
                }
            }
        }
    }

    Ok(full)
}
