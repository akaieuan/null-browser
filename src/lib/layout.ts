// Layout constants and the single source of native-webview geometry.
// Kept outside panel modules so App.tsx can read them without eagerly
// pulling in the panel bundles.

export const SIDEBAR_DEFAULT_WIDTH = 240;

export const SIDEBAR_HEADER_HEIGHT = 38; // == TOOLBAR_HEIGHT, deliberately
export const TOOLBAR_HEIGHT = 38;
export const PROGRESS_HEIGHT = 2;

/**
 * The band of chrome background left on all four sides of the page.
 *
 * This replaced the 1px rules that used to separate the chrome, the
 * sidebar and the drawer from the page. A hairline was the only option
 * while the page ran to the window edge, because the page is arbitrary
 * content and nothing else can be assumed about the pixels on the far
 * side of the line. Inset it instead and the separator is a band of the
 * app's own ground — which needs no contrast target, cannot clash with
 * the site's colours, and reads as one calm surface rather than a grid.
 *
 * It is load-bearing, not decoration: with the rules gone, tightening
 * this to zero merges the sidebar into the page.
 */
export const PAGE_GUTTER = 8;

/**
 * Every native webview's y. Constant in every state — the tab strip and
 * bookmarks bar used to change it, which reflowed the live page just
 * because you opened a second tab.
 */
export const TOP_INSET = TOOLBAR_HEIGHT + PROGRESS_HEIGHT + PAGE_GUTTER; // 48

/**
 * Header height for every card surface that sits below the toolbar.
 * One constant so two open surfaces cannot have kickers that sit out
 * of level with each other.
 */
export const PANEL_HEADER_HEIGHT = 48;

/**
 * The Notes card's width in its narrow ("dropdown") state, including
 * the PAGE_GUTTER between it and the page. Wide mode is computed —
 * half the space the page had — not a constant.
 */
export const NOTES_PANEL_WIDTH = 348;

/** Notes region width for the two open modes. */
export function notesWidthFor(
  mode: null | "panel" | "wide",
  winW: number,
  sidebarWidth: number,
  sidebarOpen: boolean,
): number {
  if (mode === null) return 0;
  if (mode === "panel") return NOTES_PANEL_WIDTH;
  const avail = winW - (sidebarOpen ? sidebarWidth : 0) - PAGE_GUTTER * 2;
  return Math.max(NOTES_PANEL_WIDTH, Math.round(avail / 2));
}

/**
 * macOS draws the traffic lights at a fixed window-relative position
 * with `titleBarStyle: "Overlay"`. Nothing may be drawn in the first
 * 76px of whichever surface owns window x=0, y=0.
 */
export const TRAFFIC_LIGHT_INSET = 76;

/**
 * Below this much page width the sidebar force-collapses; it restores
 * at the higher threshold. Two thresholds means a window parked on the
 * boundary cannot flap and fire a native reframe per flap.
 */
export const SIDEBAR_COLLAPSE_PAGE_WIDTH = 640;
export const SIDEBAR_RESTORE_PAGE_WIDTH = 700;

export type ContentRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * THE single source of native-webview geometry. Both `resizeContent`
 * and `openTab` consume this, so they can no longer disagree — which is
 * what makes "a new tab paints over the drawer" structurally impossible
 * rather than a bug to be patched in a dependency array.
 *
 * Every value is rounded: wry quantises webview size to integer logical
 * points but position to floats, so integers in means no half-point
 * seam at the sidebar divider on a Retina display.
 */
export function contentRect(o: {
  winW: number;
  winH: number;
  sidebarWidth: number;
  sidebarOpen: boolean;
  /** Width of the Notes region (its own right gutter included), 0 when closed. */
  notesWidth: number;
}): ContentRect {
  const left = (o.sidebarOpen ? o.sidebarWidth : 0) + PAGE_GUTTER;
  const right = o.winW - PAGE_GUTTER - o.notesWidth;
  return {
    left: Math.round(left),
    top: TOP_INSET,
    width: Math.max(0, Math.round(right - left)),
    height: Math.max(0, Math.round(o.winH - TOP_INSET - PAGE_GUTTER)),
  };
}

/**
 * Split view: slice the one content rect into two panes with a
 * PAGE_GUTTER of chrome between them — the same band that separates
 * everything else, so the divider needs no drawn line and the strip
 * between the panes is real shell surface (it *is* the drag handle).
 */
export function splitRects(
  rect: ContentRect,
  ratio = 0.5,
): [ContentRect, ContentRect] {
  const r = Math.min(0.75, Math.max(0.25, ratio));
  const paneW = Math.floor((rect.width - PAGE_GUTTER) * r);
  return [
    { ...rect, width: paneW },
    {
      ...rect,
      left: rect.left + paneW + PAGE_GUTTER,
      width: rect.width - paneW - PAGE_GUTTER,
    },
  ];
}

/**
 * Page width the sidebar would leave if it were open. Drives
 * auto-collapse — keyed on resulting page width rather than window
 * width so the thresholds keep meaning "how much page is left".
 */
export function pageWidthIfSidebarOpen(
  winW: number,
  sidebarWidth: number,
  notesWidth: number,
): number {
  return winW - sidebarWidth - notesWidth - PAGE_GUTTER * 2;
}
