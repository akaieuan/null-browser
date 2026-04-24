use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const PALETTE_EVENT: &str = "palette-set";
pub const MODE_EVENT: &str = "mode-set";

const PALETTE_PREFIX: &str = "palette:";
const MODE_PREFIX: &str = "mode:";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_submenu = Submenu::with_items(
        app,
        "Null",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
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

    let p_neutral = MenuItem::with_id(app, "palette:neutral", "Neutral", true, None::<&str>)?;
    let p_slate = MenuItem::with_id(app, "palette:slate", "Slate", true, None::<&str>)?;
    let p_sand = MenuItem::with_id(app, "palette:sand", "Sand", true, None::<&str>)?;
    let p_four_am = MenuItem::with_id(app, "palette:0400am", "0400AM", true, None::<&str>)?;
    let p_mudd = MenuItem::with_id(app, "palette:mudd", "Mudd", true, None::<&str>)?;
    let p_cyber = MenuItem::with_id(app, "palette:cyberspace", "Cyberspace", true, None::<&str>)?;

    let theme_submenu = Submenu::with_items(
        app,
        "Theme",
        true,
        &[&p_neutral, &p_slate, &p_sand, &p_four_am, &p_mudd, &p_cyber],
    )?;

    let m_light = MenuItem::with_id(app, "mode:light", "Light", true, None::<&str>)?;
    let m_dark = MenuItem::with_id(app, "mode:dark", "Dark", true, None::<&str>)?;

    let appearance_submenu = Submenu::with_items(app, "Appearance", true, &[&m_light, &m_dark])?;

    let view_submenu =
        Submenu::with_items(app, "View", true, &[&theme_submenu, &appearance_submenu])?;

    let window_submenu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_submenu, &edit_submenu, &view_submenu, &window_submenu],
    )
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id: &str = event.id().as_ref();
    if let Some(palette) = id.strip_prefix(PALETTE_PREFIX) {
        let _ = app.emit(PALETTE_EVENT, palette);
    } else if let Some(mode) = id.strip_prefix(MODE_PREFIX) {
        let _ = app.emit(MODE_EVENT, mode);
    }
}
