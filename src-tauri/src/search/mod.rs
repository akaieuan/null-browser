//! Web search providers. One provider implemented today: SearXNG.
//!
//! Search is opt-in per invariant 2 — nothing ships pre-configured.
//! The user supplies their own instance URL (self-hosted or a public
//! SearXNG they trust). The query string is the only thing that
//! leaves the device; no page content, no AI processing, no tracking
//! params of our own.

use serde::{Deserialize, Serialize};

/// Normalized shape the UI renders, regardless of underlying provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Deserialize)]
struct SearxngResponse {
    #[serde(default)]
    results: Vec<SearxngResult>,
}

#[derive(Deserialize)]
struct SearxngResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
}

/// Query a SearXNG instance. `instance_url` should be the root (e.g.
/// `https://searx.example.com`); the `/search` path is appended.
pub async fn searxng_search(
    instance_url: &str,
    query: &str,
) -> Result<Vec<SearchResult>, String> {
    let base = instance_url.trim_end_matches('/');
    let endpoint = format!("{base}/search");
    let res = reqwest::Client::new()
        .get(&endpoint)
        .query(&[("q", query), ("format", "json")])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("search returned {status}: {text}"));
    }

    let parsed: SearxngResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .results
        .into_iter()
        .map(|r| SearchResult {
            title: r.title,
            url: r.url,
            snippet: r.content,
        })
        .collect())
}

/// The endpoint root we record to the network inspector before the
/// request fires. We log the instance, not the query — the query is
/// not our data to keep around.
pub fn searxng_endpoint(instance_url: &str) -> String {
    let base = instance_url.trim_end_matches('/');
    format!("{base}/search")
}
