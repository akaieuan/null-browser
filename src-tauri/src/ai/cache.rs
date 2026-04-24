//! In-process cache for provider keys read out of the OS keychain.
//!
//! The keychain is the source of truth and the trust boundary. But every
//! `SecItemCopyMatching` call is an ACL check, which on unsigned dev
//! builds and on first run of a signed app triggers a user prompt.
//! Calling it per-message is abusive; calling it per-UI-mount is
//! annoying. So we read once, keep the key in memory for the life of the
//! process, and use it from there.
//!
//! The key is only in memory for as long as the app is running anyway
//! (every HTTP call needs it in plaintext to set `x-api-key`). Caching
//! does not extend the exposure window meaningfully.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::ai::secrets;

#[derive(Default)]
pub struct KeyCache {
    /// Missing entry = not yet checked.
    /// `Some(None)` = checked, no key stored.
    /// `Some(Some(k))` = checked, `k` is the key.
    entries: Mutex<HashMap<String, Option<String>>>,
}

impl KeyCache {
    pub fn get(&self, provider: &str) -> Result<Option<String>, String> {
        {
            let map = self.entries.lock().map_err(|e| e.to_string())?;
            if let Some(entry) = map.get(provider) {
                return Ok(entry.clone());
            }
        }
        let key = secrets::get_key(provider)?;
        let mut map = self.entries.lock().map_err(|e| e.to_string())?;
        map.insert(provider.to_string(), key.clone());
        Ok(key)
    }

    pub fn set(&self, provider: &str, key: &str) -> Result<(), String> {
        secrets::set_key(provider, key)?;
        let mut map = self.entries.lock().map_err(|e| e.to_string())?;
        map.insert(provider.to_string(), Some(key.to_string()));
        Ok(())
    }
}
