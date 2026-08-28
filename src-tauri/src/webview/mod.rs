//! WebView management: multi-tab content webviews.
//!
//! Every browser tab is its own child webview under the main window,
//! labelled `tab-<uuid>`. Switching tabs toggles visibility via the
//! native `show`/`hide` APIs — no off-screen hacks. All tabs share
//! the same position and size (directly below the top bar); only
//! one is visible at a time.
//!
//! The React shell in the `main` webview never sees user page
//! content. It just manages the tab list and the address bar.

use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Url,
    WebviewBuilder, WebviewUrl,
};

use crate::network;

pub mod extract;

/// Prefix used for all tab webview labels. Keeps them separable from
/// the `main` webview in the `app.webviews()` map.
const TAB_PREFIX: &str = "tab-";

/// The page region, in logical (CSS) pixels, window-relative.
///
/// The frontend owns all four numbers — see `src/lib/layout.ts::contentRect`
/// — so tab creation and tab resizing can no longer disagree about where
/// the page goes. They used to: `create_tab` derived its own frame from
/// the window size, so a tab opened while the drawer was out was born
/// full-width and painted straight over it.
#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl ContentRect {
    fn bounds(&self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.left, self.top).into(),
            size: LogicalSize::new(self.width.max(0.0), self.height.max(0.0)).into(),
        }
    }
}

/// Event name the content webview emits to the UI when a tab's URL changes.
pub const TAB_UPDATED: &str = "tab-updated";

/// Event name for load start/finish, used to drive the top progress bar.
pub const TAB_LOAD_STATE: &str = "tab-load-state";

