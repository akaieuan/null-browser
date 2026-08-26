# Zen-informed redesign — research findings and reversals

**Date:** 2026-08-26
**Status:** researched, not approved. Nothing here is built except where noted.
**Supersedes parts of:** `2026-08-26-sidebar-navigation-design.md` §8
**Full writeup:** https://claude.ai/code/artifact/11261028-2da6-424e-b945-46eda59c4bae

Seven areas were researched against the installed source (tauri 2.10.3, wry
0.54.4, tao 0.34.8, window-vibrancy 0.6.0, dnd-kit 10.0.0, SQLite 3.46.0),
with adversarial passes on the two everything else rests on. Both held.

No area came back blocked. Five decisions recorded in the earlier spec are
reversed, and one is upheld against a proposal of my own.

---

## 1. Reversals — argued, not slipped in

The earlier spec's §8 is a list of deliberate refusals. Building past it
silently would leave the repo self-contradicting, so each reversal is stated
with the original text and the reason it does not hold.

### 1.1 Glance — reversed

> "Glance / link peek. Architecturally impossible, not merely expensive. Tab
> webviews are siblings added into the shell's parent NSView **after** it,
> permanently above it."

The premise is correct and still binding: React can never paint over a live
page. The conclusion does not follow. A glance does not need React paint — it
needs a second native child webview. And the recommended build needs neither:
hide the active tab, which is exactly what panels already do at
`App.tsx` `hideAllTabs`, and show the glance in the vacated rect. `hide()`
preserves the frame, so nothing reflows and no page state is lost.

Note-peek needs no Rust at all: `ClipViewer` and the hide-the-page mechanism
both already exist.

A second argument for hiding rather than overlaying: `--border` measures
1.20–1.80:1 against `--background` in all twelve palette blocks, so a glance
rectangle floating on arbitrary page pixels would have no visible edge.

### 1.2 Split view — reversed

> "The cost is not in the geometry, it is in the eight places that assume one
> active tab."

Cheaper than assumed. Non-active tabs are hidden with `setHidden:` — not
parked offscreen, not zero-sized — so showing N at once is one loop change in
`activate` (`src-tauri/src/webview/mod.rs`). `contentRect()` stays exactly as
it is and becomes the box a new pure `splitRects()` slices.

The draggable divider is **not** blocked, and it is not the same problem as
Glance. The shell webview is full-window with
`ViewWidthSizable|ViewHeightSizable` and merely occluded by tab webviews added
after it, so an 8px gutter no tab rect covers is a real hole in the native
geometry and `hitTest:` lands on the shell — the same reason the 240px sidebar
is clickable today. Glance needs React to paint *over* a page; a divider only
needs it to paint *between* pages.

Unproven: whether a drag started in the shell keeps receiving `pointermove`
once the cursor crosses onto a tab webview. Standard AppKit
mouseDown-owns-the-drag routing, but nothing in this repo has done it. One
afternoon, and it de-risks the still-unshipped sidebar resizer at the same
time.

### 1.3 Favicons — reversed on a false premise

> "`img-src 'self' data:` (tauri.conf.json:26) forbids them outright"

That CSP **permits** `data:`, which is exactly the form a captured icon takes.
The other two arguments in that entry attack fetch-per-bookmark-at-launch and
fetch-in-Rust; neither is the mechanism proposed. Capture happens in the tab,
from a page the user already chose to load, and travels back over the existing
`null-event://` chunked transport.

Two constraints that are not optional:

- The size cap and MIME allowlist must be enforced **in Rust**. The entire
  data URL is page-controlled input rendered inside the privileged shell.
- `docs/SECURITY.md` warns that the `null-event://` channel growing a second
  caller needs re-review. A favicon flow is that second caller. Record it.

### 1.4 Essentials tier / pinned column — reversed, conditionally

The original argument was that Essentials plus bookmarks is "two favourites
hierarchies with two mental models". That is correct for Zen, which ships
both. It is not what is proposed here: bookmarks *rendered as tiles* is one
tier, not two.

The `pinned` column reversal rests on the earlier spec's own reasoning —
"Dropping the tile grid removes the need for a second tier" — which is
conditional on dropping the grid and does not survive keeping it.

### 1.5 ⌘K — upheld, against my own proposal

> "A menu key equivalent cannot be `preventDefault`ed, so GitHub's, Linear's,
> Notion's and Slack's own palettes would become permanently unreachable
> inside Null with no per-site escape."

Correct, and a browser-compatibility defect rather than a preference. The
command bar takes `⌘L` and `⌘T`, which Null already owns. **⌘K stays unbound.**

Note the earlier entry's first clause also claims the palette is *redundant*
("⌘L already opens the address field"). That part does not hold: `⌘L` cannot
search notes, bookmarks and history, which is the new capability.

---

## 2. The visual direction — feasible, one flag, one spike

Vibrancy works because of z-order: `window-vibrancy` inserts its
`NSVisualEffectView` with `NSWindowOrderingMode::Below` at the very back of
the content view, while wry appends every tab webview to the front. The
vibrancy sits under everything; the opaque page sits on top of it.

Tab webviews stay opaque for free — `WebviewAttributes::default()` has
`transparent: false` and tabs are built with plain `WebviewBuilder::new`.

**Cost:** `app.macOSPrivateApi: true`. Without it both the NSWindow
transparency call and `drawsBackground=false` on the shell webview are
compiled out *silently*. It forecloses Mac App Store distribution, and it
pulls `wry/fullscreen`, which sets the private `fullScreenEnabled` key on
`WKPreferences` for every webview **including tabs** — a capability grant to
hostile page content. `docs/SECURITY.md` has no row for that today and needs
one before the flag lands.

