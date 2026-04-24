//! Anthropic cloud provider. Opt-in, user-supplied API key.
//!
//! Keys live in the OS keychain via the `keyring` crate. This module is a
//! pure HTTP client — the command layer is responsible for reading the
//! key, recording the call in the network inspector, and dispatching.

use serde::{Deserialize, Serialize};

pub const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Serialize)]
struct Request<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<Message<'a>>,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct Response {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

pub async fn send(key: &str, model: &str, prompt: &str) -> Result<String, String> {
    let body = Request {
        model,
        max_tokens: 1024,
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
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {text}"));
    }

    let parsed: Response = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    parsed
        .content
        .into_iter()
        .find(|b| b.kind == "text")
        .and_then(|b| b.text)
        .ok_or_else(|| "no text content in response".to_string())
}
