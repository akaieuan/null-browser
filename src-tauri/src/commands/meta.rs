//! Meta commands: app version, about, build info.

use tauri::{AppHandle, Manager, Theme};

/// Returns the package version from `Cargo.toml` at compile time.
#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Swap the vibrancy material under the window.
///
/// The material contributes its own scrim on top of the blur, and that
/// scrim — not the CSS tint — is what decides whether the window reads
/// as glass or as fog. `UnderWindowBackground` (the launch default)
/// carries a heavy one; the materials here are the light-scrim end of
/// AppKit's range. Chosen per appearance because several are
/// inherently dark (HUD) or inherently bright (Popover).
#[tauri::command]
pub fn set_glass_material(
    app: AppHandle,
    appearance: String,
    level: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial as M, NSVisualEffectState,
        };
        let Some(window) = app.get_window("main") else {
            return Ok(());
        };
        // Re-applying without clearing stacks a second effect view —
        // two scrims, twice the fog.
        let _ = clear_vibrancy(&window);
        if level == "solid" {
            return Ok(());
        }
        let material = match (appearance.as_str(), level.as_str()) {
            (_, "clear") => M::FullScreenUI,
            ("light", _) => M::Popover,
            _ => M::HudWindow,
        };
        apply_vibrancy(
            &window,
            material,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, appearance, level);
    Ok(())
}

/// Pin the window's native appearance to the palette's mode.
///
/// The vibrancy material renders a light or a dark variant depending on
/// the NSWindow's effective appearance — which otherwise follows the
/// *system* setting, not Null's. A light palette over the dark blur
/// variant (or vice versa) composites to the flat gray fog that made
/// the glass invisible; keeping the two in agreement is what lets a
/// thin wash read as glass.
#[tauri::command]
pub fn set_window_theme(app: AppHandle, mode: String) -> Result<(), String> {
    let theme = match mode.as_str() {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    };
    if let Some(window) = app.get_window("main") {
        window.set_theme(theme).map_err(|e| e.to_string())?;
    }
    Ok(())
}