/// User-Agent string Null sends. macOS WKWebView's default UA makes Google
/// and a handful of other sites surface 'browser not supported' nags; this
/// pins us to a current Safari UA so we blend in with the largest macOS
/// browser crowd (lowest fingerprint entropy too).
/// The Safari UA for the OS generation this build actually ships on.
/// Bot-detection (Arkose, Cloudflare) fingerprints the JS engine and
/// scores it against this string — claiming Safari 18 on macOS 26's
/// WebKit is an inconsistency those systems are built to catch, and it
/// reads as a spoofing bot. Keep the Version/ token current with the
/// primary target OS.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// Script injected into every tab at page load. Observes PerformanceResource
/// entries (the browser's own list of every subresource it fetched — scripts,
/// fonts, images, CSS, XHR, fetch) and pings them back to Rust via a custom
/// URI scheme. Best-effort: sites with a strict `img-src` CSP will block
/// our beacon, so their subresources stay invisible until Phase 3
/// (native message handler via WKScriptMessageHandler).
const OBSERVER_SCRIPT: &str = r#"
(function(){
  if (window.__nullObserver__) return;
  window.__nullObserver__ = true;
  function emit(data) {
    try {
      var img = new Image();
      img.src = 'null-event://log?d=' + encodeURIComponent(JSON.stringify(data));
    } catch (e) {}
  }
  try {
    var obs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.name) continue;
        if (e.name.indexOf('null-event:') === 0) continue;
        emit({ url: e.name, init: e.initiatorType || 'resource' });
      }
    });
    obs.observe({ entryTypes: ['resource'] });
    // Replay anything that fired before the observer attached.
    try {
      var existing = performance.getEntriesByType('resource');
      for (var j = 0; j < existing.length; j++) {
        var e = existing[j];
        if (!e.name || e.name.indexOf('null-event:') === 0) continue;
        emit({ url: e.name, init: e.initiatorType || 'resource' });
      }
    } catch (e) {}
  } catch (e) {}

  // Favicon capture, once per load. The icon is re-encoded through a
  // canvas to a 64px PNG so the beacon is small, format-normalized,
  // and — because the blob URL is same-origin — never taints the
  // canvas. Cross-origin icon URLs that fail fetch simply keep the
  // letter tile; best-effort, like everything else in this script.
  function captureIcon() {
    try {
      var links = document.querySelectorAll(
        'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      var href = null, best = -1e9;
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (!l.href) continue;
        var size = parseInt((l.getAttribute('sizes') || '').split('x')[0], 10)
          || ((l.rel || '').indexOf('apple') === 0 ? 180 : 16);
        var score = -Math.abs(64 - size);
        if (score > best) { best = score; href = l.href; }
      }
      if (!href) href = location.origin + '/favicon.ico';
      fetch(href).then(function (r) {
        if (!r.ok) throw 0;
        return r.blob();
      }).then(function (blob) {
        if (blob.size > 256 * 1024) throw 0;
        return new Promise(function (res, rej) {
          var u = URL.createObjectURL(blob);
          var im = new Image();
          im.onload = function () {
            try {
              var cv = document.createElement('canvas');
              cv.width = 64; cv.height = 64;
              cv.getContext('2d').drawImage(im, 0, 0, 64, 64);
              URL.revokeObjectURL(u);
              res(cv.toDataURL('image/png'));
            } catch (e) { URL.revokeObjectURL(u); rej(e); }
          };
          im.onerror = function () { URL.revokeObjectURL(u); rej(0); };
          im.src = u;
        });
      }).then(function (dataUrl) {
        // Keep the beacon URL well under any scheme-handler limit;
        // Rust enforces the real cap after decoding.
        if (!dataUrl || dataUrl.length > 24000) return;
        var img = new Image();
        img.src = 'null-event://favicon?u=' + encodeURIComponent(location.origin) +
          '&d=' + encodeURIComponent(dataUrl);
      }).catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === 'complete') setTimeout(captureIcon, 400);
  else addEventListener('load', function () { setTimeout(captureIcon, 400); });

  // Uncaught page errors, beaconed for diagnosis. Only visible when
  // the app runs from a terminal — stderr goes nowhere from Finder —
  // and page-controlled text is length-capped before it leaves.
  addEventListener('error', function (e) {
    if (!e || !e.message) return;
    try {
      var img = new Image();
      img.src = 'null-event://jserr?d=' + encodeURIComponent(
        String(e.message).slice(0, 300) + ' @ ' +
        String(e.filename || '').slice(0, 200) + ':' + (e.lineno || 0));
    } catch (err) {}
  }, true);
})();
"#;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Popup window labels: popup-0, popup-1, … The prefix is what the
/// navigation guard and the capability system key on — popups carry
/// arbitrary web content and must stay as unprivileged as tabs.
static POPUP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A filename a page suggested is untrusted input for a filesystem
/// write: strip path separators and control characters, cap length.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_start_matches('.').trim();
    let capped: String = trimmed.chars().take(120).collect();
    if capped.is_empty() {
        "download".to_string()
    } else {
        capped
    }
}

