//! WebView management: create, navigate, and resize the content webview.
//!
//! Null uses Tauri's multi-webview feature. The main window has two
//! webviews stacked: `main` (the React UI — address bar and future
//! tab strip at the top) and `content` (the browser tab itself,
//! positioned below the top bar). All browsing happens in `content`;
//! the React side never sees user page content.
//!
//! The content webview is created **lazily** — on the first call to
//! [`navigate`]. This sidesteps two problems at once: we never have
//! an empty blank webview floating in the UI, and we never have to
//! guess the window's final size during startup (where `inner_size`
//! isn't reliable yet).

use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, EventTarget, Manager, PhysicalPosition,
    PhysicalSize, Url, WebviewBuilder, WebviewUrl,
};

/// Label used to identify the content webview in state lookups.
pub const CONTENT_LABEL: &str = "content";

/// Height of the top bar (address bar + future tab strip), in logical pixels.
/// Duplicated in `src/App.tsx` as `TOP_BAR_HEIGHT`. Keep them in sync.
pub const TOP_BAR_HEIGHT: f64 = 44.0;

/// Event name the content webview emits to the UI whenever its URL changes.
pub const URL_CHANGED: &str = "content-url-changed";

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Navigate the content webview to `url`, creating it if it doesn't exist yet.
pub fn navigate(app: &AppHandle, url: &str) -> Result<(), String> {
    let url: Url = url.parse().map_err(s)?;

    if let Some(webview) = app.get_webview(CONTENT_LABEL) {
        webview.navigate(url).map_err(s)?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let scale = window.scale_factor().map_err(s)?;
    let inner = window.inner_size().map_err(s)?;
    let top_px = (TOP_BAR_HEIGHT * scale).round() as u32;

    let builder = WebviewBuilder::new(CONTENT_LABEL, WebviewUrl::External(url))
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = webview.app_handle().emit_to(
                    EventTarget::webview("main"),
                    URL_CHANGED,
                    payload.url().to_string(),
                );
            }
        });

    window
        .add_child(
            builder,
            PhysicalPosition::new(0i32, top_px as i32),
            PhysicalSize::new(inner.width, inner.height.saturating_sub(top_px)),
        )
        .map_err(s)?;

    Ok(())
}

/// Resize the content webview. Called from the frontend on window resize
/// with the new content-area dimensions in CSS (= logical) pixels.
/// No-op if the webview hasn't been created yet.
pub fn resize(app: &AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(webview) = app.get_webview(CONTENT_LABEL) else {
        return Ok(());
    };
    let scale = webview.window().scale_factor().map_err(s)?;
    let w = (width.max(0.0) * scale).round() as u32;
    let h = (height.max(0.0) * scale).round() as u32;
    webview.set_size(PhysicalSize::new(w, h)).map_err(s)?;
    Ok(())
}

/// Go back one entry in the content webview's history. No-op if the webview
/// doesn't exist or there's nothing to go back to.
pub fn go_back(app: &AppHandle) -> Result<(), String> {
    let Some(webview) = app.get_webview(CONTENT_LABEL) else {
        return Ok(());
    };
    webview.eval("history.back()").map_err(s)
}

/// Go forward one entry in the content webview's history. No-op if the webview
/// doesn't exist or there's nothing to go forward to.
pub fn go_forward(app: &AppHandle) -> Result<(), String> {
    let Some(webview) = app.get_webview(CONTENT_LABEL) else {
        return Ok(());
    };
    webview.eval("history.forward()").map_err(s)
}

/// Reload the current page. No-op if the webview doesn't exist.
pub fn reload(app: &AppHandle) -> Result<(), String> {
    let Some(webview) = app.get_webview(CONTENT_LABEL) else {
        return Ok(());
    };
    webview.eval("location.reload()").map_err(s)
}
