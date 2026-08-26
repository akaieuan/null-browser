# NULL — NAVIGATION, CHROME & HOME: IMPLEMENTATION SPEC

**Status:** authoritative. Supersedes the three candidate designs. Built on **Rail** (highest score), with the Library-pinning and single-selection model grafted from **Source List**, the WKWebView `title` read grafted from **The Index**, and every fatal flaw from the feasibility and ergonomics judges resolved below.

Everything asserted about the Tauri/wry/muda API surface in §3 was verified against the vendored crates in `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/` during the writing of this document. Every colour claim in §4 was computed, not eyeballed — the table is in §4.0.

---

## 1. THE DECISION

Null gets a **full-height left source list** — a 240px column that owns the top-left of the window (traffic lights included), stacking **Bookmarks → Tabs → Library → Settings footer**, with the toolbar reduced to 38px spanning only the page column to its right. The page webview sits **flush and square-cornered** against the sidebar and below the toolbar, so chrome height becomes a constant 41px and the tab strip, the bookmarks bar, the profile dropdown and every height jump they caused are deleted. The home screen becomes one list of your six most recent clips and nothing else.

**Explicitly rejected, with the reason for each:**

| Rejected | Why |
|---|---|
| **Zen's inset floating page card + rounded page corners** | The card is defined by a 1px `--border` ring, and `--border` vs `--background` measures **1.20–1.80:1 in all twelve palette/mode blocks** (§4.0) — the ring is arithmetically invisible, in the reference palette worst of all. Making it visible means tinting the gutter `bg-muted`, which would be the app's first surface that isn't `--background`; rounding the page means an `objc2` `CALayer.masksToBounds` reach-around on a raw WKWebView pointer against an undocumented wry view-hierarchy contract, with offscreen-compositing cost and a square-corner flash on live resize. Safari, Finder and Mail are all flush. Flush also hides the three artifacts a gap would expose: frontend-driven resize lag, wry's `to_logical::<i32>` size quantisation, and any position/size mismatch. |
| **Essentials as a 44px monogram tile grid** | With `img-src 'self' data:` (tauri.conf.json:26) there are no favicons, and a grid without favicons is Zen's form without Zen's content: `github.com` and `gitlab.com` both derive `GI`. Finder Favorites, Mail Mailboxes and Notes Folders are labelled lists. Bookmarks become labelled 28px rows at the top of the sidebar — same position Zen puts Essentials, same position Finder puts Favorites. |
| **A `pinned` column on `bookmarks`** | Dropping the tile grid removes the need for a second tier. Bookmarks *are* the favourites list, already persisted, already ordered (`position`, migrations.rs:58), already reorderable (`reorder_bookmarks`, storage/mod.rs:146). Zero migration. |
| **Deleting `HistoryPanel` / `ClipsDrawer`** | Rail's "History as a home segment" made history cost a tab (ergonomics fatal flaw). Source List's "Clips as a full-pane destination" broke read-page-then-clip. Both stay; both move from toolbar buttons to sidebar Library rows. |
| **Workspaces, Split View, Glance, hover-reveal compact mode** | §8. |

---

## 2. GEOMETRY

### 2.0 Constants — `src/lib/layout.ts` (replaces the current 4-line file)

```ts
// Layout constants shared across components. Kept outside panel modules
// so App.tsx can read them without eagerly pulling in the panel bundles.

export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH     = 180;
export const SIDEBAR_MAX_WIDTH     = 360;
export const SIDEBAR_SNAP          = 240;   // ±8px magnet during drag
export const SIDEBAR_DROP_WIDTH    = 120;   // drag below this ⇒ collapse

export const SIDEBAR_HEADER_HEIGHT = 38;    // == TOOLBAR_HEIGHT, deliberately
export const TOOLBAR_HEIGHT        = 38;
export const PROGRESS_HEIGHT       = 2;
export const CHROME_RULE           = 1;     // border-b under the progress row

/** Every native webview's y. Constant in every state, forever. */
export const TOP_INSET = TOOLBAR_HEIGHT + PROGRESS_HEIGHT + CHROME_RULE; // 41

export const ROW_HEIGHT            = 28;
export const KICKER_HEIGHT         = 20;
export const SIDEBAR_FOOTER_HEIGHT = 36;
export const CLIPS_DRAWER_WIDTH    = 380;

/** macOS draws the traffic lights at a fixed window-relative position with
 *  titleBarStyle: "Overlay". Nothing may be drawn in the first 76px of
 *  whichever surface owns window x=0,y=0. */
export const TRAFFIC_LIGHT_INSET = 76;

/** Below this much page width the sidebar force-collapses; it restores at
 *  SIDEBAR_RESTORE_PAGE_WIDTH. Two thresholds = hysteresis, so a window
 *  parked on the boundary cannot flap and fire a native reframe per flap. */
export const SIDEBAR_COLLAPSE_PAGE_WIDTH = 640;
export const SIDEBAR_RESTORE_PAGE_WIDTH  = 700;

export type ContentRect = {
  left: number; top: number; width: number; height: number;
};

/** THE single source of native-webview geometry. Both resizeContent and
 *  openTab consume this — they can no longer disagree, which is what makes
 *  "new tab paints over the drawer" structurally impossible.
 *
 *  Every value is rounded: wry quantises webview SIZE via
 *  `to_logical::<i32>` but POSITION via `to_logical::<f64>`
 *  (wry-0.54.4/src/wkwebview/mod.rs:1015-1016). Integer logical points in
 *  means no half-point seam at the sidebar divider on a Retina display. */
export function contentRect(o: {
  winW: number; winH: number; sidebarWidth: number;
  sidebarOpen: boolean; clipsOpen: boolean;
}): ContentRect {
  const left = o.sidebarOpen ? o.sidebarWidth : 0;
  const right = o.winW - (o.clipsOpen ? CLIPS_DRAWER_WIDTH : 0);
  return {
    left:   Math.round(left),
    top:    TOP_INSET,
    width:  Math.max(0, Math.round(right - left)),
    height: Math.max(0, Math.round(o.winH - TOP_INSET)),
  };
}

/** Page width the sidebar WOULD leave if it were open. Drives auto-collapse.
 *  Keyed on resulting page width, not window width — a 1024px window with
 *  the Clips drawer open leaves 404px of page, which is the case that
 *  matters and which a window-width rule misses. */
export function pageWidthIfSidebarOpen(
  winW: number, sidebarWidth: number, clipsOpen: boolean,
): number {
  return winW - sidebarWidth - (clipsOpen ? CLIPS_DRAWER_WIDTH : 0);
}
```

`TOP_INSET` is 41, not 40, and that single pixel is load-bearing: the `border-b border-border` under the progress row occupies y=40. If the webview started at y=40 it would cover the rule, and Home and the three panels — which are `bg-background`, identical to the chrome — would have no top edge at all. This is a real bug in the current code, masked only because no state exposes it (App.tsx:857 draws `border-t border-border` at the same y the webview is positioned at).

### 2.1 Window decomposition

```
x=0                    x=SW                                        x=winW
├──────────────────────┼───────────────────────────────────────────────┤
│  SIDEBAR HEADER 38   │  TOOLBAR                              38      │ y=0..38
│  (traffic lights +   ├───────────────────────────────────────────────┤
│   sidebar toggle)    │  progress track                        2      │ y=38..40
│                      ├───────────────────────────────────────────────┤
│                      │  border-b border-border                1      │ y=40..41
│  ┌ BOOKMARKS ──────┐ ├───────────────────────────────────────────────┤
│  │ rows            │ │                                               │
│  └─────────────────┘ │                                               │
│  ┌ TABS ───────────┐ │        NATIVE TAB WEBVIEW                     │
│  │ rows (flex-1,   │ │        (or Home / a panel, React-drawn,        │ y=41..winH
│  │  scrolls)       │ │         with the webview hidden)              │
│  └─────────────────┘ │                                               │
│  ┌ LIBRARY ────────┐ │                                               │
│  │ Clips           │ │                                               │
│  │ History         │ │                                               │
│  │ Network         │ │                                               │
│  └─────────────────┘ │                                               │
│  ─────────────────── │                                               │
│  Settings · Null     │                                               │
└──────────────────────┴───────────────────────────────────────────────┘
   SW = sidebarOpen ? sidebarWidth : 0
   The sidebar's `border-r border-border` occupies x = SW-1 .. SW.
```

