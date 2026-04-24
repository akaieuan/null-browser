use tauri::{http, Manager, Url};

pub mod ai;
pub mod commands;
pub mod dock;
pub mod menu;
pub mod network;
pub mod permissions;
pub mod search;
pub mod settings;
pub mod storage;
pub mod webview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("null-event", |ctx, request| {
            // One-way tab→Rust beacon, both routes are Image-based GETs.
            //   null-event://log?d=<urlencoded-json>           — subresource observer
            //   null-event://artifact?r=<id>&i=<k>&n=<t>&d=<s> — extraction chunk
            // Both return 200 with open CORS so the injected Image
            // isn't rejected by the page.
            let uri_str = request.uri().to_string();
            if let Ok(parsed) = Url::parse(&uri_str) {
                match parsed.host_str() {
                    Some("log") => {
                        for (k, v) in parsed.query_pairs() {
                            if k == "d" {
                                if let Ok(record) =
                                    serde_json::from_str::<network::SubresourceRecord>(&v)
                                {
                                    network::record_subresource(
                                        ctx.app_handle(),
                                        &record.url,
                                        &record.initiator,
                                    );
                                }
                            }
                        }
                    }
                    Some("artifact") => {
                        let mut req_id: Option<String> = None;
                        let mut index: Option<u32> = None;
                        let mut total: Option<u32> = None;
                        let mut data: Option<String> = None;
                        for (k, v) in parsed.query_pairs() {
                            match k.as_ref() {
                                "r" => req_id = Some(v.into_owned()),
                                "i" => index = v.parse().ok(),
                                "n" => total = v.parse().ok(),
                                "d" => data = Some(v.into_owned()),
                                _ => {}
                            }
                        }
                        if let (Some(r), Some(i), Some(n), Some(d)) = (req_id, index, total, data) {
                            if let Some(reg) = ctx
                                .app_handle()
                                .try_state::<webview::extract::ExtractRegistry>()
                            {
                                reg.ingest_chunk(&r, i, n, &d);
                            }
                        }
                    }
                    _ => {}
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
            app.manage(ai::cache::KeyCache::default());
            app.manage(webview::extract::ExtractRegistry::default());
            app.manage(webview::extract::ExtractCache::default());
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
            commands::bookmarks::update_bookmark,
            commands::bookmarks::remove_bookmark_by_url,
            commands::bookmarks::reorder_bookmarks,
            commands::bookmarks::show_bookmark_menu,
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
            commands::ai::ai_set_key,
            commands::ai::ai_provider_status,
            commands::ai::ai_send,
            commands::artifacts::list_artifacts,
            commands::artifacts::get_artifact,
            commands::artifacts::delete_artifact,
            commands::artifacts::summarize_current_tab,
            commands::artifacts::save_current_tab,
            commands::artifacts::chat_with_page,
            commands::search::search_get_instance,
            commands::search::search_set_instance,
            commands::search::search_clear_instance,
            commands::search::search_web,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
