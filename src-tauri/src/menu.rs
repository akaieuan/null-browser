//! The app menu, and the app's keyboard map.
//!
//! Every shortcut is a native menu accelerator rather than a `keydown`
//! listener in the shell webview. That is not a stylistic choice: the
//! shell and each browser tab are separate native webviews, so a
//! listener in the shell stops receiving keys the moment the user
//! clicks into a page — which is exactly when Reload and Back matter.
//! Accelerators reach the app regardless of which webview holds focus.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

pub const PALETTE_EVENT: &str = "palette-set";
pub const MODE_EVENT: &str = "mode-set";
pub const BOOKMARK_MENU_EVENT: &str = "bookmark-menu-action";
/// Carries a menu action id (the part after `act:`) to the shell.
pub const MENU_ACTION_EVENT: &str = "menu-action";

const PALETTE_PREFIX: &str = "palette:";
const MODE_PREFIX: &str = "mode:";
const BOOKMARK_PREFIX: &str = "bmk:";
const ACTION_PREFIX: &str = "act:";

/// One accelerator-carrying menu item.
fn action<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, format!("{ACTION_PREFIX}{id}"), label, true, accel)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_submenu = Submenu::with_items(
        app,
        "Null",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            // The Mac convention puts Settings in the app menu, not View.
            &action(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // `PredefinedMenuItem::close_window` hardcodes ⌘W with no override,
    // so it is not used here: ⌘W is Close Tab, as in Safari, and Close
    // Window moves to ⇧⌘W.
    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &action(app, "new_tab", "New Tab", Some("CmdOrCtrl+T"))?,
            &action(app, "new_note", "New Note", Some("CmdOrCtrl+N"))?,
            &action(app, "close_tab", "Close Tab", Some("CmdOrCtrl+W"))?,
            &action(
                app,
                "close_window",
                "Close Window",
                Some("Shift+CmdOrCtrl+W"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &action(
                app,
                "clip_page",
                "New Note from Page",
                Some("Shift+CmdOrCtrl+C"),
            )?,
            &action(
                app,
                "clip_selection",
                "New Note from Selection",
                Some("Ctrl+Shift+CmdOrCtrl+C"),
            )?,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let p_aka = MenuItem::with_id(app, "palette:aka", "aka", true, None::<&str>)?;
    let p_slate = MenuItem::with_id(app, "palette:slate", "Slate", true, None::<&str>)?;
    let p_sand = MenuItem::with_id(app, "palette:sand", "Sand", true, None::<&str>)?;
    let p_four_am = MenuItem::with_id(app, "palette:0400am", "0400AM", true, None::<&str>)?;
    let p_mudd = MenuItem::with_id(app, "palette:mudd", "Mudd", true, None::<&str>)?;
    let p_cyber = MenuItem::with_id(app, "palette:cyberspace", "Cyberspace", true, None::<&str>)?;
    let theme_submenu = Submenu::with_items(
        app,
        "Theme",
        true,
        &[&p_aka, &p_slate, &p_sand, &p_four_am, &p_mudd, &p_cyber],
    )?;

    let m_light = MenuItem::with_id(app, "mode:light", "Light", true, None::<&str>)?;
    let m_dark = MenuItem::with_id(app, "mode:dark", "Dark", true, None::<&str>)?;
    let appearance_submenu = Submenu::with_items(app, "Appearance", true, &[&m_light, &m_dark])?;

    let view_submenu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &action(
                app,
                "toggle_sidebar",
                "Hide Sidebar",
                Some("Ctrl+CmdOrCtrl+S"),
            )?,
            &action(
                app,
                "toggle_split",
                "Split With Next Tab",
                Some("Alt+CmdOrCtrl+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "open_location", "Open Location…", Some("CmdOrCtrl+L"))?,
            &action(app, "reload", "Reload", Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::separator(app)?,
            // ⌘+ is physically ⌘= on ANSI keyboards; registering "="
            // is what every macOS browser actually binds.
            &action(app, "zoom_in", "Zoom In", Some("CmdOrCtrl+="))?,
            &action(app, "zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &action(app, "zoom_reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "clips", "Notes", Some("CmdOrCtrl+/"))?,
            &action(
                app,
                "network",
                "Network Inspector",
                Some("Shift+CmdOrCtrl+I"),
            )?,
            &action(
                app,
                "web_inspector",
                "Web Inspector",
                Some("Alt+CmdOrCtrl+I"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &theme_submenu,
            &appearance_submenu,
        ],
    )?;

    let history_submenu = Submenu::with_items(
        app,
        "History",
        true,
        &[
            &action(app, "back", "Back", Some("CmdOrCtrl+["))?,
            &action(app, "forward", "Forward", Some("CmdOrCtrl+]"))?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "history", "Show All History", Some("CmdOrCtrl+Y"))?,
        ],
    )?;

    let bookmarks_submenu = Submenu::with_items(
        app,
        "Bookmarks",
        true,
        &[&action(
            app,
            "bookmark",
            "Add Bookmark",
            Some("CmdOrCtrl+D"),
        )?],
    )?;

    let window_submenu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "next_tab", "Next Tab", Some("Ctrl+Tab"))?,
            &action(app, "prev_tab", "Previous Tab", Some("Ctrl+Shift+Tab"))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &history_submenu,
            &bookmarks_submenu,
            &window_submenu,
        ],
    )
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id: &str = event.id().as_ref();
    if let Some(palette) = id.strip_prefix(PALETTE_PREFIX) {
        let _ = app.emit(PALETTE_EVENT, palette);
    } else if let Some(mode) = id.strip_prefix(MODE_PREFIX) {
        let _ = app.emit(MODE_EVENT, mode);
    } else if let Some(rest) = id.strip_prefix(BOOKMARK_PREFIX) {
        // id format: bmk:<action>:<bookmark_id>
        let mut parts = rest.splitn(2, ':');
        let action = parts.next().unwrap_or("").to_string();
        let bookmark_id: i64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let _ = app.emit(
            BOOKMARK_MENU_EVENT,
            serde_json::json!({ "action": action, "id": bookmark_id }),
        );
    } else if let Some(action) = id.strip_prefix(ACTION_PREFIX) {
        if action == "close_window" {
            if let Some(w) = app.get_window("main") {
                let _ = w.close();
            }
            return;
        }
        // Actions whose handler focuses a DOM node need the shell to hold
        // the first responder first, or the keystrokes land in the page
        // and the focus ring is painted on a field that never receives
        // them.
        if matches!(action, "open_location" | "new_tab") {
            let _ = crate::webview::focus_shell_any(app);
        }
        // emit_to the shell, never emit — an accelerator must not leak
        // into tab webviews.
        let _ = app.emit_to(EventTarget::webview("main"), MENU_ACTION_EVENT, action);
    }
}
