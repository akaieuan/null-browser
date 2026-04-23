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
        .invoke_handler(tauri::generate_handler![
            commands::meta::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