**Traffic lights.** With `titleBarStyle: "Overlay"` + `hiddenTitle: true` (tauri.conf.json:21-22), macOS draws the cluster at roughly x 13–71, y 14–26, window-relative, and it does **not** follow the chrome. The sidebar header is 38px tall and ≥180px wide, so it clears the cluster with room. We do **not** set `trafficLightPosition`: wry re-applies it only from `WryWebViewParent`'s `drawRect:` (wry-0.54.4/src/wkwebview/class/wry_web_view_parent.rs:40-46), a view that is fully occluded by opaque webviews and may therefore never be marked dirty after a fullscreen exit — the inset silently drifts, and Tauri 2.10.3 exposes it as a builder option only, with no runtime setter to repair it from React. Default position, header sized to clear it.

The hop-between-rows ternary at **App.tsx:632** (`paddingLeft: showTabStrip ? 8 : TRAFFIC_LIGHT_INSET`) is deleted.

**The sidebar toggle does not move.** When the sidebar is open it lives in the sidebar header with `paddingLeft: 76` → window x 76–104. When the sidebar is collapsed it becomes the toolbar's first item, and the toolbar takes `paddingLeft: 76` → window x 76–104. **Identical screen position in both states.** This is the Notes/Mail layout and it eliminates the 164px re-acquisition jump the design-integrity judge flagged as a fatal flaw in Rail.

### 2.2 Sidebar interior — vertical stack

Track: the `<nav>` carries `px-2`; rows carry their own `px-2`. At SW=240 the usable label width is 240 − 1 (border-r) − 16 (nav) − 16 (row) = **207px**.

| Band | Height | Rendered when |
|---|---|---|
| Header (drag region; traffic lights; toggle at pl-76) | 38 | always |
| `BOOKMARKS` kicker | 20 | `bookmarks.length > 0` |
| hairline | 1 | ditto |
| bookmark rows, `shrink-0 max-h-[35%] overflow-y-auto` | n × 28, capped | ditto |
| gap | 12 | ditto |
| `TABS` kicker + hairline | 21 | always |
| tab rows + trailing `+ New tab` row, `flex-1 min-h-0 overflow-y-auto` | flexes | always |
| gap | 12 | always |
| `LIBRARY` kicker + hairline | 21 | always |
| Clips / History / Network rows | 84 | always |
| footer rule + row | 1 + 36 | always |

Worked example at **800px tall, 4 bookmarks**: fixed = 38 + 21 + 112 + 12 + 21 + 12 + 21 + 84 + 37 = **358**, leaving **442px** for the tab list ≈ 15 rows plus the New Tab row. Worst case (bookmarks region at its 35% cap = 280px): fixed = 526, tab list = 274 ≈ 9 rows. At the 480px window minimum with no bookmarks: fixed = 213, tab list = 267. Nothing clips in any case.

`TABS` and `BOOKMARKS` are **always rendered when non-empty** — there is no `tabs.length > 1` rule any more, because the sidebar's width does not depend on its contents. Bookmarks sit **above** tabs because bookmarks are a bounded, low-churn, curated list and tabs are unbounded: putting the bounded list first pins it to a stable y forever and gives the scroll budget to the list that actually needs it. This is what Finder does (Favorites → iCloud → Locations → Tags) and what Zen does (Essentials above tabs). It is also the fix for the ergonomics fatal flaw "reaching a bookmark regresses from one click to a new tab plus two clicks": a bookmark is **one click, at a stable coordinate, in every state**.

`LIBRARY` and the footer are **`shrink-0`, outside the scroll region**. That is the Source List graft, and it is the fix for "Clips is below the fold behind 40 tabs": Clips/History/Network/Settings sit at a fixed distance from the bottom of the window regardless of tab count.

### 2.3 Every state, with the exact native frame

At 1280 × 800 logical, `sidebarWidth = 240`. All four values are what `contentRect()` returns and what crosses IPC.

| State | left | top | width | height |
|---|---|---|---|---|
| Sidebar open, drawer closed | 240 | 41 | 1040 | 759 |
| Sidebar open, Clips drawer open | 240 | 41 | 660 | 759 |
| Sidebar collapsed, drawer closed | 0 | 41 | 1280 | 759 |
| Sidebar collapsed, drawer open | 0 | 41 | 900 | 759 |
| 0 tabs | — | — | — | — (unreachable, see below) |
| 1 blank tab (Home) | 240 | 41 | 1040 | 759 | no webview is created at all (`hasWebview:false`); frame is still sent so any *other* tab stays correct |
| 1 loaded tab | 240 | 41 | 1040 | 759 |
| 40 tabs | 240 | 41 | 1040 | 759 | identical — all tabs share one frame |
| Bookmarks present / absent | 240 | 41 | 1040 | 759 | identical — bookmarks no longer cost vertical space |
| Settings / History / Network open | 240 | 41 | 1040 | 759 | frame unchanged; `hideAllTabs()` runs and React fills the same box |
| Window at 640 × 480 min, drawer closed | 0 | 41 | 640 | 439 | sidebar auto-collapsed: `pageWidthIfSidebarOpen(640,240,false) = 400 < 640` |

**The zero-tab state is made unreachable.** `tabs` is never empty: on mount, and whenever the last tab closes, a blank tab (`url: "about:blank"`, `hasWebview: false`) is created. This kills `activeId: null` and with it `navigateTo`'s no-active-tab branch (App.tsx:291-301). ⌘W on a lone blank tab closes the window instead (Safari's behaviour) — see §5.

**Auto-collapse.** Derived, never written to the persisted preference, so the sidebar springs back when the window widens:

```ts
const wouldBe = pageWidthIfSidebarOpen(winW, sidebarWidth, clipsOpen);
if (sidebarOpen && wouldBe < SIDEBAR_COLLAPSE_PAGE_WIDTH) autoCollapsed = true;
if (autoCollapsed && wouldBe >= SIDEBAR_RESTORE_PAGE_WIDTH) autoCollapsed = false;
const effectiveOpen = userWantsSidebar && !autoCollapsed;
```

### 2.4 The expand flash, and how it is avoided

React paints the sidebar in the shell webview; the native reframe is an async round-trip to the main thread. Tab webviews are added via `ns_view.addSubview(&webview)` into the same parent view as the shell, **after** it (wry-0.54.4/src/wkwebview/mod.rs:665), so they are permanently above it and there is no reordering API in Tauri or wry. For the 1–3 frames between React's paint and `setFrame:`, the page therefore covers a newly-drawn sidebar.

Rule, applied in the toggle handler and in the resize drag:

- **Sidebar growing (expand, or a widening drag):** fire `ipc.resizeContent(rect)` **first**, commit the React width on the next `requestAnimationFrame`.
- **Sidebar shrinking (collapse, or a narrowing drag):** commit React first, then fire the IPC. The transient is a sliver of chrome ground, which is invisible.

### 2.5 Resize drag cost

Each `setFrame:` on a live WKWebView forces a cross-process page relayout, and `set_content_frame` iterates every `tab-` webview. At 40 tabs × 60fps that is 2400 `setFrame:` calls per second. Therefore:

- During a drag, `resizeContent` is called with `only: activeTabId` — Rust reframes **just that tab**.
- `pointerup` calls `resizeContent` with `only: null`, flushing every tab including hidden ones.
- The drag is throttled to `requestAnimationFrame` and snaps to `SIDEBAR_SNAP = 240` within ±8px (hold ⌥ to disable snapping).
- `pointercancel` and `lostpointercapture` both commit the last good width. Without this a dropped `pointerup` strands the sidebar at an arbitrary width with no way back.

---

## 3. RUST CHANGES

Five files. `activate`, `close_tab`, `navigate_tab`, the network module, clips, history, bookmarks storage: all untouched. **Rust holds zero tab state** — tab ordering, grouping and selection stay entirely frontend concerns.

### 3.1 `src-tauri/src/webview/mod.rs`

**(a) The rect type.** Add near the top, after `TAB_PREFIX` (line 23):

```rust
/// The page region, in logical (CSS) pixels, window-relative.
/// The frontend owns all four numbers — see `src/lib/layout.ts::contentRect`.
#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}
```