/// `name.ext` → `name (2).ext` → `name (3).ext` until free.
fn unique_download_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for i in 2..1000 {
        let candidate = dir.join(format!("{stem} ({i}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

fn tab_label(tab_id: &str) -> String {
    format!("{TAB_PREFIX}{tab_id}")
}

/// Only web schemes may load in a tab. The URL bar always builds
/// http(s) URLs, so anything else arriving here (file:, data:,
/// javascript:, custom schemes) is a bug or hostile input — refuse it
/// at the IPC boundary rather than handing it to the webview.
fn parse_web_url(url: &str) -> Result<Url, String> {
    let url: Url = url.parse().map_err(s)?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("refusing to load {other}: URL in a tab")),
    }
}

/// Read a tab's real `<title>` off the WKWebView and emit it with the
/// URL. Reading the property directly is CSP-proof — the injected
/// `null-event://` beacon route would fail silently on exactly the
/// strict-CSP docs and news sites whose titles matter most.
///
/// Samples once at load-finish, so an SPA that rewrites `document.title`
/// on a client-side route change keeps the old title until the next
/// load. The frontend falls back to the hostname when the title is empty.
#[cfg(target_os = "macos")]
fn emit_tab_updated(webview: &tauri::Webview, tab_id: &str, url: &str) {
    let app = webview.app_handle().clone();
    let id = tab_id.to_string();
    let url = url.to_string();

    // Exactly one emit per navigation, and no fallback if the closure
    // never runs.
    //
    // A fallback is not possible to trigger correctly: `with_webview`
    // dispatches onto the main thread and returns `Ok` once the message
    // is queued, whether or not the closure executes. If the webview is
    // torn down first the closure is dropped silently and `Ok` is still
    // what comes back — so there is no signal to branch on. Emitting an
    // optimistic event up front instead would fire TAB_UPDATED twice,
    // and the frontend writes a history row on every one of them
    // (`add_history` is a plain INSERT), so every visit would be
    // recorded twice.
    //
    // The uncovered case is narrow: the webview must disappear between
    // `PageLoadEvent::Finished` and the closure running, which means the
    // tab is closing and its row is going away regardless. An empty
    // title is fine — the frontend resolves it to the hostname.
    let _ = webview.with_webview(move |pw| {
        let title = unsafe {
            let wk: &objc2_web_kit::WKWebView = &*(pw.inner() as *const objc2_web_kit::WKWebView);
            wk.title().map(|t| t.to_string()).unwrap_or_default()
        };
        let _ = app.emit_to(
            EventTarget::webview("main"),
            TAB_UPDATED,
            serde_json::json!({ "id": &id, "url": &url, "title": title }),
        );
    });
}

#[cfg(not(target_os = "macos"))]
fn emit_tab_updated(webview: &tauri::Webview, tab_id: &str, url: &str) {
    // No title source wired up off macOS yet; the frontend falls back
    // to the hostname when `title` is null.
    let _ = webview.app_handle().emit_to(
        EventTarget::webview("main"),
        TAB_UPDATED,
        serde_json::json!({ "id": tab_id, "url": url, "title": serde_json::Value::Null }),
    );
}

/// Create a new tab webview at the frame the frontend computed. Taking
/// the whole rect (rather than just `top`) is what keeps a tab opened
/// while a drawer or sidebar is out from being born at the wrong size.
pub fn create_tab(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    rect: ContentRect,
) -> Result<(), String> {
    let label = tab_label(tab_id);
    let url = parse_web_url(url)?;

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let emit_id = tab_id.to_string();
    let nav_id = tab_id.to_string();
    let nav_app = app.clone();
    let popup_app = app.clone();
    let dl_app = app.clone();
    // Built blank, navigated below — NOT built at `url`.
    //
    // `WKContentRuleList` only filters requests issued after the list is
    // on the content controller, and the list can only be attached once
    // the webview exists. A builder carrying the destination starts that
    // navigation inside `add_child`, so the first page's ad and tracker
    // requests were already in flight before `blocklist::attach` ran —
    // the initial load went unfiltered and only a reload was blocked.
    // Opening blank costs one extra navigate and makes the first real
    // navigation identical to every later one, which is the path that
    // was already provably filtered. `url` is still validated above, so
    // the http/https allowlist is unchanged.
    let builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External("about:blank".parse().expect("about:blank parses")),
    )
    .user_agent(USER_AGENT)
    .initialization_script(OBSERVER_SCRIPT)
    .on_navigation(move |url| network::record_navigation(&nav_app, &nav_id, url))
    // window.open / target=_blank. Before this handler existed the
    // request was silently dropped — which is why every OAuth
    // dialog and captcha popup "just stalled". Two shapes:
    //
    // * A sized request is a JS popup (login dialogs, captcha
    //   frames). It needs the real WebKit popup machinery —
    //   window.opener, postMessage back to the page — so it gets an
    //   actual small window, built on the exact WKWebViewConfiguration
    //   WebKit handed us (that linkage IS the opener relationship).
    // * An unsized request is a plain "open this elsewhere":
    //   that's a tab, routed through the shell.
    .on_new_window(move |url, features| {
        if !matches!(url.scheme(), "http" | "https") {
            return NewWindowResponse::Deny;
        }
        if features.size().is_none() {
            let _ = popup_app.emit_to(EventTarget::webview("main"), "open-url", url.to_string());
            return NewWindowResponse::Deny;
        }
        #[cfg(target_os = "macos")]
        let config = features.opener().target_configuration.clone();
        let n = POPUP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let popup_label = format!("popup-{n}");
        #[allow(unused_mut)]
        let mut b = tauri::WebviewWindowBuilder::new(
            &popup_app,
            &popup_label,
            WebviewUrl::External("about:blank".parse().expect("about:blank parses")),
        )
        .title(url.as_str())
        .window_features(features)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });
        #[cfg(target_os = "macos")]
        {
            b = b.with_webview_configuration(config);
        }
        match b.build() {
            Ok(window) => {
                // A popup gets its own WKUserContentController, so
                // it needs the rule lists handed to it separately —
                // it inherits nothing from the tab that opened it.
                crate::blocklist::attach_window(&window);
                NewWindowResponse::Create { window }
            }
            Err(_) => NewWindowResponse::Deny,
        }
    })
    // Downloads land in ~/Downloads under a collision-free name;
    // the shell shows start/finish. Refusing when the Downloads
    // directory cannot be resolved beats writing somewhere silent.
    .on_download(move |_webview, event| match event {
        DownloadEvent::Requested { url, destination } => {
            let Some(dir) = directories::UserDirs::new()
                .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
            else {
                return false;
            };
            let suggested = destination
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .filter(|n| !n.is_empty())
                .or_else(|| {
                    url.path_segments()
                        .and_then(|mut s| s.next_back())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "download".to_string());
            let path = unique_download_path(&dir, &sanitize_filename(&suggested));
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            *destination = path;
            let _ = dl_app.emit_to(
                EventTarget::webview("main"),
                "download-started",
                serde_json::json!({ "name": name, "url": url.to_string() }),
            );
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            let _ = dl_app.emit_to(
                EventTarget::webview("main"),
                "download-finished",
                serde_json::json!({ "url": url.to_string(), "success": success }),
            );
            true
        }
        _ => true,
    })
    .on_page_load(move |webview, payload| {
        let url_string = payload.url().to_string();
        // The blank page every tab is built at, before it is navigated
        // to the real URL (see the builder above). It is scaffolding,
        // not a visit: TAB_UPDATED writes a history row and sets the
        // tab's title, so emitting for it would put an `about:blank`
        // row in History and flash a blank title before the real page
        // arrives. The load-state ping is skipped with it — the real
        // navigation's own "started" is what should light the spinner.
        if url_string.starts_with("about:blank") {
            return;
        }
        let app = webview.app_handle();
        let state = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        let _ = app.emit_to(
            EventTarget::webview("main"),
            TAB_LOAD_STATE,
            serde_json::json!({ "id": &emit_id, "state": state, "url": &url_string }),
        );
        if matches!(payload.event(), PageLoadEvent::Finished) {
            emit_tab_updated(&webview, &emit_id, &url_string);
        }
    });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(rect.left, rect.top),
            LogicalSize::new(rect.width.max(0.0), rect.height.max(0.0)),
        )
        .map_err(s)?;

    round_corners(&webview);
    // Before the first request goes out — which is now true, because the
    // webview above opened blank and the navigation below is what fetches
    // the page. A webview built at its destination would have loaded that
    // page's trackers once and only started blocking on the next
    // navigation.
    crate::blocklist::attach(&webview);

    // The real navigation, filtered by the lists just attached. Same call
    // the URL bar and reload use, so a tab's first load and every later
    // one now take one path.
    webview.navigate(url).map_err(s)?;

    Ok(())
}

