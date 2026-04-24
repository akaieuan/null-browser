//! OS keychain access for provider API keys.
//!
//! Keys are namespaced under the "sh.null.browser" service and keyed by
//! provider identifier ("anthropic", "openai"). The keyring crate picks
//! the OS-native store: Keychain on macOS, Secret Service on Linux,
//! Credential Manager on Windows. Nothing touches SQLite or disk files.

use keyring::Entry;

const SERVICE: &str = "sh.null.browser";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

pub fn set_key(provider: &str, key: &str) -> Result<(), String> {
    entry(provider)?
        .set_password(key)
        .map_err(|e| e.to_string())
}

pub fn get_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[allow(dead_code)]
pub fn clear_key(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
