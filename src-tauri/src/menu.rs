use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const THEME_EVENT: &str = "theme-set";
const THEME_ID_PREFIX: &str = "theme:";

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

    let t_charcoal = MenuItem::with_id(app, "theme:charcoal", "Charcoal", true, None::<&str>)?;
    let t_slate = MenuItem::with_id(app, "theme:slate", "Slate", true, None::<&str>)?;
    let t_sand = MenuItem::with_id(app, "theme:sand", "Sand", true, None::<&str>)?;
    let t_paper = MenuItem::with_id(app, "theme:paper", "Paper", true, None::<&str>)?;
    let t_four_am = MenuItem::with_id(app, "theme:0400am", "0400AM", true, None::<&str>)?;
    let t_mudd = MenuItem::with_id(app, "theme:mudd", "Mudd", true, None::<&str>)?;
    let t_cyber = MenuItem::with_id(app, "theme:cyberspace", "Cyberspace", true, None::<&str>)?;

    let theme_submenu = Submenu::with_items(
        app,
        "Theme",
        true,
        &[
            &t_charcoal,
            &t_slate,
            &t_sand,
            &t_paper,
            &t_four_am,
            &t_mudd,
            &t_cyber,
        ],
    )?;

    let view_submenu = Submenu::with_items(app, "View", true, &[&theme_submenu])?;

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
    if let Some(theme) = id.strip_prefix(THEME_ID_PREFIX) {
        let _ = app.emit(THEME_EVENT, theme);
    }
}