/// The current page-card corner radius in px. Settings drives it (the
/// "Corners" preference), and it has to live here because new tabs are
/// created after the preference was last set.
#[cfg(target_os = "macos")]
static CORNER_RADIUS_PX: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(12);

/// Round the native webview's layer so the page reads as a card, at the
/// radius the Corners preference currently asks for.
///
/// Best-effort by design: `masksToBounds` clipping WebKit's *remote*
/// layer tree is not promised anywhere, so if a macOS release stops
/// honouring it the corners go square inside their gutter and nothing
/// else changes. Off the main thread `with_webview` schedules onto it.
#[cfg(target_os = "macos")]
fn round_corners(webview: &tauri::Webview) {
    let radius = CORNER_RADIUS_PX.load(std::sync::atomic::Ordering::Relaxed) as f64;
    let _ = webview.with_webview(move |pw| unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let view = pw.inner() as *mut AnyObject;
        let () = msg_send![&*view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![&*view, layer];
        if !layer.is_null() {
            // `masksToBounds` + a corner radius forces Core Animation to
            // composite WebKit's hosted layer tree through an offscreen
            // rounded-rect mask. That buffer is allocated at the layer's
            // `contentsScale`, which defaults to 1.0 and — when the corners
            // are rounded during tab creation, before the view has joined a
            // Retina window — is never bumped to the backing scale. The
            // result is a page rasterised at half resolution: fine on video
            // and large UI, obviously soft on dense text (Google Docs). Pin
            // the scale to the display so the masked buffer is Retina-sharp.
            let window: *mut AnyObject = msg_send![&*view, window];
            let scale: f64 = if !window.is_null() {
                msg_send![&*window, backingScaleFactor]
            } else {
                let screen: *mut AnyObject = msg_send![class!(NSScreen), mainScreen];
                if !screen.is_null() {
                    msg_send![&*screen, backingScaleFactor]
                } else {
                    2.0
                }
            };
            if scale > 0.0 {
                let () = msg_send![&*layer, setContentsScale: scale];
            }
            let () = msg_send![&*layer, setCornerRadius: radius];
            let () = msg_send![&*layer, setMasksToBounds: true];
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn round_corners(_webview: &tauri::Webview) {}

/// Make the shell webview's WebKit layer actually transparent.
///
/// wry already disables `drawsBackground` on the *configuration* via
/// private KVC, and on macOS 26 that call is accepted but no longer
/// has any effect — the page's base background still paints, which
/// blacked out the vibrancy behind an otherwise perfectly transparent
/// stack (window non-opaque, effect view present, NSView non-opaque:
/// all verified by probe). Re-assert it on the *instance*, plus the
/// public `underPageBackgroundColor`, plus a clear CALayer background.
/// Belt, braces, and the one public API among them.
#[cfg(target_os = "macos")]
pub fn force_shell_transparent(app: &AppHandle) {
    let Some(webview) = app.get_webview("main") else {
        return;
    };
    let _ = webview.with_webview(|pw| unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::{NSNumber, NSString};
        let wk = pw.inner() as *mut AnyObject;
        // Instance-level private KVC — the same key wry itself uses on
        // the instance in its set_background_color path, so it is an
        // established, non-throwing pattern.
        let no = NSNumber::new_bool(false);
        let key = NSString::from_str("drawsBackground");
        let _: () = msg_send![&*wk, setValue: Some(&*no as &AnyObject), forKey: &*key];
        // Public API (macOS 12+): the base color WebKit paints under
        // the page. Clear it so a transparent DOM stays transparent.
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![&*wk, setUnderPageBackgroundColor: &*clear];
        // And the view's own layer, in case AppKit gave it a ground.
        let () = msg_send![&*wk, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![&*wk, layer];
        if !layer.is_null() {
            let nil: *mut AnyObject = std::ptr::null_mut();
            let () = msg_send![&*layer, setBackgroundColor: nil];
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn force_shell_transparent(_app: &AppHandle) {}

/// Settings changed the Corners preference: remember it for tabs not
/// yet created, and restyle every live one.
pub fn set_corner_radius(app: &AppHandle, radius: f64) {
    #[cfg(target_os = "macos")]
    {
        let px = radius.clamp(0.0, 32.0) as u32;
        CORNER_RADIUS_PX.store(px, std::sync::atomic::Ordering::Relaxed);
        for (label, webview) in app.webviews() {
            if label.starts_with(TAB_PREFIX) {
                round_corners(&webview);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, radius);
    }
}

/// Close (destroy) a tab webview.
pub fn close_tab(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    if let Some(webview) = app.get_webview(&label) {
        // Stop media before tearing the webview down. WKWebView runs
        // media in a separate process, and `close()` alone can leave a
        // playing video's audio going right through the teardown — a
        // closed tab you can still hear. Both calls dispatch onto the
        // main thread in order, so the pause lands before the close.
        stop_media(&webview);
        webview.close().map_err(s)?;
    }
    Ok(())
}

/// Pause every audio/video element in a tab, called just before the
/// tab closes. `pauseAllMediaPlaybackWithCompletionHandler` is
/// WebKit's own "stop everything", more thorough than pausing DOM
/// elements from script (it reaches media the page holds outside the
/// document too).
#[cfg(target_os = "macos")]
fn stop_media(webview: &tauri::Webview) {
    let _ = webview.with_webview(|pw| unsafe {
        let wk: &objc2_web_kit::WKWebView = &*(pw.inner() as *const objc2_web_kit::WKWebView);
        wk.pauseAllMediaPlaybackWithCompletionHandler(None);
    });
}

#[cfg(not(target_os = "macos"))]
fn stop_media(_webview: &tauri::Webview) {}

/// Show the given tab; hide every other tab.
pub fn activate(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    let target = tab_label(tab_id);
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        if label == target {
            webview.show().map_err(s)?;
            // Hand the page the first responder so space / arrows /
            // PageDown scroll it without the user clicking first.
            let _ = webview.set_focus();
        } else {
            webview.hide().map_err(s)?;
        }
    }
    Ok(())
}

/// Show exactly the given tabs and hide every other — the split-view
/// generalisation of [`activate`]. Focus goes to `focus_id` (which the
/// caller includes in `ids`); the other visible pane keeps its frame
/// and keeps rendering, it just doesn't own the keyboard.
pub fn activate_many(app: &AppHandle, ids: &[String], focus_id: &str) -> Result<(), String> {
    let targets: Vec<String> = ids.iter().map(|id| tab_label(id)).collect();
    let focus = tab_label(focus_id);
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        if targets.contains(&label) {
            webview.show().map_err(s)?;
            if label == focus {
                let _ = webview.set_focus();
            }
        } else {
            webview.hide().map_err(s)?;
        }
    }
    Ok(())
}

/// Hide every tab webview. Used when the active tab has no URL yet — the
/// React shell shows the Null landing page through.
pub fn hide_all(app: &AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        webview.hide().map_err(s)?;
    }
    // AppKit resigns first responder to the window when the view holding
    // it is hidden, which would leave nobody focused. Give it to the shell.
    focus_shell(app)
}

/// Page zoom for one tab. The factor is tracked by the shell (it owns
/// per-tab state); this just applies it.
pub fn set_tab_zoom(app: &AppHandle, tab_id: &str, factor: f64) -> Result<(), String> {
    let label = tab_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("tab {tab_id} not found"))?;
    webview.set_zoom(factor.clamp(0.25, 5.0)).map_err(s)
}

/// Find-on-page for one tab, driven from the chrome's find bar.
///
/// `window.find` is the one find API WebKit exposes to page script, and
/// it is enough: it moves the page's own selection to the next match
/// and scrolls it into view. Nothing in the DOM is modified and nothing
/// persists — closing the bar clears the selection and that is the
/// whole footprint. `restart` collapses the selection first so a new
/// query searches from the top instead of continuing from wherever the
/// last match left the caret. The query goes through
/// `js_string_literal`, the same escaping the extraction scripts use.
pub fn find_in_page(
    app: &AppHandle,
    tab_id: &str,
    query: &str,
    forward: bool,
    restart: bool,
) -> Result<(), String> {
    if query.is_empty() {
        return eval_on(app, tab_id, "window.getSelection().removeAllRanges()");
    }
    let script = format!(
        "(function(){{if({restart}){{window.getSelection().removeAllRanges();}}window.find({q},false,{backwards},true,false,true,false);}})()",
        restart = restart,
        q = js_string_literal(query),
        backwards = !forward,
    );
    eval_on(app, tab_id, &script)
}

/// Navigate a specific tab to a new URL.
pub fn navigate_tab(app: &AppHandle, tab_id: &str, url: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("tab {tab_id} not found"))?;
    let url = parse_web_url(url)?;
    webview.navigate(url).map_err(s)?;
    Ok(())
}

/// Reposition and resize tab webviews. `rect` is logical (CSS) pixels,
/// window-relative, computed by the frontend.
///
/// `only` restricts the reframe to a single tab — used during a live
/// sidebar drag so a 40-tab window issues one `setFrame:` per frame
/// instead of forty. `None` flushes every tab, including hidden ones:
/// `hide()` preserves a webview's frame, so skipping hidden tabs as a
/// permanent optimisation would leave them stale when re-shown.
///
/// `set_bounds` is a single event-loop message and a single `setFrame:`,
/// where the old `set_position` + `set_size` pair produced an
/// intermediate frame carrying the new position with the old size.
pub fn set_content_frame(
    app: &AppHandle,
    rect: ContentRect,
    only: Option<&str>,
) -> Result<(), String> {
    let bounds = rect.bounds();
    let target = only.map(tab_label);
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        if let Some(t) = &target {
            if &label != t {
                continue;
            }
        }
        webview.set_bounds(bounds).map_err(s)?;
    }
    Ok(())
}

/// Hand the window's first responder to the React shell. Needed before
/// focusing a DOM node: `.focus()` on a webview that is not the first
/// responder paints the focus ring but sends keystrokes to the page.
pub fn focus_shell(app: &AppHandle) -> Result<(), String> {
    focus_shell_any(app)
}

/// `focus_shell` for any runtime — the menu handler is generic over `R`.
pub fn focus_shell_any<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(main) = app.get_webview("main") {
        main.set_focus().map_err(s)?;
    }
    Ok(())
}

fn eval_on(app: &AppHandle, tab_id: &str, script: &str) -> Result<(), String> {
    let label = tab_label(tab_id);
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.eval(script).map_err(s)
}

pub fn go_back(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "history.back()")
}

pub fn go_forward(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "history.forward()")
}

