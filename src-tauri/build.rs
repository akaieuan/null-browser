fn main() {
    // Give the app an ACL manifest so the Tauri runtime actually gates
    // Null's own (non-plugin) IPC commands.
    //
    // Without a manifest the runtime skips the ACL check for app commands
    // entirely (`has_app_manifest() == false` in tauri's webview invoke
    // path), so *any* webview — including hostile page content in a
    // `tab-*` or `popup-*` child webview — can call every command via
    // `window.__TAURI_INTERNALS__.invoke(...)`. Declaring the manifest
    // flips that gate on and autogenerates an `allow-<command>` permission
    // for each command below; `capabilities/default.json` then grants those
    // permissions to the shell webview (`webviews: ["main"]`) alone.
    //
    // INVARIANT: this list must stay in lockstep with the
    // `tauri::generate_handler!` list in `src/lib.rs` and the `allow-*`
    // grants in `capabilities/default.json`. A command present in the
    // handler but missing here has no permission, so the runtime denies it
    // for *every* webview — the shell included. Keep the order identical to
    // the handler so the two lists diff line-for-line. See docs/SECURITY.md.
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_app_version",
            "open_tab",
            "activate_tabs",
            "set_tab_corner_radius",
            "set_tab_zoom",
            "find_in_page",
            "open_tab_devtools",
            "close_tab",
            "activate_tab",
            "hide_all_tabs",
            "navigate_tab",
            "resize_content",
            "go_back",
            "go_forward",
            "reload",
            "clear_tab_storage",
            "focus_shell",
            "list_bookmarks",
            "add_bookmark",
            "remove_bookmark",
            "update_bookmark",
            "reorder_bookmarks",
            "show_bookmark_menu",
            "list_history",
            "add_history",
            "remove_history",
            "clear_history",
            "list_network_events",
            "list_tracker_sightings",
            "clear_network_events",
            "set_network_paused",
            "network_is_paused",
            "block_origin",
            "unblock_origin",
            "list_blocked_origins",
            "ad_blocking_enabled",
            "set_ad_blocking",
            "list_artifacts",
            "get_artifact",
            "delete_artifact",
            "save_current_tab",
            "clip_selection",
            "get_notes_dir",
            "create_note",
            "update_note",
            "get_favicons",
            "group_bookmarks",
            "create_folder",
            "move_bookmark",
            "set_window_theme",
            "set_glass_material",
            "search_get_instance",
            "search_set_instance",
            "search_clear_instance",
            "search_web",
        ]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
