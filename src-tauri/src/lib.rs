use tauri::{http, Manager, Url};

pub mod commands;
pub mod dock;
pub mod favicons;
pub mod menu;
pub mod network;
pub mod notes;
pub mod permissions;
pub mod search;
pub mod settings;
pub mod storage;
pub mod webview;

/// URLs the privileged `main` webview may load: the bundled shell
/// (tauri://localhost on macOS/Linux, http(s)://tauri.localhost on
/// Windows), about:blank, and the Vite dev server in dev builds.
/// Everything else — including remote links surfaced inside the shell
/// (artifact markdown, search results) — must open in a tab webview,
/// never navigate the shell itself.
fn is_shell_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(dev) && url.host_str() == Some("localhost"))
        }
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    // Tab webviews host arbitrary web content; their own
                    // on_navigation callback applies the user's blocklist.
                    if webview.label().starts_with("tab-") {
                        return true;
                    }
                    // Popup windows (window.open with dimensions) are
                    // the same trust class as tabs: web only, never the
                    // shell, no capabilities.
                    if webview.label().starts_with("popup-") {
                        return matches!(url.scheme(), "http" | "https" | "about");
                    }
                    is_shell_url(url)
                })
                .build(),
        )
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
                    Some("jserr") => {
                        for (k, v) in parsed.query_pairs() {
                            if k == "d" {
                                eprintln!("null-tab-error: {v}");
                            }
                        }
                    }
                    Some("favicon") => {
                        // Second caller on this channel — validation
                        // lives entirely in favicons::ingest.
                        let mut origin: Option<String> = None;
                        let mut data: Option<String> = None;
                        for (k, v) in parsed.query_pairs() {
                            match k.as_ref() {
                                "u" => origin = Some(v.into_owned()),
                                "d" => data = Some(v.into_owned()),
                                _ => {}
                            }
                        }
                        if let (Some(o), Some(d)) = (origin, data) {
                            favicons::ingest(ctx.app_handle(), &o, &d);
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
            // Vibrancy behind everything. window-vibrancy inserts its
            // NSVisualEffectView at the very back of the content view
            // (NSWindowOrderingMode::Below), and wry appends every tab
            // webview to the front — so the blur sits under the
            // translucent chrome while pages stay opaque cards on top.
            // What it stores / transmits / remembers: nothing; this is
            // compositing, not data.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                // Sidebar material follows the window's appearance,
                // which `applyTheme` keeps in sync with the palette
                // mode via `setTheme`.
                let _ = window_vibrancy::apply_vibrancy(
                    &window,
                    // UnderWindowBackground, not Sidebar: it samples the
                    // actual desktop behind the window with a deep blur —
                    // the whole point of the glass. Sidebar-material is a
                    // near-opaque tint that reads as flat gray.
                    window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                    Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                    None,
                );

                // macOS 26 broke wry's config-level transparency (see
                // force_shell_transparent). Re-assert after the webview
                // exists — and again after a beat, because WebKit can
                // re-resolve its background on first paint.
                {
                    let handle = app.handle().clone();
                    webview::force_shell_transparent(&handle);
                    let handle2 = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        webview::force_shell_transparent(&handle2);
                    });
                }

            }
            // TEMP probe: auto-open two tabs from the shell and report
            // the favicon table after they load. CLI-run only.
            if std::env::var("NULL_FAVICON_PROBE").is_ok() {
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if let Some(shell) = h.get_webview("main") {
                        for (i, u) in ["https://akabuild.dev/", "https://www.youtube.com/"]
                            .iter()
                            .enumerate()
                        {
                            let js = format!(
                                "window.__TAURI_INTERNALS__.invoke('open_tab',{{id:'probe{i}',url:'{u}',rect:{{left:300,top:48,width:900,height:700}}}})"
                            );
                            eprintln!("null-favicon: probe opening {u}: {:?}", shell.eval(&js));
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(12));
                    if let Some(st) = h.try_state::<storage::Storage>() {
                        match st.list_favicons() {
                            Ok(rows) => eprintln!(
                                "null-favicon: table now has {} rows: {:?}",
                                rows.len(),
                                rows.iter().map(|r| r.origin.clone()).collect::<Vec<_>>()
                            ),
                            Err(e) => eprintln!("null-favicon: list error {e}"),
                        }
                    }
                });
            }

            let storage = storage::Storage::open();
            notes::backfill(&storage);
            notes::dedupe(&storage);
            app.manage(storage);
            app.manage(network::NetworkState::default());
            app.manage(webview::extract::ExtractRegistry::default());
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
            commands::tabs::activate_tabs,
            commands::tabs::set_tab_corner_radius,
            commands::tabs::set_tab_zoom,
            commands::tabs::open_tab_devtools,
            commands::tabs::close_tab,
            commands::tabs::activate_tab,
            commands::tabs::hide_all_tabs,
            commands::tabs::navigate_tab,
            commands::tabs::resize_content,
            commands::tabs::go_back,
            commands::tabs::go_forward,
            commands::tabs::reload,
            commands::tabs::clear_tab_storage,
            commands::tabs::focus_shell,
            commands::bookmarks::list_bookmarks,
            commands::bookmarks::add_bookmark,
            commands::bookmarks::remove_bookmark,
            commands::bookmarks::update_bookmark,
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
            commands::artifacts::list_artifacts,
            commands::artifacts::get_artifact,
            commands::artifacts::delete_artifact,
            commands::artifacts::save_current_tab,
            commands::artifacts::clip_selection,
            commands::artifacts::get_notes_dir,
            commands::artifacts::create_note,
            commands::artifacts::update_note,
            commands::favicons::get_favicons,
            commands::bookmarks::group_bookmarks,
            commands::bookmarks::move_bookmark,
            commands::meta::set_window_theme,
            commands::meta::set_glass_material,
            commands::search::search_get_instance,
            commands::search::search_set_instance,
            commands::search::search_clear_instance,
            commands::search::search_web,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