**Unverified:** whether `masksToBounds` on the WKWebView's own layer clips
WebKit's *remote* layer tree. Not determinable from source. One-hour spike;
it gates the rounded corners, not the vibrancy.

---

## 3. Findings that are bugs, not features

- **Notes deletion destroys external edits.** Nothing reconciles an externally
  edited file back into SQLite, and deleting a note in Null deletes the file
  you edited in Obsidian without checking whether it changed. Silent data loss
  in the feature the product is about. Fix: stat-on-list plus read-on-open, not
  a filesystem watcher.
- **`usePreferences()` was instantiated twice** with no subscription, so
  Settings changes never reached the app. **Fixed** — one shared store backed by
  `useSyncExternalStore`.
- **`commands::search::*`** remains registered with outbound HTTP and no
  caller, and is the only thing pulling `reqwest` into the process.

---

## 4. Already built (unapproved, revertable)

Landed while researching, because the sidebar was the visible complaint:

- Clips → **Notes** across all user-facing strings. Menu *labels* changed; the
  action ids did not, so `⌘/`, `⇧⌘C`, `⌃⇧⌘C` cannot silently die from a
  label/handler mismatch.
- Section headings removed. Bookmarks are a 4-across tile grid; tabs carry a
  site mark; utilities are an icon rail; Notes keeps a labelled row and a count.
- Site marks are **derived from the hostname** (letter + hashed hue), not
  fetched. Real favicons are stage 5.
- Opening a blank tab when one already exists focuses it instead of stacking a
  second identical "New Tab" row.

---

## 5. Sequence

| Stage | What | Status |
|---|---|---|
| 0 | Card geometry: `--chrome` ground, `PAGE_GUTTER`, no hairlines, atoms | **built** 2026-08-26 |
| 0.5 | Notes delete-guard (external edits survive deletion) | **built** 2026-08-26 |
| 1 | Vibrancy (`macOSPrivateApi`), native rounded corners, theme sync | **built** 2026-08-26 — corners are the unproven `masksToBounds` spike; verify by eye |
| 2 | Hover-reveal sidebar from the left gutter | **built** 2026-08-26 — reveal resizes the page (React cannot float over it) |
| 3 | Notes as peek card; drawer removed | **built** 2026-08-26 |
| 4 | Split view MVP: `splitRects()`, `activate_many`, ⌥⌘S + toolbar toggle. Fixed 50/50; the gutter between panes is real shell surface, so the drag handle has somewhere to live | **built** 2026-08-26 — divider drag not yet |
| 4.5 | Favicon capture: page-side canvas re-encode to 64px PNG, `null-event://favicon` beacon, Rust validation (PNG magic, 32 KB, origin re-parse), per-origin SQLite, letter-tile fallback. Migration 007 | **built** 2026-08-26 |
| 4.6 | Duplicate-save guard: identical kind+URL+body returns the existing note, no new file | **built** 2026-08-26 |
| 4.7 | Note viewer typography: 22/17/15 scale, ~72-char measure, regular body, dinkus for `---`, tone-card quotes; judged by a 3-lens critique pass | **built** 2026-08-26 |
| 4.8 | Split divider drag (the inter-pane gutter is the handle); drag a tab row or bookmark tile onto the page to open a split | **built** 2026-08-26 |
| 4.9 | Notes rework: out of the sidebar, toolbar-summoned right card (`notesWidthFor`), expandable to half-window; copy-as-markdown primary; ⇧⌘C opens the card on the fresh note | **built** 2026-08-26 |
| 4.10 | Settings: left-aligned, Corners (CSS `--radius` + native radius in one knob), Glass strength, hover-reveal toggle; startup dedupe of pre-guard duplicate notes | **built** 2026-08-26 |
| 5 | Command bar window + capability entry | next |
| 6 | Tier + folder migration, focus-follows-click across panes | after 5 |

The earlier spec estimated 16–19 focused days for the sidebar work alone and
noted that anyone quoting less had not counted the keyboard model. These
carry the same caveat.

---

## 6. Decisions (resolved 2026-08-26)

Ieuan approved, in chat:

1. **`macOSPrivateApi: true` — yes.** Real glass. Forecloses Mac App Store;
   grants `fullScreenEnabled` (private) to tab webviews via `wry/fullscreen`.
   Both get rows in `docs/SECURITY.md` in the same change.
2. **Notes is a peek card, not a drawer.** The page hides (frame preserved),
   a notes card takes the vacated rect, Esc returns. The right-hand drawer
   and its `CLIPS_DRAWER_WIDTH` reservation are removed.
3. **Split view lands after glass** (stages 0–3 first).

Still open, non-blocking: glanced URL in history (rec: no), drag-to-tier
closes tab (rec: yes), SearXNG (rec: cut).

## 7. Also decided: no hairlines, anywhere

The de-line pass (2026-08-26) removed every `border-t/b/l/r` separator.
Separation is tone (`--chrome` wash vs `--background` card), space
(`PAGE_GUTTER = 8`), and hover fills. `--border` remains for control
edges only — inputs, outline buttons — and its 2.55:1 audit target now
applies only there. `--seam` exists for the rare division that must
survive arbitrary ground. akaSTYLE's "borders over shadows" holds: the
replacement for a border is tone + space, never a shadow.
