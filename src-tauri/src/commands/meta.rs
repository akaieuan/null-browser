//! Meta commands: app version, about, build info.

/// Returns the package version from `Cargo.toml` at compile time.
#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
