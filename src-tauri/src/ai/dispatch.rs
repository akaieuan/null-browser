//! The single place that knows how to route a streaming completion call
//! to the right provider.
//!
//! Both `commands::ai::ai_send` (raw chat) and the artifact orchestrators
//! (`chat_with_page`, `summarize_current_tab`) go through here so that
//! adding a new provider is a one-arm change in `endpoint_for` + a
//! one-arm change in `send_stream`. Network-inspector logging happens at
//! the call site, not here, because the kind/origin labelling differs by
//! caller (`ai:anthropic`, `ai:ollama`, etc).
//!
//! `ollama` is treated as keyless — no keychain lookup, no failure if
//! no key is stored. `anthropic` and `openai` go through the cache.

use crate::ai::{anthropic, cache::KeyCache, ollama};

/// One turn in a chat sequence. Borrowed so callers can build a
/// `Vec<ChatTurn>` from references into their own message list without
/// extra allocations.
#[derive(Clone, Copy)]
pub struct ChatTurn<'a> {
    /// "user" or "assistant".
    pub role: &'a str,
    pub content: &'a str,
}

/// Endpoint URL used for network-inspector logging. Returned as
/// `&'static str` so callers can log without owning a String.
pub fn endpoint_for(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok(anthropic::ENDPOINT),
        "ollama" => Ok(ollama::CHAT_ENDPOINT),
        _ => Err(format!("provider not implemented: {provider}")),
    }
}

/// Stream a completion from whichever provider is named. Cloud
/// providers fetch their key from `cache`; local providers (Ollama)
/// ignore it. The caller is responsible for `record_ai_outbound` before
/// invoking this — keep the call site honest about what's leaving the
/// device.
///
/// `turns` is the full conversation history including the new user
/// turn. Both providers (Anthropic + Ollama) accept multi-message
/// natively, so single-turn callers just pass a one-element slice.
pub async fn send_stream<F>(
    cache: &KeyCache,
    provider: &str,
    model: &str,
    turns: &[ChatTurn<'_>],
    on_text: F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    match provider {
        "anthropic" => {
            let key = cache
                .get(provider)?
                .ok_or_else(|| format!("no key stored for {provider}"))?;
            anthropic::send_stream(&key, model, turns, on_text).await
        }
        "ollama" => ollama::send_stream(model, turns, on_text).await,
        _ => Err(format!("provider not implemented: {provider}")),
    }
}