pub fn reload(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    eval_on(app, tab_id, "location.reload()")
}

const READABILITY_JS: &str = include_str!("vendor/readability.js");
const TURNDOWN_JS: &str = include_str!("vendor/turndown.js");

/// The reply transport, shared by both extraction kinds.
/// `__NULL_REQ_ID__` is declared as a JS string literal at the top of
/// the enclosing IIFE (see `run_extract`), so it's in scope here.
///
/// Sends the result back as a sequence of GETs via `new Image()` — NOT
/// `fetch`. Image hits `img-src` CSP, which real-world article sites
/// (Medium, news, docs) leave broad; `fetch` hits `connect-src`, which
/// the same sites routinely restrict to 'self' and silently block the
/// custom scheme. Mirrors the subresource observer's transport choice.
///
/// Chunked to stay under conservative URL length budgets: 1500 chars
/// of raw JSON → at most ~5 KB URL-encoded, which every WebKit build
/// handles fine. The page cannot forge a reply because it doesn't
/// know the current reqId.
const SEND_GLUE: &str = r#"
function __null_send(jsonStr) {
  try {
    var CHUNK = 1500;
    var total = Math.max(1, Math.ceil(jsonStr.length / CHUNK));
    for (var i = 0; i < total; i++) {
      var part = jsonStr.substr(i * CHUNK, CHUNK);
      var img = new Image();
      img.src = 'null-event://artifact?r=' + encodeURIComponent(__NULL_REQ_ID__)
              + '&i=' + i
              + '&n=' + total
              + '&d=' + encodeURIComponent(part);
    }
  } catch (err) {}
}
"#;

