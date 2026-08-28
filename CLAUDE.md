# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Pre-v0.1. Shipped: scaffolding, browsing basics (tabs, nav, URL bar, bookmarks, history), themes, a **left source-list sidebar** owning tabs + bookmarks + library destinations, Network Inspector (main-frame + subresource capture, per-origin blocking), and **Clips** — capture a page or a selection as markdown, saved to SQLite and mirrored to `~/Documents/Null/` as plain `.md` files, with copy-to-clipboard.

The AI layer was **removed** (2026-08): no providers, no keychain keys, no chat, no summarize, no Ollama. Null captures; the user takes the markdown wherever they want it. Do not re-add inference without an explicit decision recorded in `docs/PHILOSOPHY.md`.

Navigation (2026-08-26): the top tab strip, bookmarks bar and profile dropdown are gone. Tabs and bookmarks live in a 240px left sidebar; Notes / History / Network / Settings are destinations. Chrome height is a constant 48px in every state, so opening a tab or saving a bookmark never reflows the live page.

Look (2026-08-26): the Zen-informed pass. The chrome is one `--chrome` ground (solid `--muted` in a plain browser; a translucent wash over window vibrancy in the app — `macOSPrivateApi` is on, see `docs/SECURITY.md`). The page and every React surface are opaque `--background` cards inset by `PAGE_GUTTER` (8px) with `--radius-xl` corners — native webview corners are rounded via CALayer in `webview/mod.rs`. **No hairline separators anywhere**: separation is tone step + space; `--border` is for control edges only (inputs, outline buttons) and is the only thing the 2.55:1 audit target applies to. Notes is summoned from the toolbar (⌘/), not the sidebar: a card drops in on the right, the page yields the width, and one control widens it to a half-window split; copy-as-markdown is its primary action. A closed sidebar hover-reveals when the pointer parks in the left gutter (Settings can turn this off). Split view: ⌥⌘S or the toolbar button pairs the active tab with the next; the gutter between panes is the drag divider; tabs and bookmark tiles can be dragged out of the sidebar onto the page to open a split. Settings (left-aligned, `align="left"` on `Panel`) owns Corners (one knob: CSS `--radius` + native CALayer radius via `set_tab_corner_radius`), Glass strength, and the hover-reveal toggle. UI atoms (`Kicker`, `Card`, `ListRow`) live in `src/components/ui/atoms.tsx` — compose them, don't restate their class strings. Specs: `docs/superpowers/specs/2026-08-26-sidebar-navigation-design.md`, `…-zen-redesign-design.md`.

Home (2026-08-28): the new-tab surface leads with **Reach** (`src/components/DataReach.tsx`) — a live hub-and-spoke map of where data goes, read from the network-event stream, replacing the retrospective "trackers seen" calendar (the `tracker_sightings` table and its command stay, just unsurfaced). It floats on the background (no card), reads at a glance, and stays calm when data is sparse. Below it, the recent notes as delete-able cards.

Theme (2026-08-28): one palette, **aka**, in light and dark — the other five were cut. The `data-palette` hook, the mode menu and the sidebar mode toggle stay; re-adding a palette is a CSS block plus a line in `src/lib/theme.ts`. Light mode's chrome sits a clearer step below the page than it used to (and the app's light glass wash is denser) so the sidebar reads.