Import change at line 12-15: drop `PhysicalPosition, PhysicalSize`, add `LogicalPosition, LogicalSize, Rect`.

**(b) `create_tab` — replaces lines 100, 104-109, 139-145.**

```rust
pub fn create_tab(app: &AppHandle, tab_id: &str, url: &str, rect: ContentRect)
    -> Result<(), String>
{
    let label = tab_label(tab_id);
    let url = parse_web_url(url)?;
    let window = app.get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // ... builder unchanged (lines 111-137, plus the title read in (e)) ...

    let webview = window.add_child(
        builder,
        LogicalPosition::new(rect.left, rect.top),
        LogicalSize::new(rect.width.max(0.0), rect.height.max(0.0)),
    ).map_err(s)?;
    let _ = webview;
    Ok(())
}
```

The `window.scale_factor()` / `window.inner_size()` reads at **mod.rs:107-108** and the `top_px` multiply at **:109** are **deleted**. `add_child` is generic over `Into<Position>`/`Into<Size>` (tauri-2.10.3/src/window/mod.rs:1052), so logical units drop straight in. This removes the current bug where a scaled `top` was mixed with already-physical `inner_size` values — a Retina double-offset waiting to happen — and it kills the live "new tab is born full-width and covers the Clips drawer" bug at its source rather than by patching a dependency array.

**(c) `set_content_frame` — replaces lines 201-219 entirely.** This is where the hardcoded `PhysicalPosition::new(0i32, …)` at **mod.rs:214** dies, and it is the whole of the left-sidebar blocker.

```rust
/// Reposition and resize tab webviews. `rect` is logical (CSS) pixels.
/// `only` restricts the reframe to a single tab — used during a live
/// sidebar drag so a 40-tab window issues one setFrame: per frame, not 40.
/// A None `only` flushes every tab.
pub fn set_content_frame(app: &AppHandle, rect: ContentRect, only: Option<&str>)
    -> Result<(), String>
{
    let bounds = Rect {
        position: LogicalPosition::new(rect.left, rect.top).into(),
        size: LogicalSize::new(rect.width.max(0.0), rect.height.max(0.0)).into(),
    };
    let target = only.map(tab_label);
    for (label, webview) in app.webviews() {
        if !label.starts_with(TAB_PREFIX) { continue; }
        if let Some(t) = &target { if &label != t { continue; } }
        webview.set_bounds(bounds).map_err(s)?;
    }
    Ok(())
}
```

Three things happen at once. The x coordinate becomes expressible. `set_bounds` (tauri-2.10.3/src/webview/mod.rs:1491) is **one** event-loop message and **one** `setFrame:`, replacing today's `set_position` + `set_size` pair — two of each, with an intermediate frame carrying the new position and the old size. And the `× scale_factor` round-trip is gone, because wry's `set_bounds` immediately does `to_logical(backingScaleFactor)` on both fields (wry-0.54.4/src/wkwebview/mod.rs:1010-1016) — the multiply and divide only ever cancelled, and nothing in this app listens for a scale-factor change. `tauri::Rect` derives `Copy` (tauri-runtime-2.10.1/src/dpi.rs:9), so constructing it once outside the loop is legal.

**Keep iterating hidden tabs when `only` is `None`.** `hide()` is `setHidden:` and preserves the frame; filtering to the visible tab as a permanent optimisation would make re-shown tabs stale.

**(d) Focus transfer — the fix for the single fatal flaw both ergonomics judges named.** There is currently no `set_focus` anywhere in this repo. A menu accelerator reaches the app regardless of focus, but `inputRef.current.focus()` on a DOM node inside a webview that is *not* the window's first responder paints the focus ring at App.tsx:674 and sends the keystrokes to the page. ⌘L would look like it worked and silently fail. The API exists and resolves to exactly the right AppKit call: `Webview::set_focus()` (tauri-2.10.3/src/webview/mod.rs:1518) → wry `focus()` → `window.makeFirstResponder(Some(&self.webview))` (wry-0.54.4/src/wkwebview/mod.rs:1036-1043).

```rust
/// Hand the window's first responder to the React shell. Call before any
/// menu action whose handler focuses a DOM node (⌘L, ⌘T, inline rename).
pub fn focus_shell(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview("main") { main.set_focus().map_err(s)?; }
    Ok(())
}

/// Hand the first responder to a tab so space / arrows / PageDown scroll
/// the page without the user having to click it first.
pub fn focus_tab(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    if let Some(w) = app.get_webview(&tab_label(tab_id)) { w.set_focus().map_err(s)?; }
    Ok(())
}
```

Then: `activate` (mod.rs:160-173) calls `webview.set_focus()` immediately after `webview.show()` for the target; `hide_all` (mod.rs:177-185) calls `focus_shell(app)` before returning, because AppKit resigns first responder to the window when a first-responder view is hidden, leaving nobody focused.

**(e) Real tab titles.** `App.tsx:255` does `const title = hostnameFor(url)`, so every history row in SQLite stores a hostname where its title belongs, and five tabs on one host would render as five identical sidebar rows. A vertical tab list is unreadable without this, so it is a **prerequisite, not a polish item**. Do not use a `null-event://title` beacon: it inherits the documented `img-src` CSP fragility (mod.rs:40-42) and will fail silently on exactly the strict-CSP docs and news sites whose titles matter most. Read the property off the WKWebView, which is CSP-proof. Inside the existing `on_page_load` closure (mod.rs:118-137), in the `Finished` branch:

```rust
if matches!(payload.event(), PageLoadEvent::Finished) {
    let id = emit_id.clone();
    let url2 = url_string.clone();
    #[cfg(target_os = "macos")]
    {
        let _ = webview.with_webview(move |pw| unsafe {
            use objc2_web_kit::WKWebView;
            let wk: &WKWebView = &*(pw.inner() as *const WKWebView);
            let title = wk.title().map(|t| t.to_string()).unwrap_or_default();
            // emit from inside: with_webview is dispatched to the main thread
            // and cannot return a value to this scope.
            let _ = app.emit_to(
                EventTarget::webview("main"),
                TAB_UPDATED,
                serde_json::json!({ "id": &id, "url": &url2, "title": title }),
            );
        });
    }
    #[cfg(not(target_os = "macos"))]
    { /* emit TAB_UPDATED with title: null; the frontend falls back to hostnameFor */ }
}
```

`PlatformWebview::inner()` returns the raw WKWebView pointer on macOS (tauri-2.10.3/src/webview/mod.rs:201); `WKWebView::title() -> Option<Retained<NSString>>` exists in `objc2-web-kit-0.3.2/src/generated/WKWebView.rs:350`; `with_webview` (tauri-2.10.3/src/webview/mod.rs:1650) dispatches onto the event loop, so it runs main-thread. **Known gap:** this samples once at load-finish, so an SPA that rewrites `document.title` on a client-side route change keeps the old title until the next load. A `MutationObserver` on `<title>` through the existing `null-event://` transport is the follow-up; it is a strict improvement on nothing, and it is not blocking.

### 3.2 `src-tauri/src/commands/tabs.rs`

```rust
use crate::webview::{self, ContentRect};

#[tauri::command]
pub fn open_tab(app: AppHandle, id: String, url: String, rect: ContentRect)
    -> Result<(), String> { webview::create_tab(&app, &id, &url, rect) }        // was :8

#[tauri::command]
pub fn resize_content(app: AppHandle, rect: ContentRect, only: Option<String>)
    -> Result<(), String> {
    webview::set_content_frame(&app, rect, only.as_deref())                     // was :33
}

#[tauri::command]
pub fn focus_shell(app: AppHandle) -> Result<(), String> { webview::focus_shell(&app) }

#[tauri::command]
pub fn focus_tab(app: AppHandle, id: String) -> Result<(), String> {
    webview::focus_tab(&app, &id)
}
```

The other nine commands are untouched. Register `focus_shell` and `focus_tab` in the handler list at **lib.rs:120-129**.

### 3.3 `src-tauri/src/menu.rs` — the app's first custom accelerators

The sole shortcut listener today is `window.addEventListener("keydown")` at **App.tsx:488-574**, which is dead the instant the user clicks into a page, because focus is inside a separate child webview. So ⌘R, ⌘[, ⌘], ⌘D already silently stop working while browsing — which is the only time you want them. This is a currently-shipping bug the sidebar makes unsurvivable.