/// Article extraction: Readability strips the page, Turndown converts
/// the article HTML to markdown.
const ARTICLE_GLUE: &str = r#"
try {
  var doc = document.cloneNode(true);
  var article = new Readability(doc).parse();
  if (!article) throw new Error('not-an-article');
  var td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  var md = td.turndown(article.content);
  __null_send(JSON.stringify({
    title: (article.title || document.title || ''),
    url: location.href,
    markdown: md
  }));
} catch (e) {
  __null_send(JSON.stringify({
    title: (document.title || ''),
    url: location.href,
    markdown: '[extraction failed: ' + (e && e.message || 'unknown') + ']'
  }));
}
"#;

/// Selection extraction: whatever the user highlighted, as markdown.
/// The selection survives the focus move to the drawer button — WebKit
/// keeps a hidden webview's selection intact.
const SELECTION_GLUE: &str = r#"
try {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) throw new Error('nothing selected');
  var container = document.createElement('div');
  for (var i = 0; i < sel.rangeCount; i++) {
    container.appendChild(sel.getRangeAt(i).cloneContents());
  }
  var td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  var md = td.turndown(container.innerHTML);
  if (!md.trim()) throw new Error('nothing selected');
  __null_send(JSON.stringify({
    title: (document.title || ''),
    url: location.href,
    markdown: md
  }));
} catch (e) {
  __null_send(JSON.stringify({
    title: (document.title || ''),
    url: location.href,
    markdown: '[extraction failed: ' + (e && e.message || 'unknown') + ']'
  }));
}
"#;