Pins/folders (2026-08-28): a folder dissolves only when **its own** last pin leaves — not via a blanket empty-folder sweep — so an empty folder made with **New Folder** (a pin's native menu, or right-click on empty grid space) persists until filled. Dropping a pin anywhere on a folder tile files it in; dead-centre on another pin groups them. A top-level reorder must not drop in-folder pins from `bookmarks` state (see `onReorderBookmarks` in `App.tsx`). Folders never nest.

Security (2026-08-28): an audit found a **critical** gap — app IPC commands are callable from tab/popup webviews because the app ships no ACL manifest (bare `build.rs`, no `permissions/`, `windows:["main"]` capability that child tab webviews match). Not yet fixed; see the audit report and the spawned task. Fixing it (ACL manifest + a `webviews:["main"]`-scoped capability) needs runtime testing that the shell still works and tabs are blocked.

Native page webviews are positioned from one function — `contentRect()` in `src/lib/layout.ts` — which both `openTab` and `resizeContent` consume, so they cannot disagree about where the page goes.

Shortcuts are native menu accelerators, defined once in `src-tauri/src/menu.rs` — never `keydown` listeners in React. This is not a style preference: the chrome and every page are separate webviews, so a listener in the chrome stops firing the moment focus enters a page, which is exactly how ⌘R/⌘[/⌘] came to be silently broken before. An accelerator reaches the app regardless of which webview holds focus.

In progress: **M2 Phase 3**, half landed. `WKContentRuleList` blocking ships (`src-tauri/src/blocklist/`): user-shielded origins are refused for every resource type including `document` — which closes the popup route — and Null's own bundled ad/tracker list rides the same machinery, **off by default** behind `set_ad_blocking`. The list is `scripts/blocklist/null-list.txt`, hand-written here and compiled to `src-tauri/src/blocklist/ads.json` by `node scripts/blocklist/generate.mjs`; that JSON is committed and `include_str!`d, so nothing fetches a list — updating it is a commit (invariant 2, decision recorded in `docs/PHILOSOPHY.md`). Never vendor EasyList or any other filter project into it. Still open: the `WKScriptMessageHandler` half, which would close the inspector's CSP blind spots. Not yet done from the sidebar spec: sidebar drag-resize (⌃⇥ / ⌃⇧⇥ and ⌘1–9 tab switching both work). See `README.md` for the full milestone table.

Everything in `blocklist/mod.rs` that touches `WKContentRuleList` runs on the main thread — `Retained` is not `Send` and the compiled lists live in a `thread_local!`. Native entry points either start on the main thread (`init`, from `setup`) or hop there with `run_on_main_thread` first.

Stack: Tauri 2.0 + Vite + React + TypeScript. Bundle identifier `sh.null.browser`, Cargo package `null`, lib `null_lib`. Build matrix targets macOS, Linux, Windows (macOS is the primary target today).

## Commands

| Task | Command |
|---|---|
| Install JS deps | `npm install` |
| Dev signing setup (macOS, one-time) | `npm run dev:setup` |
| Dev (launches desktop window) | `npm run tauri dev` |
| Build release bundles | `npm run tauri build` |
| Build + install to /Applications | `npm run app:install` (removes the target/ bundle copy so Spotlight sees one Null.app) |
| Rust type-check only | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Rust lint (clippy) | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` |
| Frontend build | `npm run build` |
| Frontend dev server only | `npm run dev` |
| Re-capture `docs/screenshots/` | `npm run ui:shoot` (needs `npm run dev` running) |
| Audit palette contrast | `npm run ui:tokens` (`-- --write` to solve and rewrite) |
| Regenerate the blocklist after editing `null-list.txt` | `node scripts/blocklist/generate.mjs` (commit `ads.json` with it) |

Rust toolchain: stable, installed via `rustup`. If `cargo` isn't on `PATH`, run `source ~/.cargo/env` first.

`ui:shoot` and `ui:tokens` drive headless Chrome over the DevTools Protocol from `scripts/ui/cdp.mjs` — no puppeteer, no dependency. They point at the Vite dev server, where `src/lib/fixtures.ts` stands in for the Rust backend, so every list and panel has content without launching the app. Look at the screenshots after changing anything visual; several faults found this way (a panel header 300px left of its own content, a selected colour swatch marked in a colour that made it invisible) were invisible in the diff.

Dev signing (macOS): `npm run dev:setup` creates a self-signed `null-dev` code-signing cert in the login keychain. `tauri dev` then routes through `scripts/cargo-signed.sh`, which codesigns every dev build with a stable designated requirement, so macOS treats each rebuild as the same app. The wrapper falls through to plain cargo if no cert is present. No-op on Linux/Windows.

Tests: Rust unit tests exist (`notes.rs` round-trip parsing is the seed) and run in CI on all three platforms. There are no frontend tests yet. Do not invent commands that don't exist yet — if asked to "run the tests", check the state of the code first.

## The six invariants

Read `docs/PHILOSOPHY.md` before proposing anything that touches networking or storage. The six invariants in that document are not defaults — they are invariants. Code that violates them is a bug. Summarized:

1. Zero telemetry.
2. No default cloud connections. The browser must start and browse without contacting any service operated by this project or any third party other than the site the user is visiting.
3. No inference in the browser. Null does not run or call a language model.
4. Every outbound connection is visible through the network inspector — the inspector is a first-class surface, not a devtool.
5. Data lives with the user: SQLite and plain markdown on disk, no mandatory sync, no account system.
6. No dark patterns: no forced onboarding, no engagement retention, no "Skip for now".

Do not soften these when writing code, comments, PR descriptions, or user-facing strings.

## Security

`docs/SECURITY.md` records what keeps hostile page code inside its tab: the shell/tab webview split, the navigation guard, the scheme allowlist, the CSP, and the standing triage for `cargo audit` advisories. Read it before touching `src-tauri/src/lib.rs`, `webview/mod.rs`, or anything that renders content a page supplied.

## The three questions

Any change that touches networking or storage must be able to answer, from the diff alone:

- What does this **store**?
- What does this **transmit**?
- What does this **remember**?

If a reviewer cannot answer those three from the diff, the change is not ready. When drafting a PR description for such a change, answer them explicitly.

## "Assist, don't complete"

Null hands the user material and gets out of the way — it does not click, type, or navigate on their behalf. Treat any proposal for autonomous agent behavior as a feature that must be earned through explicit consent UX, never a default.

## Scope boundaries

- Null is **not a Chromium fork**. Do not propose vendoring Chromium or Gecko. The shell is Tauri; the web engine is the system WebView.
- Null has **no account system, no sync service, no telemetry endpoint, and no AI inference**. Do not add one, even "optional", without an explicit decision recorded in `docs/PHILOSOPHY.md`.
- Target platforms for v0.1: macOS, Linux, Windows.

## Design language

The UI follows akaSTYLE, Ieuan's personal design system. The rules that matter when touching `src/`:

- One accent: `--select` (quiet green in dark, blue in light). It marks chosen things — the active tab, selection, focus rings, connected/live state — and nothing else. `--danger` is the only other hue.
- Tokens are OKLCH custom properties in `src/index.css`; `aka` is the only palette now — the other five were cut, so the `data-palette` hook stays but there is one identity, in light and dark, with dark the reference mode. It defines the full token set including `--select` and `--danger`.
- Borders over shadows. Nothing the chrome draws carries a drop shadow.
- Motion moves space, never brightness — no opacity pulsing, no strobe; entrances gated on reduced motion. Durations, easings and the two shared entrance keyframes are below, under **Motion**.
- Mono for structure (kickers: `font-mono text-[10px] font-medium uppercase tracking-[0.14em]`, the URL bar), light sans for prose.
- Radius derives from `--radius: 0.625rem`: cards 12px (`xl`), buttons 10px (`lg`), inputs 8px (`md`), tags 6px (`sm`), code chips 4px (bare `rounded`).

New select/danger values must hold ~4.5:1 contrast against their palette's background — they carry small text (active tab, error rows), not just focus rings.

### Motion

One scale, and a change should be able to say which rung it is on. **~150ms `ease-out`** — Tailwind's bare default — is reaction: hover, fills, a selection bar scaling in. **160ms `ease-out`** is arrival, and every entrance uses one of the two shared keyframes in `src/index.css` rather than restating a transform: `np-drop` for things summoned from the toolbar and hanging off it (the Notes card, the find bar, the download chip), `np-rise` for a surface taking the content column (History, Network, Settings, a Settings section, a note card on Home). **220ms `ease-out-cubic`** is structural — a layout the native page shares. That duration lives in `FRAME_MS` in `App.tsx` and the curve in `--ease-out-cubic`, whose bezier is the CSS twin of the rAF tween engine's `1-(1-t)^3`; the sidebar's width, the toolbar's traffic-light inset and the page's native frame all run it at once, which is the only reason opening the sidebar reads as one motion and not three.

Motion moves space, never brightness — no opacity pulsing, no fade carrying an entrance, no strobe. A transform is the mechanism; a fill may follow it, never lead. Anything that moves space is gated with Tailwind's `motion-safe:` (a colour transition is not motion and stays bare), so the stylesheet needs no reduced-motion overrides — the one that remains is the progress bar's, where the fallback has to set a width rather than skip an animation. The native-frame tween checks `prefers-reduced-motion` itself and teleports. A live drag — the window edge, the split divider — is never animated: the pointer is the animation, and a tween still in flight is cancelled rather than left to pull against it.

## Voice

User-facing copy and docs should match the register of `README.md` and `docs/PHILOSOPHY.md`: direct, declarative, no marketing cadence, no AI-sounding prose ("dive into", "seamlessly", "empower", em-dash-heavy rhythm). When in doubt, re-read those two files and match them.
