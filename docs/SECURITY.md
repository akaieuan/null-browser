# Security

Null is a browser, so it runs hostile code by design. Everything here
exists to keep that code inside the tab it arrived in.

## The shape of the process

The window holds two kinds of webview:

- **The shell** — one privileged webview running the React chrome. It can
  call Tauri commands.
- **Tabs** — one native child webview per tab, each showing a site. They
  cannot call Tauri commands.

Every rule below follows from that split: the shell must never be
navigated by a page, and a page must never reach a command.

## What holds the line

| Control | Where |
|---|---|
| Shell can only navigate to its own origin | `is_shell_url` + the `navigation-guard` plugin, `src-tauri/src/lib.rs` |
| Tabs load `http`/`https` only — no `file:`, `javascript:`, `data:` | `parse_web_url`, `src-tauri/src/webview/mod.rs` |
| Strict CSP on the shell; no `unsafe-eval`, no remote origins | `app.security.csp`, `src-tauri/tauri.conf.json` |
| Minimal capability set for the main window | `src-tauri/capabilities/default.json` |
| Note deletion confined to the notes directory | `delete_note`, `src-tauri/src/notes.rs` |
| Note deletion keeps a file the user edited externally | `delete_note` content check, `src-tauri/src/notes.rs` |
| Favicons: PNG-magic + size + origin validation in Rust | `favicons::ingest`, `src-tauri/src/favicons.rs` |
| Popup windows (`window.open`) are tab-class, never shell-class: `popup-*` labels get http/https/about only from the navigation guard, and no capability grants IPC to them | guard in `src-tauri/src/lib.rs`; `on_new_window` in `webview/mod.rs` |
| Download filenames are page-controlled input: sanitized (no separators or control chars, length-capped), written only under `~/Downloads`, collision-suffixed | `sanitize_filename` / `unique_download_path`, `webview/mod.rs` |
| Markdown links open in a tab, never in the shell | `markdownComponentsFor`, `src/components/panels/NotesPanel.tsx` |
| Blocking runs inside WebKit, before a request is issued — a page cannot script around it the way it can around an injected script | `WKContentRuleList` compiled in `src-tauri/src/blocklist/mod.rs`, attached in `create_tab` |
| Popups carry the same rule lists as tabs | `blocklist::attach_window` in the `on_new_window` popup arm, `webview/mod.rs` |
| User-blocked origins are blocked for every resource type including `document`, which covers the popup route `on_navigation` never saw | `origin_rule` omits `resource-type`, `src-tauri/src/blocklist/mod.rs` |
| The blocklist is compiled in, never fetched | `include_str!("ads.json")`; generated offline by `scripts/blocklist/generate.mjs` |

### `macOSPrivateApi` (2026-08-26)

The vibrancy look requires `app.macOSPrivateApi: true`. Two costs,
accepted deliberately (decision recorded in the redesign spec):

- **Private WebKit key on every webview.** The flag enables
  `wry/fullscreen`, which sets the private `fullScreenEnabled`
  preference on `WKPreferences` for all webviews — including tabs that
  render hostile page content. That is one extra capability granted to
  pages (element fullscreen), not a code path pages can script beyond
  requesting fullscreen. Watch wry release notes: if the flag ever
  grows more private-API side effects, this entry is stale.
- **No Mac App Store distribution.** Private API use is disqualifying.
  Null distributes its own signed builds; the door closed here was not
  one being walked through.

Transparency itself applies to the *shell* window and webview only. Tab
webviews are built with `WebviewBuilder::new` defaults, which keep
`transparent: false` — a page cannot see or draw through to the desktop.

The shell's CSP allows `style-src 'unsafe-inline'` and nothing else
loose. That is not optional: the styling layer emits inline styles, and
the alternative is a nonce plumbed through a static bundle. It costs
nothing here — there is no untrusted markup in the shell, because clip
markdown is rendered through react-markdown with raw HTML disabled.

`null-event://` is a one-way channel from tab to Rust, carried on image
GETs rather than `fetch` because `img-src` survives more sites' CSPs than
`connect-src` does. Nothing travels back down it, and it grants a page no
capability it did not already have. It has two routes:

- `null-event://log` — the subresource observer. Observation only.
- `null-event://favicon` — the favicon channel (the "second caller"
  this section warned about; reviewed 2026-08-26). One un-chunked
  beacon per page load carrying `u` (origin) and `d` (icon). The
  payload is page-controlled input later rendered in the shell, so
  `favicons::ingest` trusts none of it: the origin is re-parsed and
  re-serialized (http/https only), and the icon must be a
  `data:image/png;base64,` URL that decodes, starts with the PNG magic
  bytes, and stays under 32 KB. Anything else is dropped without
  reply. The shell only ever puts the stored value in an `<img src>`;
  a `data:image/png` URL there renders pixels and can execute nothing.
- `null-event://artifact` — the extraction channel, which carries actual
  page content back in chunks. `ingest_chunk`
  (`src-tauri/src/webview/extract.rs`) accepts a chunk only for a
  `req_id` it is actively awaiting, and the id reaches the page as a
  `var` inside the injected IIFE, so page script cannot read it and
  cannot forge a reply. Note that the id is the *only* thing
  authenticating a chunk — there is no check of which tab sent it — so
  if that scoping is ever weakened, or the channel grows a second
  caller, this needs revisiting.

### Content rule lists fail open (2026-08-27)

Both rule lists — the bundled ad list and the user's blocked origins —
are compiled asynchronously by WebKit. If a compile fails, the slot
stays empty, the failure goes to stderr as `null-blocklist: …`, and
browsing continues unblocked.

That is the right way round for the ad list, which is a preference. It
is worth knowing for the user's own blocked origins, which read like a
guarantee: **the rule list is the second layer, not the only one.** The
first is `network::record_navigation`, which cancels a navigation to a
blocked origin whether or not anything compiled. A compile failure
costs the subresource and popup coverage, not the navigation block.

The lists are also attached per webview, at creation. A tab or popup
built before the first compile lands gets them applied when the
completion handler runs, which is why `apply_to_all` sweeps every live
`tab-*` and `popup-*` rather than only the new one.

## Known open surface

`commands::search::*` (SearXNG) is registered and makes outbound HTTP,
but nothing in the frontend calls it — the search UI went with the AI
drawer. It is opt-in (no instance is configured by default, so invariant
2 holds) and `reqwest` is reachable from nowhere else in the process.
The README's roadmap tracks the decision: re-surface it, or cut the
backend and drop the HTTP client entirely. Until then it is a registered
command with network reach and no consumer — know that it is there.

## Auditing

```bash
npm audit
cargo audit --file src-tauri/Cargo.lock
```

Last run 2026-08-26: **0 vulnerabilities from npm, 0 from cargo-audit.**

`cargo audit` also reports 21 non-vulnerability advisories — 17
`unmaintained`, 4 `unsound`. Almost all are GTK3 bindings (`atk`, `gdk`,
`gtk`, `glib` and their `-sys` crates) reached through Tauri's Linux
backend. They are not compiled on macOS, the primary target, and they are
Tauri's transitive dependencies rather than ours: there is nothing to
upgrade here that would remove them. Treat the count as a number to
re-read when it *changes*, not one to drive to zero.

If a new advisory appears, check first whether it is severity-rated. A
rated vulnerability is a bug and gets fixed. An `unmaintained` warning on
a Linux-only transitive dependency is a note.

## Reporting

Open an issue at
[github.com/akaieuan/null-browser](https://github.com/akaieuan/null-browser).
There is no server, no account system and no telemetry endpoint, so
there is no infrastructure to disclose against — only the client.
