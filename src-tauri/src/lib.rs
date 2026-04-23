use tauri::Manager;

pub mod ai;
pub mod commands;
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
            app.manage(storage::Storage::open());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::meta::get_app_version,
            commands::tabs::navigate,
            commands::tabs::resize_content,
            commands::tabs::go_back,
            commands::tabs::go_forward,
            commands::tabs::reload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