/// Inject the vendored converters + the right glue into the target
/// tab. The orchestrator in `webview::extract::extract_tab` registers
/// a `reqId` first, then awaits the corresponding payload.
///
/// The vendored JS is concatenated inside a single IIFE so that
/// `Readability` and `TurndownService` stay scoped — they never touch
/// the page's globals.
pub fn run_extract(
    app: &AppHandle,
    tab_id: &str,
    req_id: &str,
    kind: extract::ExtractKind,
) -> Result<(), String> {
    let req_id_literal = js_string_literal(req_id);
    let mut script =
        String::with_capacity(READABILITY_JS.len() + TURNDOWN_JS.len() + SEND_GLUE.len() + 256);
    script.push_str("(function(){\n");
    script.push_str("var __NULL_REQ_ID__ = ");
    script.push_str(&req_id_literal);
    script.push_str(";\n");
    script.push_str(SEND_GLUE);
    script.push_str("\n;\n");
    match kind {
        extract::ExtractKind::Article => {
            script.push_str(READABILITY_JS);
            script.push_str("\n;\n");
            script.push_str(TURNDOWN_JS);
            script.push_str("\n;\n");
            script.push_str(ARTICLE_GLUE);
        }
        extract::ExtractKind::Selection => {
            script.push_str(TURNDOWN_JS);
            script.push_str("\n;\n");
            script.push_str(SELECTION_GLUE);
        }
    }
    script.push_str("\n})();");
    eval_on(app, tab_id, &script)
}