The stack endorses the fix: `WryWebViewParent` overrides `keyDown:` specifically to forward unhandled keys to `NSApplication.mainMenu.performKeyEquivalent`, and every tab webview is a subview of exactly that parent.

Add alongside the existing prefixes (menu.rs:8-10):

```rust
pub const MENU_ACTION_EVENT: &str = "menu-action";
const ACTION_PREFIX: &str = "act:";
```

Items are built with `MenuItem::with_id(app, "act:new_tab", "New Tab", true, Some("CmdOrCtrl+T"))`. `handle_event` (menu.rs:85) grows one arm:

```rust
} else if let Some(action) = id.strip_prefix(ACTION_PREFIX) {
    // Focus-first for every action whose handler focuses a DOM node,
    // or the keystrokes land in the page instead of the URL field.
    if matches!(action, "open_location" | "new_tab") {
        let _ = crate::webview::focus_shell(app);
    }
    if action == "close_window" {
        if let Some(w) = app.get_window("main") { let _ = w.close(); }
        return;
    }
    let _ = app.emit_to(EventTarget::webview("main"), MENU_ACTION_EVENT, action);
}
```

`emit_to` the `main` webview, not `emit` — the accelerator must never leak into tab webviews.

**Resolve the ⌘W double-claim.** `PredefinedMenuItem::close_window` at **menu.rs:75** hardcodes `Accelerator::new(Some(CMD_OR_CTRL), Code::KeyW)` (muda-0.17.2/src/items/predefined.rs:332-333) and exposes only `id()`, `text()`, `set_text()` — **there is no accelerator override**, so it cannot be rebound. Delete it from the Window submenu and use `MenuItem::with_id(app, "act:close_window", "Close Window", true, Some("Shift+CmdOrCtrl+W"))` in File. ⌘W is then unambiguously Close Tab, as in Safari.

**Menu enable/disable.** Back, Forward, Reload, Close Tab, Clip Page, Clip Selection and Add Bookmark are invalid with no live page. Shipping accelerators that fire into no-ops is worse than not having them, so this lands with the menu, not after. Store the `MenuItem` handles in a `MenuItems` struct in managed state and add:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuFlags { pub has_page: bool, pub can_close_tab: bool }

#[tauri::command]
pub fn set_menu_state(items: State<MenuItems>, flags: MenuFlags) -> Result<(), String>
```

`MenuItem::set_enabled` is at tauri-2.10.3/src/menu/normal.rs:113 and self-dispatches to the main thread, so no threading care is needed.

**Accelerator spike — do this in the first afternoon, before writing any UI.** On macOS the key window's view hierarchy gets `performKeyEquivalent:` before the main menu, and WKWebView forwards some command-key equivalents into the web process. Bind exactly two items — ⌘L and ⌘/ — and test with focus inside a page on `github.com` and a Google Docs document. If ⌘/ is swallowed, or if stealing it from web apps proves unacceptable in practice (a menu accelerator cannot be `preventDefault`ed by the page, so Slack's and Notion's own ⌘/ become unreachable inside Null), move Clips to ⇧⌘K and note it in the changelog. This is the cheapest possible de-risking of the design's most load-bearing claim.

### 3.4 `src/lib/ipc.ts`

```ts
import type { ContentRect } from "@/lib/layout";

openTab: (id: string, url: string, rect: ContentRect) =>
  invoke<void>("open_tab", { id, url, rect }),                       // was :55-56
resizeContent: (rect: ContentRect, only?: string | null) =>
  invoke<void>("resize_content", { rect, only: only ?? null }),      // was :63-64
focusShell: () => invoke<void>("focus_shell"),
focusTab: (id: string) => invoke<void>("focus_tab", { id }),
setMenuState: (flags: { hasPage: boolean; canCloseTab: boolean }) =>
  invoke<void>("set_menu_state", { flags }),
```

### 3.5 `src-tauri/Cargo.toml`

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.6"
objc2-app-kit = { version = "0.3", features = ["NSApplication", "NSImage"] }
objc2-foundation = { version = "0.3", features = ["NSData", "NSString"] }
objc2-web-kit = { version = "0.3", features = ["WKWebView"] }   # NEW — title read
```

`dock.rs:5-24` is the working precedent for this `objc2` pattern in this repo. Note what is **not** here: no `objc2-quartz-core`, no `NSView`/`CALayer` feature, no `masksToBounds`, no `macos-private-api`, no wry transparency. That is the dividend of the flush page.

### 3.6 What is *not* changing, and why

`src-tauri/src/storage/migrations.rs` gets **no new migration**. `LATEST` stays 6. Answering the three questions from CLAUDE.md for the whole of this change: it **stores** two new localStorage keys (`null.sidebar.width`, `null.sidebar.open`) and nothing else new anywhere; it **transmits** nothing — no new network path is touched, no new outbound connection exists; it **remembers** the real `<title>` of pages you visit in the existing local `history.title` column instead of a hostname, which is strictly less lossy and strictly as local.

---

## 4. COMPONENT PLAN

### 4.0 The measured colour table — read this before choosing any class string

Computed from `src/index.css` (OKLCH → linear sRGB → WCAG relative luminance, alpha composited over `--background`):

| palette / mode | select on muted | fg on muted | fg on accent | select on bg | **border on bg** | muted-fg on bg | subtle on bg |
|---|---|---|---|---|---|---|---|
| aka dark | 7.96 | 18.96 | 17.34 | 8.32 | **1.21** | 7.98 | 4.37 |
| aka light | 4.69 | 17.26 | 15.28 | 5.05 | **1.32** | 6.54 | 3.34 |
| slate dark | 6.06 | 14.71 | 12.63 | 6.65 | **1.28** | 7.12 | 2.83 |
| slate light | 4.59 | 15.90 | 13.90 | 5.08 | **1.50** | 5.39 | 2.34 |
| sand dark | 7.68 | 14.73 | 13.20 | 8.35 | **1.21** | 6.96 | 2.46 |
| sand light | **4.46** | 12.14 | 10.15 | 5.06 | **1.75** | 5.69 | 2.40 |
| 0400am dark | 7.71 | 12.39 | 7.80 | 4.71 | **1.20** | 4.55 | 1.61 |
| 0400am light | **1.76** | 4.91 | 4.69 | 5.10 | **1.40** | 13.47 | 5.22 |
| mudd dark | 6.08 | 14.48 | 9.95 | 7.53 | **1.54** | 7.22 | 3.12 |
| mudd light | **3.55** | 10.16 | 8.77 | 4.73 | **1.78** | 4.67 | 3.24 |
| cyberspace dark | 4.75 | 7.40 | 6.07 | 6.56 | **1.80** | 10.21 | 3.50 |
| cyberspace light | **4.27** | 12.88 | 8.43 | 5.34 | **1.58** | 4.67 | 3.85 |

Three consequences, all binding:

1. **`bg-muted text-select` — today's active-toggle recipe (App.tsx:735/744/754/763/777/938) — fails 4.5:1 in four palettes and is 1.76:1 in 0400am light.** It survives today only because it carries a 12px pill and 16px icon glyphs. Promoting it to the 13px text label of every row in the app's permanent primary navigation would be a real legibility failure. **It is not used in the sidebar.**
2. **`--border` never clears 1.80:1 against `--background`.** Hairlines in this app are structural, not the primary separation. Nothing in this design *depends* on a border being seen — which is exactly why the page is flush (the page's own ground is the edge) and why the inset card was rejected. Raising `--border` to ~2.5:1 across all twelve blocks is a worthwhile follow-up; **do not make this design contingent on it.**
3. **`--subtle` fails 4.5:1 in eleven of twelve.** It stays a decorative tier: kickers only, never row content. New surfaces use `text-muted-foreground` (min 4.55) for trailing metadata. The existing `text-subtle` timestamps in `HistoryPanel.tsx:124` and `NetworkInspector.tsx:200,251` are a known defect logged for a later sweep — do not churn them in this change, and do not copy them.

**The row-state ramp**, therefore, uses fills and never a tinted label:

| State | Class | Worst measured |
|---|---|---|
| Focused selection (what the content area is showing) | `bg-accent text-foreground` | 4.69 ✓ |
| Unfocused selection (your tab, while a Library destination is open) | `bg-muted text-foreground` | 4.91 ✓ |
| Hover | `bg-muted/50 text-foreground` | — |
| Idle | `text-muted-foreground` | 4.55 ✓ |

`bg-accent` is the stronger fill in every palette, and `SettingsPanel.tsx:140` already uses `bg-accent` for its active mode toggle, so this is an existing recipe rather than a new one. The focused/unfocused pair is literally AppKit's source-list behaviour. **`--select` appears in the sidebar exactly once**: a 5px `bg-select` loading dot, rendered **only on non-selected tab rows** (select on background: min 4.71 ✓; on a selected row it would be 1.76 and would collide with the selection anyway, and the toolbar progress line already reports that the active tab is loading).

### 4.1 Created

| File | Responsibility |
|---|---|
| `src/components/Sidebar.tsx` | The whole source list: header, three sections, footer, one `DndContext`. Owns no data — receives `tabs`, `bookmarks`, `selection`, and callbacks from App. |
| `src/components/SidebarRow.tsx` | One 28px row. The single visual atom of the design. |
| `src/components/SidebarResizer.tsx` | The 8px drag strip + pointer capture + rAF throttle + snap + cancel recovery. |
| `src/components/Home.tsx` | The new-tab surface. Fetches `ipc.listArtifacts()` on mount. |
| `src/lib/layout.ts` | Rewritten — §2.0. |

### 4.2 Modified

| File | Change |
|---|---|
| `src/App.tsx` | Root flips `flex h-screen flex-col` (**:592**) → `flex h-screen bg-background text-foreground`. Toolbar rebuilt. Tab strip (**:597-623**), bookmarks bar (**:788-828**), `TabPill` (**:918-958**), `BookmarkBarItem`/`SortableBookmarkBarItem` (**:1061-1122**), `ZeroMark` (**:1126-1162**) and the landing block (**:860-870**) deleted. `TOOLBAR_HEIGHT`/`TAB_STRIP_HEIGHT`/`BOOKMARK_BAR_HEIGHT`/`PROGRESS_BAR_HEIGHT`/`PROFILE_STRIP_WIDTH` (**:55-65**) and `topBarHeight`/`showTabStrip`/`showBookmarkBar` (**:122-129**) all deleted. The keydown switch (**:507-556**) deleted; Escape (**:493-505**) retained. |
| `src/components/panels/SettingsPanel.tsx` | Absorbs ProfileMenu's three unique sections — Start page (**ProfileMenu.tsx:191-206**), Search (**:207-216**), Clear browsing data (**:217-236**) — plus the profile-name field (**:71-86**), as new `<Section>`s using the existing `Section`/`Row` primitives (**SettingsPanel.tsx:34-64**). Gains a Privacy row `History · {n} entries · Clear`. |
| `src/components/panels/HistoryPanel.tsx` | Unchanged internals. Reached from the sidebar instead of a toolbar button. |
| `src/components/panels/NetworkInspector.tsx` | Add the `style={{ contain: "layout paint style" }}` it is missing at **:82** (Settings and History both have it, and Network is the highest-churn panel). |
| `src/components/panels/ClipsDrawer.tsx` | Unchanged. Still the 380px right flex sibling. Header kicker corrected from `tracking-[0.18em]` (**:85**) to the canonical `tracking-[0.14em]`. |
| `src/lib/ipc.ts` | §3.4. |
| `src/lib/preferences.ts` | Two keys added following the existing `safeGet`/`safeSet` + mirror-effect pattern (**:21-35, 126-136**): `null.sidebar.width`, `null.sidebar.open`. |

### 4.3 Deleted

- **`src/components/panels/ProfileMenu.tsx`** (391 lines). It duplicates SettingsPanel's palette swatch map character-for-character (**ProfileMenu.tsx:153-172** vs **SettingsPanel.tsx:75-95**), it can float over an open Network Inspector because its toggle clears only two of four siblings (**App.tsx:772-776**), and opening it physically reflows the live web page by 336px (**App.tsx:65, 231-232**). Deleting it removes `PROFILE_STRIP_WIDTH`, the outside-click `mousedown` listener with its `setTimeout(0)` hack, and one entry from the resize effect's dependency array.
- **`BookmarkEditPanel`** (App.tsx:960-1059) is **retained** but re-mounted from `fixed left-1/2 top-20 z-50` to `absolute` inside the content column, so it stops being the one surface in the app that can cover the chrome. Do **not** replace it with inline rename: that would silently remove URL editing, and a broken bookmark would become unfixable except by delete-and-recreate.

### 4.4 Key class strings

**Root** (App.tsx:588-593):
```tsx
<div data-tauri-drag-region onMouseDown={handleChromeMouseDown}
     className="flex h-screen bg-background text-foreground">
```

**Sidebar shell:**
```tsx
<aside className="relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-background"
       style={{ width: sidebarWidth }}>
```

**Sidebar header** (drag surface; toggle at the fixed x):
```tsx
<div data-tauri-drag-region
     className="flex shrink-0 items-center"
     style={{ height: SIDEBAR_HEADER_HEIGHT, paddingLeft: TRAFFIC_LIGHT_INSET }}>
  <Button variant="ghost" size="icon" aria-label="Hide sidebar" title="Hide sidebar · ⌃⌘S">
    <PanelLeft strokeWidth={1.5} />
  </Button>
</div>
```

**Nav scroll region — one drag opt-out covers every descendant**, because `handleChromeMouseDown` (App.tsx:180-198) walks up from the target and bails on the first `data-tauri-drag-region="false"`. This is what makes the per-item opt-outs on `TabPill` (**:934**) and `SortableBookmarkBarItem` (**:1111**) unnecessary:
```tsx
<nav data-tauri-drag-region="false" className="flex min-h-0 flex-1 flex-col px-2">
```

**Section kicker.** Exact CLAUDE.md:79 type, `text-muted-foreground` rather than `text-subtle` for the measured reason in §4.0:
```tsx
<div className="flex h-5 shrink-0 items-center px-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
  Bookmarks
  <span className="ml-auto tabular-nums">{count}</span>
</div>
<div className="border-t border-border" />
```

**Row** (`SidebarRow.tsx`) — the atom:
```tsx
<div
  role="option" aria-selected={focused}
  onClick={onActivate} onContextMenu={onContextMenu}
  className={cn(
    "group flex h-7 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
    focused  ? "bg-accent text-foreground"
    : selected ? "bg-muted text-foreground"
    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
  )}
>
  <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
    {loading && !focused && <span className="h-[5px] w-[5px] rounded-full bg-select" />}
  </span>
  <span className="min-w-0 flex-1 truncate">{label}</span>
  {trailing}
</div>
```

Trailing close affordance on tab rows — the app's uniform hover-reveal, lifted verbatim from `TabPill` (App.tsx:944-954):
```tsx
<button type="button" aria-label="Close tab" onClick={stopAnd(onClose)}
  className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100">
  <X size={10} strokeWidth={1.5} />
</button>
```

**New Tab row** — inside the tab scroller so the list keeps its rhythm rather than sprouting a floating button:
```tsx
<button type="button" onClick={onNewTab}
  className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
  <Plus size={12} strokeWidth={1.5} /> New tab
</button>
```

**Library + footer** — pinned, outside the scroller:
```tsx
<div className="shrink-0 px-2 pb-2"> …kicker + 3 rows… </div>
<div className="shrink-0 border-t border-border px-2 py-1">
  <SidebarRow label="Settings" icon={<SettingsIcon size={14} strokeWidth={1.5} />}
              trailing={<span className="truncate text-xs text-muted-foreground">{profileName}</span>} />
</div>
```

**Toolbar band:**
```tsx
<div data-tauri-drag-region className="flex shrink-0 items-center gap-0.5 pr-2"
     style={{ height: TOOLBAR_HEIGHT, paddingLeft: sidebarOpen ? 8 : TRAFFIC_LIGHT_INSET }}>
```

**URL field** — capped, always `flex-1`, no landing morph. The `hasActiveWebview ? "flex-1" : "mx-auto max-w-[420px]"` at **App.tsx:668** and the `text-center focus:text-left` at **:712** are both deleted; one less thing that jumps, and Null never hides the current address:
```tsx
<form onSubmit={handleSubmit} data-tauri-drag-region="false"
      className="mx-auto w-full max-w-[640px] flex-1">
  <div className="group flex h-[26px] w-full items-center rounded-md border border-transparent bg-muted/70 transition-colors focus-within:border-[color-mix(in_srgb,var(--select)_50%,transparent)] focus-within:bg-muted">
```
(unchanged from **App.tsx:674**, including the bookmark star at **:675-694** with its `text-select` fill — select on background, 4.71 min ✓).

**Progress row + the chrome rule:**
```tsx
<div data-tauri-drag-region className="relative shrink-0 border-b border-border bg-background"
     style={{ height: PROGRESS_HEIGHT }}>
  <TopProgress active={activeLoading} />
</div>
```
`TopProgress` is unchanged — it returns `null` when idle and the row keeps its height regardless, so chrome height is still stable during a load.

**Content column** — the panels inherit the new frame for free and need **no per-panel change**, because they are already `absolute inset-0` inside this box (SettingsPanel.tsx:18, HistoryPanel.tsx:44, NetworkInspector.tsx:82). Do not promote them to window-level `fixed` during the restructure or they will cover the sidebar:
```tsx
<div data-tauri-drag-region="false" className="relative flex min-h-0 flex-1">
  <div className="relative flex-1"> {home ?? panels} </div>
  {showClips && <ClipsDrawer … />}
</div>
```

### 4.5 The selection model

Five booleans collapse to one value. The three overlays are **already** mutually exclusive by construction (App.tsx:458-474) — each toggle zeroes the other two — so this names a state machine that is effectively already written:

```ts
type Selection =
  | { kind: "tab"; id: string }
  | { kind: "panel"; id: "history" | "network" | "settings" };
```

`showClips` stays an independent boolean — the drawer is a companion to a live page, not a destination. `pageHidden = selection.kind === "panel" || !activeTab.hasWebview` replaces `modalOpen` (**App.tsx:120**) and `showLanding` (**:121**), which are today two expressions for one idea.

Also fix the race the current code papers over with `eslint-disable exhaustive-deps` at **App.tsx:249**: `activateTabById` calls `ipc.activateTab` *and* the effect at **:242-250** calls it again. Make the effect the sole owner — callbacks only set React state; one effect keyed on `[pageHidden, selection]` decides `hideAllTabs()` vs `activateTab(id)` and issues the matching `focusShell()` / `focusTab(id)`.

### 4.6 The geometry effect — avoid the render storm

Do **not** put `window.innerWidth` into `useState`; that re-renders the whole chrome tree at 60Hz during a window drag, which is precisely what the current imperative listener at **App.tsx:226-238** avoids. Keep `contentRect` a pure function, hold the latest result in a ref, and lift only `sidebarWidth` / `sidebarOpen` / `showClips` into React state:

```tsx
const rectRef = useRef<ContentRect>(contentRect({ …initial }));
const syncFrame = useCallback((only?: string | null) => {
  rectRef.current = contentRect({
    winW: window.innerWidth, winH: window.innerHeight,
    sidebarWidth, sidebarOpen: effectiveOpen, clipsOpen: showClips,
  });
  ipc.resizeContent(rectRef.current, only).catch(() => {});
}, [sidebarWidth, effectiveOpen, showClips]);

useEffect(() => {
  window.addEventListener("resize", () => syncFrame());
  syncFrame();
  return () => window.removeEventListener("resize", () => syncFrame());
}, [syncFrame]);
```

Every `openTab` call site (**App.tsx:293, 308, 329**) passes `rectRef.current`. One function, one object, both paths — the divergence that produces today's "new tab covers the drawer" bug becomes unrepresentable.

### 4.7 Drag and drop

One `DndContext` in `Sidebar.tsx`, two `SortableContext`s, both `verticalListSortingStrategy` — a one-word swap from `horizontalListSortingStrategy` (**App.tsx:803**).

- **Bookmarks:** reuse the existing optimistic `arrayMove` → `ipc.reorderBookmarks` → refetch-on-rejection rollback verbatim (**App.tsx:153-169**).
- **Tabs:** bare `arrayMove`, no IPC — tabs are frontend state with no persistence, so there is nothing to write and nothing to roll back.
- **Cross-section drag is not implemented in v1.** Bookmarking is the star (App.tsx:675-694) and ⌘D; a second gesture for it is ambiguity, not affordance.
- **Drop `KeyboardSensor` from this DndContext.** `useSortable` injects its own `tabIndex`/`role="button"` and its `KeyboardSensor` binds Space to "pick up", which collides head-on with Space-to-activate in a listbox. Reorder is bound to ⌥↑/⌥↓ as explicit handlers instead, and the row's own `role="option"` overrides dnd-kit's injected role. Keep `PointerSensor` at its 6px activation distance (**App.tsx:145**) so a click still clicks.
- **`role="listbox"`, not `role="tree"`.** Three flat sections with no nesting; a tree obliges `aria-level`/`aria-setsize`/`aria-posinset` on every row for no benefit and makes VoiceOver announce expand levels that do not exist. Sections are `role="group"` with `aria-label`.

---

## 5. INTERACTION

### 5.1 Keyboard — the complete map

Everything below except Escape and in-field editing is a **native menu accelerator**, so it fires regardless of which webview holds focus. `menu.rs` registers zero custom accelerators today, so all of this is new ground.

**Null** — About · **Settings… ⌘,** *(the Mac convention is the app menu, not View)* · Services · Hide · Quit
**File** — New Tab **⌘T** · Close Tab **⌘W** · Close Window **⇧⌘W** · — · Clip Page **⇧⌘C** · Clip Selection **⌃⇧⌘C**
**Edit** — predefined items, unchanged (menu.rs:30-43)
**View** — Hide/Show Sidebar **⌃⌘S** · — · Open Location **⌘L** · Reload **⌘R** · — · Clips **⌘/** · Network Inspector **⇧⌘I** · — · Theme ▸ · Appearance ▸
**History** — Back **⌘[** · Forward **⌘]** · — · Show All History **⌘Y**
**Bookmarks** — Add Bookmark **⌘D**
**Window** — Minimize · Zoom · — · Next Tab **⌃⇥** · Previous Tab **⌃⇧⇥** · — · Tab 1–8 **⌘1–⌘8** · Last Tab **⌘9**

Every shortcut that exists today is preserved with its current binding: ⌘L, ⌘T, ⌘W, ⌘R, ⌘D, ⌘Y, ⌘,, ⌘/, ⌘⇧I, ⌘[, ⌘] (App.tsx:509-555). Four deliberate changes:

1. **⌘W is now unambiguously Close Tab.** It is currently double-claimed between `PredefinedMenuItem::close_window` (menu.rs:75) and the React handler (App.tsx:518), so today's behaviour is OS-arbitrated. Close Window moves to ⇧⌘W, which is Safari's mapping. **⌘W on a lone blank tab closes the window** — otherwise the last ⌘W leaves you staring at an empty shell that no longer responds to the key you just pressed.
2. **⌃⌘S, ⌃⇥/⌃⇧⇥, ⌘1–⌘9 are added.** ⌃⌘S is Finder/Mail/Notes' Show Sidebar. Positional tab switching stops being a nicety the moment the Nth tab is no longer at a predictable x.
3. **⇧⌘C / ⌃⇧⌘C are added** for clip page / clip selection, so the product's distinctive verb has a keyboard path. Not ⌘S — that collides with save-page muscle memory and with in-page save handlers.
4. **Every remaining React keydown case is deleted.** One source of truth. Escape stays in React (it is not a menu accelerator) with its existing behaviour (App.tsx:493-505), meaning exactly one thing: *return to the page*.

**Within the sidebar** (roving `tabIndex`, `scrollIntoView({block:"nearest"})` on change):
↑/↓ move across **all** rows as one continuous list, skipping kickers · Return/Space activate · ⌥↑/⌥↓ reorder within the section · ⌫ closes a tab (bookmarks are removed via the context menu only — Null has no undo, so the one destructive row does not get a bare-keystroke path).

**Focus routing is mandatory, not optional.** ⌘L and ⌘T call `focus_shell` **in Rust, before** the `menu-action` event is emitted (§3.3), because DOM `.focus()` on a non-first-responder webview paints the ring and swallows the keystrokes. On the way back, `activate` calls `set_focus()` on the shown tab so space/arrows/PageDown scroll the page without a click. Verify this on hardware with a page focused; `cargo check` proves nothing here.

### 5.2 Mouse — every affordance

**Sidebar**
- Click a tab row → activate; click a bookmark row → navigate the active tab.
- ⌘-click or **middle-click** a bookmark row → open in a new tab. Middle-click a tab row → close it. Both are daily habits and the rows already have a pointer handler.
- Hover a tab row → close `X` fades in (`opacity-0 group-hover:opacity-100`).
- Right-click a bookmark row → the existing native menu via `ipc.showBookmarkMenu(id)` (commands/bookmarks.rs:60-103), unchanged: Open in New Tab / Edit… / Copy URL / Delete. Apple uses context menus, not visible buttons.
- Right-click a tab row → new native menu, same `bmk:`-style prefix pattern: Close Tab / Close Other Tabs / Bookmark This Tab.
- Drag a row within its section to reorder.
- Click `+ New tab` at the bottom of the tab list.
- Click a Library row → Clips toggles the drawer; History/Network/Settings select that panel. Clicking the selected panel row again deselects it and returns to the page — the same toggle semantics the toolbar buttons have today.
- Drag the sidebar's right edge (8px strip, `cursor-col-resize`) to resize; **double-click it to reset to 240**. 8px, not 4px — macOS splitters are 6–9px and 4px is below comfortable acquisition. The strip lives *inside* the sidebar at x = SW−8..SW; x > SW is the page, where React receives no events at all.
- Drag anywhere in the sidebar header to move the window.

**Toolbar**
- Sidebar toggle (only rendered when collapsed; when open it lives in the sidebar header at the same screen x) · Back · Forward · Reload · URL field with its bookmark star · **Scissors — clips the current page immediately**, confirmation being the glyph swapping to a `--select` check for ~1.2s (ClipsDrawer's existing copied-tick, reused) · Plus — new tab.

That is **two** trailing buttons where there are six today. Note the split: the toolbar Scissors *captures*, the sidebar's Clips row *opens the drawer*. Today Scissors does neither directly — it opens the drawer, and capture is two more buttons inside it (ClipsDrawer.tsx:112-138), so the product's primary verb costs two clicks. Now it costs one, and browsing your clips still has a mouse affordance.

**Collapsed sidebar is never a trap.** This was a fatal flaw in Source List: collapse left the user with no tab UI and no mouse route to anything. Here, `⌃⌘S` with 40 tabs open still leaves the toolbar's sidebar toggle at a fixed, always-visible x=76, one click from the full list — and the auto-collapse threshold is keyed on resulting page width with hysteresis (§2.3), never on a raw window width that macOS Split View lands exactly on.

---

## 6. THE HOME SCREEN

Rendered by React into the content column when `!activeTab.hasWebview`. A tab whose url is `about:blank` gets `hasWebview: false` and **no native webview is created at all** (App.tsx:327-333), so Home has zero Rust dependency and zero native constraints. It is the one part of this design that could ship on its own.

**The governing rule — Home shows only what the sidebar cannot.** Bookmarks are permanently visible two inches to the left, so a Safari-style Favorites grid would be pure duplication. History and Network are one click away as destinations. What the sidebar lists but cannot show inline is **Clips** — and clips are the one thing in Null you deliberately made.

```tsx
<div className="absolute inset-0 overflow-y-auto">
  <div className="mx-auto max-w-2xl px-8 pt-20">
    <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      Clips
    </h2>
    <div className="mt-3 border-t border-border">
      {clips.slice(0, 6).map(c => <HomeClipRow key={c.id} clip={c} />)}
    </div>
  </div>
</div>
```

**Row** — 52px, the codebase's one documented list rhythm (`containIntrinsicSize: "auto 52px"`, HistoryPanel.tsx:110), stacked rather than side-by-side so the hierarchy rests on size *and* colour rather than a one-pixel size delta:

```tsx
<div className="group flex items-center gap-3 border-b border-border py-2 last:border-b-0 hover:bg-muted/30"
     style={{ contentVisibility: "auto", containIntrinsicSize: "auto 52px" }}>
  <button className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
    <span className="truncate text-sm text-foreground">{clip.title || "Untitled"}</span>
    <span className="truncate text-xs text-muted-foreground">{kind} · {host}</span>
  </button>
  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span>
</div>
```

Click opens the clip in ClipsDrawer's existing `ClipViewer` — the master/detail component is reused verbatim, not rewritten. ⌘-click navigates this tab to `source_url`.

**Empty state** — the app's existing idiom exactly (headline + one sentence, no illustration, no button; HistoryPanel.tsx:165-175, NetworkInspector.tsx:280-300, ClipsDrawer.tsx:179-189):

> **Nothing saved yet.**
> Null writes clips as markdown to `{notesDir}`.

using the real path from `ipc.getNotesDir()`. That is invariant 5 stated as a fact rather than a boast.

**Removed, and why:** the `ZeroMark` SVG (App.tsx:1126-1162) — its `feGaussianBlur` is a drop shadow wearing an SVG filter's clothes, and it is the codebase's only violation of "nothing the chrome draws has a drop shadow." Strip the filter and move the flat two-ellipse mark to Settings → About, where an identity mark belongs. Also removed: the hardcoded shortcut cheat-sheet row (App.tsx:865-867) — shortcuts now live in the menu bar, which is where a Mac user looks, and printing them on the surface you see forty times a day is onboarding cruft.

**Not included, deliberately: any counter.** All three candidate designs proposed a variant of `TODAY · 412 REQUESTS · 38 BLOCKED`, and all three judges independently called it out. A number that ticks upward while you look at it is a dashboard element no matter how privacy-flavoured the framing — it is Brave's shield count with better manners. It also duplicates a readout the Network Inspector already renders (`NetworkInspector.tsx:100-107`) in a different type register, which is the exact sin cited to justify deleting ProfileMenu. And the underlying data cannot honestly carry the word "today": `MAX_EVENTS: usize = 2000` on an in-memory `VecDeque` (network/mod.rs:25) saturates after a few dozen page loads and resets on every launch.

**Why this is calm and not a dashboard.** It is one list, of things you made, ranked by recency, with a hard cap of six. Nothing on it moves, nothing counts up, nothing refreshes while you look at it, nothing is a call to action, and nothing is Null talking about Null. Its total element count is a kicker, a hairline, and at most six rows — against the current home's logo-plus-sentence-plus-cheat-sheet, that is *more useful* without being *more*. The test it must keep passing is the rule that produced it: if a thing is already visible in the sidebar, it does not belong here, which is what stops this drifting into a widget wall next quarter. And the way to get somewhere fast is the URL field, which is 20px above it in the toolbar and autofocuses on a blank tab — Null never hides the current address, which for a browser whose thesis is "you can see everything it does" would be exactly the wrong thing to hide.

---

## 7. MIGRATION

Eight phases. **The app builds, launches and browses at the end of every one.** This is the single most important correction to the candidate designs: Source List's feasibility judge measured that spec as ~2,600 lines touched with no shippable intermediate, in a repo with zero tests (CLAUDE.md states this explicitly). Do not land this as one branch.

| # | Phase | Lands | Verify by |
|---|---|---|---|
| **P0** | **Settings merge.** Move ProfileMenu's Start page / Search / Clear-data / profile-name into `SettingsPanel`; delete `ProfileMenu.tsx`; delete `PROFILE_STRIP_WIDTH` and drop `profileMenuOpen` from the resize effect's deps (App.tsx:239). | A standalone win on *today's* layout: opening a dropdown no longer reflows the web page. | Every ProfileMenu control still reachable; page does not shift when Settings opens. |
| **P1** | **`ContentRect` geometry.** §3.1(a)(b)(c), §3.2, §3.4, §4.6. `left` is still always 0 — **no visual change**. | Kills the two-divergent-paths bug and the double-`setFrame:`. | Open the Clips drawer, then open a 3rd tab. Today the page covers the drawer. After P1 it must not. |
| **P2** | **Focus transfer.** §3.1(d) + the two commands. Wire `focus_shell` into `hide_all` and `focus_tab` into `activate`. | The prerequisite for every later phase. | Load a page, click into it, press ⌘L (still the React handler at this point) — characters must land in the URL field. Press Escape, then Space — the page must scroll. |
| **P3** | **Real tab titles.** §3.1(e) + `objc2-web-kit` + widen the `TAB_UPDATED` payload; `hostnameFor` becomes the fallback (App.tsx:255). | Without this the sidebar's central claim is false: five tabs on one host render as five identical rows. | Open five GitHub pages; five distinct titles in SQLite and in the tab list. Test one strict-CSP site (a Google Doc) — the beacon route would have failed there; this one must not. |
| **P4** | **Native menu + accelerators + `set_menu_state`.** §3.3. Delete the React keydown switch (App.tsx:507-556). | One source of truth; ⌘W resolved. | With focus **inside a page**: ⌘R reloads, ⌘[ goes back, ⌘D bookmarks, ⌘L focuses the field. All four are broken today. |
| **P5** | **The Sidebar.** Root flip to `flex-row`; build `Sidebar`/`SidebarRow`; delete the tab strip, the bookmarks bar, `TabPill`, the bookmark-bar items, and all four height constants; rebuild the toolbar; introduce `Selection`. Sidebar width is a fixed 240, always open. | The visible change. | Chrome height constant at 41 in every state; opening a 2nd tab and saving a 1st bookmark cause no reflow; panels appear correctly boxed to the right of the sidebar with no per-panel edit. |
| **P6** | **Resize, collapse, persistence.** `SidebarResizer`, ⌃⌘S, the expand-flash ordering (§2.4), the `only:` drag optimisation (§2.5), auto-collapse with hysteresis, the two localStorage keys. | Makes the sidebar a real macOS sidebar. | Drag-resize on a heavy article page at 20 tabs — no stutter. Drop the pointer outside the window mid-drag — width must recover. Resize the window to 900×600 with the drawer open — sidebar collapses and restores on widen. |
| **P7** | **Home.** `Home.tsx`; delete the landing block and `ZeroMark`; flatten the mark into Settings → About. | Answers the second half of the ask. | ⌘T shows six clips or the empty state with the real notes path; URL field focused. |

**Honest effort.** Rust: P1 ≈ 0.5d, P2 ≈ 0.5–1d (first-responder debugging is always fiddly), P3 ≈ 1.5–2d including CSP-site testing, P4 ≈ 1.5d plus a half-day accelerator spike — call it **4–5 days**. Frontend: P0 ≈ 1.5d (it is an IA merge, not a delete), P5 ≈ 4d (~350 lines of Sidebar plus a root restructure of a 1,164-line file plus ~600 lines deleted), P6 ≈ 2d, P7 ≈ 1.5d, plus 3d integration and tab-lifecycle regression — call it **12–14 days**. **Total ≈ 16–19 focused working days**, or six to eight weeks of evenings for one person. Anyone quoting less has not counted P0 or the keyboard model.

**Do the accelerator spike and the focus spike in the same afternoon, before P0.** They are one experiment: bind ⌘L in the menu, `focus_shell`, type into a React input, Escape, `focus_tab`, press Space and confirm the page scrolls — on `github.com` and on a Google Doc. If that round trip works, the entire design is de-risked in one sitting. If it does not, you learn it before writing a thousand lines of UI.

---

## 8. WHAT WE ARE NOT BUILDING

**Workspaces.** They are a grouping model layered on *persisted* tabs, and Null's tabs are `{id, url, title, hasWebview}` in `useState` (App.tsx:74-79, 100) with no disk representation, no order, no group field and no session restore. Shipping them means new SQLite tables, a switcher, per-workspace bookmarks, and restore-on-launch — weeks of solo-maintainer work to solve tab sprawl. Null already has a better answer to tab sprawl, and it is the product's entire point: clip the page and close the tab. A filing cabinet would undercut the feature Null exists for.

**Split View.** Geometrically it is nearly free now — `set_content_frame` would take a map of per-tab rects instead of one shared rect. The cost is not in the geometry, it is in the eight places that assume one active tab: `activate` shows one and hides the rest (webview/mod.rs:160-173), `hide_all`, the single `activeId`, which tab the URL bar reflects, which tab Back drives, which tab Scissors clips. The door is left open by the rect refactor; the door is not walked through in v1.

**Glance / link peek.** Architecturally impossible, not merely expensive. Tab webviews are siblings added into the shell's parent NSView **after** it (wry-0.54.4/src/wkwebview/mod.rs:665), permanently above it, and neither Tauri nor wry exposes `addSubview:positioned:relativeTo:`. React can never paint over live page content. Making the shell transparent does not rescue it either: `wry/transparent` is gated behind Tauri's `macos-private-api`, which this repo does not enable (Cargo.toml:19), and NSView hit-testing ignores alpha, so a transparent shell on top would swallow every click meant for the page.

**Hover-reveal compact mode.** Same wall. The only two mechanisms available are shrink-the-webview and hide-the-webview, so hovering the left edge would physically reflow a live web page on mouse proximity — which is worse than no feature. This is the single most-loved thing about Zen's model and it is the one thing that cannot carry over. Compact mode toggles on ⌃⌘S and on the toolbar button; it does not follow the cursor. Finder does not hover-reveal either.

**An icon rail on collapse.** A collapsed-to-icons rail is the VS Code idiom. Finder's ⌥⌘S hides the sidebar outright, and so does ⌃⌘S here.

**An Essentials tier separate from bookmarks.** Zen ships Essentials *and* bookmarks and it is a redundancy: two favourites hierarchies with two mental models. Bookmarks are the pinned set. One tier, zero migration.

**Pinned tabs.** Same argument: a pinned tab is a bookmark that also costs memory.

**Favicons.** `img-src 'self' data:` (tauri.conf.json:26) forbids them outright, and fetching one per bookmark on every launch would be an outbound connection to every site the user has ever saved — a fingerprint surface and an invariant-2 violation dressed as decoration. Fetching them in Rust and re-serving as `data:` URIs is technically possible and is still an outbound connection per site. Rows are labelled instead, which is what Finder does.

**A ⌘K command palette.** ⌘L already opens the address field, no page can claim it, and every browser user already owns it. Binding ⌘K as a *menu* accelerator would be actively harmful: a menu key equivalent cannot be `preventDefault`ed, so GitHub's, Linear's, Notion's and Slack's own palettes would become permanently unreachable inside Null with no per-site escape. That is a browser-compatibility defect, not a preference.

**Zen's theme marketplace / mods.** Six palettes, twelve blocks, one maintainer, and four of those blocks already have a contrast defect (§4.0). Fix what exists before adding more.

---

## APPENDIX — follow-ups this spec deliberately does not do

1. **Raise `--border`.** It measures 1.20–1.80:1 against `--background` in all twelve blocks. Nothing here depends on it, but it should clear ~2.5:1.
2. **Fix `--select` on `--muted`** in sand light (4.46), cyberspace light (4.27), mudd light (3.55) and 0400am light (**1.76**). CLAUDE.md already requires ~4.5:1 for select; it is simply unenforced. The sidebar avoids the recipe, but the existing toolbar toggles and `TabPill` use it today.
3. **Move `text-subtle` timestamps to `text-muted-foreground`** in `HistoryPanel.tsx:124` and `NetworkInspector.tsx:200,251` — `--subtle` fails 4.5:1 in eleven of twelve palettes.
4. **Add a contrast gate to CI.** ~30 lines (OKLCH → linear sRGB → relative luminance), asserting select-on-muted, select-on-background, subtle-on-background and muted-foreground-on-muted ≥ 4.5 for every palette. It would have caught 0400am light's 1.76:1 before it shipped. A working implementation of the maths is at `/private/tmp/claude-501/-Users-ieuanking-Desktop-old-prj-null-browser/28420d25-89b9-4dcb-865c-e54ce4bb8500/scratchpad/contrast.mjs`.
5. **`MutationObserver` on `<title>`** through the existing `null-event://` transport, for SPA route changes that P3's load-finish sample misses.
6. **Reconcile PanelHeader's drifted kicker** (`text-[11px] tracking-[0.18em]`, PanelHeader.tsx:15) with the canonical `text-[10px] tracking-[0.14em]` from CLAUDE.md:79. Three kicker variants currently coexist.