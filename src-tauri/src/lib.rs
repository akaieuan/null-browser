use tauri::Manager;

pub mod ai;
pub mod commands;
pub mod dock;
pub mod menu;
pub mod network;
pub mod permissions;
pub mod settings;
pub mod storage;
pub mod webview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            dock::set_icon();
            app.manage(storage::Storage::open());
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app_handle, event| {
                menu::handle_event(app_handle, event);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::meta::get_app_version,
            commands::tabs::open_tab,
            commands::tabs::close_tab,
            commands::tabs::activate_tab,
            commands::tabs::hide_all_tabs,
            commands::tabs::navigate_tab,
            commands::tabs::resize_content,
            commands::tabs::go_back,
            commands::tabs::go_forward,
            commands::tabs::reload,
            commands::bookmarks::list_bookmarks,
            commands::bookmarks::add_bookmark,
            commands::bookmarks::remove_bookmark,
            commands::bookmarks::remove_bookmark_by_url,
            commands::bookmarks::reorder_bookmarks,
            commands::history::list_history,
            commands::history::add_history,
            commands::history::remove_history,
            commands::history::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