fn js_string_literal(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 2);
    out.push('"');
    for c in raw.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Wipe per-origin storage on every live tab (cookies, localStorage,
/// sessionStorage, IndexedDB). Runs as a page script, so it clears only
/// what JS can see for the current document's origin — not the OS-level
/// network cache. Good enough to log the user out of most sites.
pub fn clear_tab_storage(app: &AppHandle) -> Result<(), String> {
    const SCRIPT: &str = r#"
        try { localStorage.clear(); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        try {
            document.cookie.split(';').forEach(function (c) {
                var eq = c.indexOf('=');
                var name = (eq > -1 ? c.substr(0, eq) : c).trim();
                if (!name) return;
                var host = location.hostname;
                var paths = ['/', location.pathname];
                var domains = ['', host, '.' + host];
                paths.forEach(function (p) {
                    domains.forEach(function (d) {
                        var base = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=' + p;
                        document.cookie = d ? base + ';domain=' + d : base;
                    });
                });
            });
        } catch (e) {}
        try {
            if (indexedDB.databases) {
                indexedDB.databases().then(function (dbs) {
                    dbs.forEach(function (d) {
                        if (d && d.name) indexedDB.deleteDatabase(d.name);
                    });
                });
            }
        } catch (e) {}
    "#;
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) {
            continue;
        }
        webview.eval(SCRIPT).map_err(s)?;
    }
    Ok(())
}
