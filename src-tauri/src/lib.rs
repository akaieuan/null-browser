use tauri::{http, Manager, Url};

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
        .register_uri_scheme_protocol("null-event", |ctx, request| {
            // Beacon endpoint for the injected subresource observer. The
            // full URL is null-event://log?d=<urlencoded-json>. Parse the
            // d param and record the event; return 200 with open CORS so
            // the injected fetch/Image isn't rejected by the page.
            let uri_str = request.uri().to_string();
            if let Ok(parsed) = Url::parse(&uri_str) {
                for (k, v) in parsed.query_pairs() {
                    if k == "d" {
                        if let Ok(record) = serde_json::from_str::<network::SubresourceRecord>(&v) {
                            network::record_subresource(
                                ctx.app_handle(),
                                &record.url,
                                &record.initiator,
                            );
                        }
                    }
                }
            }
            http::Response::builder()
                .status(200)
                .header("Access-Control-Allow-Origin", "*")
                .header("Cache-Control", "no-store")
                .body(Vec::<u8>::new())
                .unwrap()
        })
        .setup(|app| {
            dock::set_icon();
            app.manage(storage::Storage::open());
            app.manage(network::NetworkState::default());
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
            commands::tabs::clear_tab_storage,
            commands::bookmarks::list_bookmarks,
            commands::bookmarks::add_bookmark,
            commands::bookmarks::remove_bookmark,
            commands::bookmarks::remove_bookmark_by_url,
            commands::bookmarks::reorder_bookmarks,
            commands::history::list_history,
            commands::history::add_history,
            commands::history::remove_history,
            commands::history::clear_history,
            commands::network::list_network_events,
            commands::network::clear_network_events,
            commands::network::set_network_paused,
            commands::network::network_is_paused,
            commands::network::block_origin,
            commands::network::unblock_origin,
            commands::network::list_blocked_origins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
