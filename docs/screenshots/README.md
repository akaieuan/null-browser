# Screenshots

Most of what is here is generated. Run:

```bash
npm run dev        # in another terminal
npm run ui:shoot
```

`scripts/ui/shoot.mjs` drives headless Chrome over the DevTools Protocol,
walks the interface through each surface and each palette, and writes:

- `shots/` — one PNG per surface and per palette/mode, 1280×800 at 2×.
- `states.png` — the six surfaces on one sheet.
- `palettes.png` — all six palettes in both modes on one sheet.

It points at the Vite dev server, where `src/lib/fixtures.ts` stands in
for the Rust backend, so every list and panel has plausible content
without launching the app or exposing anything personal.

Regenerate after any visual change and look at the result. Faults that
were invisible in the diff and obvious in a screenshot: a panel header
sitting three hundred pixels left of the content it titled; a selected
colour swatch marked with a ring in the accent colour, on the swatch that
*is* the accent; two headers four pixels out of level across a seam.

Sheets are laid out in two columns on purpose. A single column of six
1600px-tall frames makes a ~9,400px image, which several upload paths
reject outright.

## The two shots the top-level README uses

- `overview.png` is a copy of the generated `shots/02-clips-drawer.png`.
  Refresh it by re-running `ui:shoot` and copying that frame over. It
  shows fixture data, which is fine for a hero — but it has no web page
  in it, because a tab is a native webview and does not exist when the
  chrome runs in an ordinary browser. Re-take it by hand if you want a
  real page in the frame.
- `network-inspector.png` is **not** generated and should stay that way
  for now. It shows 153 requests across 20 origins from one YouTube page
  load; that density is the point of the image and no fixture will
  reproduce it. Its surrounding chrome predates the sidebar and is out of
  date, but the panel itself still reads correctly. Re-take it from the
  running app when convenient.

To re-take either by hand, from the built app:

- 1440×900 logical (Retina → 2880×1800). `⌘⇧4`, then `Space`, then click
  the window for a window-only PNG with the macOS shadow.
- The `aka` palette in dark mode — the default, and the reference.
- Nothing identifiable in the address bar, tab titles, or history.
