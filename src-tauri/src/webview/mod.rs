//! WebView management: create, navigate, and intercept requests.
//!
//! Null uses the system WebView on each platform (WebKit on macOS,
//! WebKitGTK on Linux, WebView2 on Windows). Rendering will vary
//! slightly per OS; functional parity is required.
