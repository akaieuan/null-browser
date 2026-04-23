//! WebView management: create, navigate, and resize the content webview.
//!
//! Null uses Tauri's multi-webview feature. The main window has two
//! webviews stacked: `main` (the React UI — address bar and future
//! tab strip at the top) and `content` (the browser tab itself,
//! positioned below the top bar). All browsing happens in `content`;
//! the React side never sees user page content.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl};

/// Label used to identify the content webview in state lookups.
pub const CONTENT_LABEL: &str = "content";

/// Height of the top bar (address bar + future tab strip), in logical pixels.
/// Duplicated in `src/App.tsx` as `TOP_BAR_HEIGHT`. Keep them in sync.
pub const TOP_BAR_HEIGHT: f64 = 40.0;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Create the content webview as a child of the main window.
///
/// Starts at `about:blank` so the app makes zero outbound connections
/// on launch — the first network call happens when the user types a
/// URL into the address bar.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let scale = window.scale_factor().map_err(s)?;
    let size = window.inner_size().map_err(s)?.to_logical::<f64>(scale);

    let url: Url = "about:blank".parse().map_err(s)?;
    window
        .add_child(
            WebviewBuilder::new(CONTENT_LABEL, WebviewUrl::External(url)),
            LogicalPosition::new(0.0, TOP_BAR_HEIGHT),
            LogicalSize::new(size.width, (size.height - TOP_BAR_HEIGHT).max(0.0)),
        )
        .map_err(s)?;

    Ok(())
}

/// Navigate the content webview to a new URL.
pub fn navigate(app: &AppHandle, url: &str) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(CONTENT_LABEL)
        .cloned()
        .ok_or_else(|| "content webview not found".to_string())?;
    let url: Url = url.parse().map_err(s)?;
    webview.navigate(url).map_err(s)?;
    Ok(())
}

/// Resize the content webview. Called from the frontend on window resize.
pub fn resize(app: &AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(webview) = app.webviews().get(CONTENT_LABEL) {
        webview
            .set_size(LogicalSize::new(width.max(0.0), height.max(0.0)))
            .map_err(s)?;
    }
    Ok(())
}
