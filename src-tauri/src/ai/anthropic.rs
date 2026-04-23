//! Anthropic cloud provider. Opt-in, user-supplied API key.
//!
//! Keys live in the OS keychain via the `keyring` crate. Every call
//! to this provider passes through the permission broker first.
