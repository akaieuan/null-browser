//! AI router: pick a provider, route the call, log it locally.
//!
//! The UI never talks to an AI provider directly. Every inference
//! call goes through the `Provider` trait so switching between local
//! Ollama and cloud providers is transparent to the frontend.

pub mod anthropic;
pub mod ollama;
pub mod openai;
pub mod provider;
pub mod secrets;
