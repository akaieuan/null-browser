import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FolderPlus,
  House,
  NotebookText,
  PanelLeft,
  PanelRight,
  RotateCw,
  Star,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/atoms";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Home } from "@/components/Home";
import { Sidebar, type Selection, type Tab } from "@/components/Sidebar";
import { NotesPanel } from "@/components/panels/NotesPanel";
import { HistoryPanel } from "@/components/panels/HistoryPanel";
import { NetworkInspector } from "@/components/panels/NetworkInspector";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { TopProgress } from "@/components/TopProgress";
import { ipc, type Artifact, type Bookmark } from "@/lib/ipc";
import {
  contentRect,
  notesWidthFor,
  pageWidthIfSidebarOpen,
  PAGE_GUTTER,
  PROGRESS_HEIGHT,
  SIDEBAR_COLLAPSE_PAGE_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_RESTORE_PAGE_WIDTH,
  splitRects,
  TOOLBAR_HEIGHT,
  TRAFFIC_LIGHT_INSET,
  type ContentRect,
} from "@/lib/layout";
import { CORNERS, usePreferences, resolveStartUrl } from "@/lib/preferences";
import { type Mode, useTheme } from "@/lib/theme";
import { loadSession, saveSession } from "@/lib/session";
import { resolveQuery } from "@/lib/url";
import { cn } from "@/lib/utils";

const BLANK_URL = "about:blank";

/**
 * The one structural duration: how long the page and the chrome beside
 * it take to reach a new layout after the sidebar or Notes changes it.
 *
 * The number is deliberately written twice. The native page is tweened
 * over rAF from here; the chrome is tweened by CSS, where the value has
 * to be a literal Tailwind can see (`duration-[220ms]`) and the curve
 * has to be restated as `ease-out-cubic` — the bezier twin of the
 * tween's 1-(1-t)^3 (see `--ease-out-cubic` in index.css). Change one
 * without the other and the sidebar and the page stop arriving
 * together.
 */
const FRAME_MS = 220;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function hostnameFor(url: string): string {
  if (!url || url === BLANK_URL) return "New Tab";
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function blankTab(): Tab {
  return { id: uuid(), url: BLANK_URL, title: "New Tab", hasWebview: false };
}

function App() {
  // Last session's tabs come back as dormant rows — url and title but
  // no webview yet. The one that was active materializes at boot (the
  // effect below); the rest load on selection, so restoring twenty
  // tabs never spawns twenty webviews.
  const sessionSeed = useMemo(() => loadSession(), []);
  // `tabs` is never empty — a blank tab stands in for the zero-tab state,
  // which kills the `activeId: null` branch everywhere downstream.
  const [tabs, setTabs] = useState<Tab[]>(() =>
    sessionSeed
      ? sessionSeed.tabs.map((t) => ({
          id: uuid(),
          url: t.url,
          title: t.title,
          hasWebview: false,
        }))
      : [blankTab()],
  );
  const [activeId, setActiveId] = useState<string>(() => "");
  const [input, setInput] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "tab" });
  /**
   * Notes region: closed, a narrow card dropped in under the toolbar's
   * Notes button, or widened to half the window (a split with the
   * page). Independent of `selection` — Notes can sit beside History
   * the way it sits beside a page.
   */
  const [notesMode, setNotesMode] = useState<null | "panel" | "wide">(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState<Set<string>>(new Set());
  const [openClip, setOpenClip] = useState<Artifact | null>(null);
  /** Split divider position: left pane's share of the pane space. */
  const [splitRatio, setSplitRatio] = useState(0.5);
  /** Window width as state, so divider geometry re-derives on resize. */
  const [winW, setWinW] = useState(() => window.innerWidth);

  // Hover-reveal bookkeeping. Refs, not state: the timers and the
  // "this open was the pointer's doing" flag change nothing visible by
  // themselves, so they must not cause renders.
  const hoverTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const hoverRevealedRef = useRef(false);

  /**
   * Split view: the fixed pair of panes, left then right. `activeId`
   * decides which of the two owns the keyboard and the URL bar —
   * activating the other pane swaps focus without dissolving the pair;
   * activating a third tab, closing either pane, or losing either
   * webview dissolves it (the effect below enforces all three).
   */
  const [splitPair, setSplitPair] = useState<[string, string] | null>(null);
  const splitPairRef = useRef(splitPair);
  useEffect(() => {
    splitPairRef.current = splitPair;
  }, [splitPair]);
  // Was a pair live on the frame effect's previous run? Updated inside
  // that effect (not mirrored here), so it lags splitPair by one run and
  // can see the pair→null edge the moment a split is left.
  const wasSplitRef = useRef(false);
  const splitRatioRef = useRef(0.5);
  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  /** Per-tab page zoom (⌘+/⌘−/⌘0). Ref: nothing renders it. */
  const zoomRef = useRef<Map<string, number>>(new Map());

  /**
   * Native-frame tween engine. The panes are native webviews, so
   * "fluid motion" means streaming interpolated frames over IPC at
   * display rate — CSS cannot touch them. Each tab has at most one
   * running tween; a new target cancels the old mid-flight and
   * continues from wherever the frame actually is, so re-targeting
   * (open Notes while a split settles) stays continuous.
   */
  const lastFramesRef = useRef<Map<string, ContentRect>>(new Map());
  const tweensRef = useRef<Map<string, number>>(new Map());
  const dividerDraggingRef = useRef(false);
  const sendFrame = useCallback((id: string, r: ContentRect) => {
    lastFramesRef.current.set(id, r);
    ipc.resizeContent(r, id).catch(() => {});
  }, []);
  const tweenFrame = useCallback(
    (id: string, to: ContentRect, ms = FRAME_MS, onDone?: () => void) => {
      const from = lastFramesRef.current.get(id);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const prev = tweensRef.current.get(id);
      if (prev) cancelAnimationFrame(prev);
      if (!from || reduced) {
        sendFrame(id, to);
        onDone?.();
        return;
      }
      const t0 = performance.now();
      const ease = (x: number) => 1 - (1 - x) ** 3;
      const lerp = (a: number, b: number, t: number) =>
        Math.round(a + (b - a) * t);
      const tick = (now: number) => {
        const t = ease(Math.min(1, (now - t0) / ms));
        sendFrame(id, {
          left: lerp(from.left, to.left, t),
          top: lerp(from.top, to.top, t),
          width: lerp(from.width, to.width, t),
          height: lerp(from.height, to.height, t),
        });
        if (t < 1) {
          tweensRef.current.set(id, requestAnimationFrame(tick));
        } else {
          tweensRef.current.delete(id);
          onDone?.();
        }
      };
      tweensRef.current.set(id, requestAnimationFrame(tick));
    },
    [sendFrame],
  );
  /**
   * Put every tab on one rect. Recording it for all of them is the
   * point: a hidden tab that missed a reframe would otherwise tween
   * from wherever it last was — a page that visibly slides in from the
   * old geometry the first time you toggle the sidebar after switching
   * to it.
   */
  const broadcastFrame = useCallback((r: ContentRect) => {
    ipc.resizeContent(r).catch(() => {});
    for (const t of tabsRef.current) lastFramesRef.current.set(t.id, r);
  }, []);
  /**
   * Stop every mid-flight tween. A live drag — the window edge, the
   * split divider — is the user's own hand on the frame, and an
   * animation still interpolating toward a rect the drag has already
   * left would spend its remaining frames pulling against the pointer.
   */
  const cancelTweens = useCallback(() => {
    for (const raf of tweensRef.current.values()) cancelAnimationFrame(raf);
    tweensRef.current.clear();
  }, []);
  /**
   * Give a tab its webview and record the frame it was born at. The
   * record is what makes the first move of a brand-new tab an
   * animation: `tweenFrame` with no known origin can only teleport.
   */
  const openTabAt = useCallback(
    async (id: string, url: string, r: ContentRect) => {
      await ipc.openTab(id, url, r);
      lastFramesRef.current.set(id, r);
    },
    [],
  );

  /**
   * A sidebar drag is currently hovering the page area. The page
   * yields its right half and a drop target renders in the vacated
   * space — "where this will go" is shown, not guessed. React cannot
   * paint over the native page, so the page has to move; that IS the
   * preview.
   */
  const [splitDropHint, setSplitDropHint] = useState(false);
  useEffect(() => {
    if (splitPair) return; // an existing split owns the frames
    if (selection.kind !== "tab" || !activeTab?.hasWebview) return;
    if (splitDropHint) {
      tweenFrame(activeTab.id, splitRects(rectNow())[0], 180);
    } else {
      tweenFrame(activeTab.id, rectNow(), 180);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitDropHint]);

  /**
   * Toggling Notes always returns it to the list.
   *
   * `openClip` is set only when something hands the surface a specific
   * note to show (Home does, and a menu capture does). Leaving it set
   * while Notes is closed meant reopening remounted straight back into
   * a note the user had already navigated away from. The toggle is
   * never the thing that opens a specific note, so clearing it here is
   * always right.
   */
  const toggleNotes = useCallback(() => {
    setOpenClip(null);
    setNotesMode((cur) => (cur === null ? "panel" : null));
  }, []);
  const toggleNotesRef = useRef(toggleNotes);
  toggleNotesRef.current = toggleNotes;

  const { mode: themeMode, setMode } = useTheme();
  const { startPage, searchEngine, corners, glass, hoverReveal } =
    usePreferences();

  // The Corners preference drives one CSS knob and the native page
  // cards through one Rust call — chrome and page cannot disagree.
  useEffect(() => {
    const c = CORNERS.find((x) => x.id === corners) ?? CORNERS[1];
    document.documentElement.style.setProperty("--radius", c.radius);
    ipc.setTabCornerRadius(c.nativeRadius).catch(() => {});
  }, [corners]);

  // Glass strength: a data attribute the stylesheet keys on for the
  // tint, plus the native material under the window — the material's
  // own scrim decides most of what "glassy" means.
  useEffect(() => {
    document.documentElement.dataset.glass = glass;
    ipc.setGlassMaterial(themeMode, glass).catch(() => {});
  }, [glass, themeMode]);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  // Mirrors of state for callbacks that must read the latest value
  // without being re-created. Every Tauri `listen()` registration is an
  // async IPC round trip while its cleanup unregisters synchronously,
  // so a listener whose effect re-runs on each state change leaves a
  // window with nothing registered — during which keystrokes are simply
  // dropped. These let the listeners register once, with `[]`.
  const tabsRef = useRef<Tab[]>(tabs);
  const activeIdRef = useRef(activeId);
  const selectionRef = useRef<Selection>(selection);
  const bookmarksRef = useRef<Bookmark[]>(bookmarks);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  // Seed the active id once tabs exist — the restored session's active
  // index if there is one, the first (blank) tab otherwise.
  useEffect(() => {
    if (!activeId && tabs.length > 0) {
      setActiveId((tabs[sessionSeed?.active ?? 0] ?? tabs[0]).id);
    }
  }, [activeId, tabs, sessionSeed]);

  /** ⌘F find bar, in the toolbar (the one strip that is always chrome).
      Only the query lives here — the match walking happens inside the
      page via `window.find` (see `webview::find_in_page`). */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const findOpenRef = useRef(false);
  useEffect(() => {
    findOpenRef.current = findOpen;
  }, [findOpen]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    // Empty query clears the page's selection — the bar leaves nothing
    // behind on the page it searched.
    const id = activeIdRef.current;
    if (id) ipc.findInPage(id, "", true, true).catch(() => {});
  }, []);
  // A find session belongs to one page; switching tabs ends it — and
  // clears the selection on the page being *left*. closeFind can't do
  // that here: the activeIdRef sync effect runs first, so by now the
  // ref already names the new tab.
  const prevFindTabRef = useRef<string>("");
  useEffect(() => {
    const prev = prevFindTabRef.current;
    prevFindTabRef.current = activeId;
    if (findOpenRef.current) {
      setFindOpen(false);
      setFindQuery("");
      if (prev) ipc.findInPage(prev, "", true, true).catch(() => {});
    }
  }, [activeId]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const hasActiveWebview = activeTab?.hasWebview ?? false;
  const panelOpen = selection.kind !== "tab";
  const showHome = !panelOpen && !hasActiveWebview;

  const sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
  const effectiveSidebarOpen = sidebarOpen && !autoCollapsed;

  // The hover-reveal gutter unmounts the instant the sidebar opens — by
  // hover or by any other route — so its own onMouseLeave can never fire
  // to cancel a still-pending open. Clear that 250ms timer here instead,
  // and on unmount, so it can't reassert an open the user already made
  // (or undid) some other way.
  useEffect(() => {
    if (effectiveSidebarOpen && hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [effectiveSidebarOpen]);

  const activeLoading =
    hasActiveWebview && activeId !== "" && loadingTabs.has(activeId);

  const activeBookmark = useMemo(() => {
    if (!activeTab || !activeTab.hasWebview) return null;
    return bookmarks.find((b) => b.url === activeTab.url) ?? null;
  }, [activeTab, bookmarks]);

  /** Width the Notes region currently takes (0 when closed). */
  const notesWidth = notesWidthFor(
    notesMode,
    winW,
    sidebarWidth,
    effectiveSidebarOpen,
  );

  /** The page frame, from the one source of geometry truth. `notesWidth`
      is a real dependency: opening or widening Notes must re-frame the
      native page, and every geometry effect keys off this callback. */
  const rectNow = useCallback(
    () =>
      contentRect({
        winW: window.innerWidth,
        winH: window.innerHeight,
        sidebarWidth,
        sidebarOpen: effectiveSidebarOpen,
        notesWidth,
      }),
    [sidebarWidth, effectiveSidebarOpen, notesWidth],
  );

  /** Give a dormant (session-restored) tab its webview and show it. */
  const materializeTab = useCallback(
    async (id: string, url: string) => {
      await openTabAt(id, url, rectNow());
      await ipc.activateTab(id);
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, hasWebview: true } : t)),
      );
    },
    [rectNow, openTabAt],
  );
  const materializeTabRef = useRef(materializeTab);
  materializeTabRef.current = materializeTab;

  // One-shot at boot: wake the restored active tab. Everything else
  // stays dormant until selected.
  const bootRestoredRef = useRef(false);
  useEffect(() => {
    if (bootRestoredRef.current || !activeId) return;
    bootRestoredRef.current = true;
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t && !t.hasWebview && t.url !== BLANK_URL) {
      materializeTabRef.current(t.id, t.url).catch(() => {});
      setInput(t.url);
    }
  }, [activeId]);

  // Persist the session, debounced: real (web) tabs only, plus which
  // one was active. See src/lib/session.ts for what this stores.
  useEffect(() => {
    const h = window.setTimeout(() => {
      const real = tabs.filter((t) => /^https?:\/\//.test(t.url));
      const activeIdx = real.findIndex((t) => t.id === activeId);
      saveSession(
        real.map((t) => ({ url: t.url, title: t.title })),
        activeIdx < 0 ? 0 : activeIdx,
      );
    }, 300);
    return () => window.clearTimeout(h);
  }, [tabs, activeId]);

  // Flush on teardown too: the debounce above would lose the last
  // ~300ms of tab changes when the app quits inside the window.
  useEffect(() => {
    const flush = () => {
      const real = tabsRef.current.filter((t) => /^https?:\/\//.test(t.url));
      const idx = real.findIndex((t) => t.id === activeIdRef.current);
      saveSession(
        real.map((t) => ({ url: t.url, title: t.title })),
        idx < 0 ? 0 : idx,
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Window-drag. The attribute alone is flaky across Tauri/WebView
  // versions; calling startDragging() is reliable. Opt out when the
  // target is interactive or an ancestor is marked opted-out.
  const handleChromeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    let node = e.target as HTMLElement | null;
    while (node && node !== e.currentTarget) {
      const tag = node.tagName;
      if (
        tag === "BUTTON" ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "A"
      ) {
        return;
      }
      if (node.dataset && node.dataset.tauriDragRegion === "false") return;
      node = node.parentElement;
    }
    getCurrentWindow().startDragging().catch(() => {});
  }, []);

  useEffect(() => {
    ipc.listBookmarks().then(setBookmarks).catch(() => {});
    inputRef.current?.focus();
  }, []);

  // Captured favicons, keyed by origin. Loaded once; kept fresh by the
  // `favicon-set` events the ingest path emits as pages are visited.
  const [favicons, setFavicons] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    ipc
      .listFavicons()
      .then((rows) =>
        setFavicons(new Map(rows.map((r) => [r.origin, r.data]))),
      )
      .catch(() => {});
    const promise = listen<{ origin: string; data: string }>(
      "favicon-set",
      (e) => {
        setFavicons((prev) =>
          new Map(prev).set(e.payload.origin, e.payload.data),
        );
      },
    );
    return () => {
      promise.then((off) => off());
    };
  }, []);
  const iconFor = useCallback(
    (url: string): string | null => {
      try {
        return favicons.get(new URL(url).origin) ?? null;
      } catch {
        return null;
      }
    },
    [favicons],
  );


  useEffect(() => {
    // Theme is one palette now; only the Light/Dark menu items emit.
    const modePromise = listen<Mode>("mode-set", (e) => {
      if (e.payload === "light" || e.payload === "dark") setMode(e.payload);
    });
    return () => {
      modePromise.then((off) => off());
    };
  }, [setMode]);

  // Keep every tab webview at the computed frame. Chrome height is now
  // constant, so this fires only on window resize, sidebar toggle and
  // drawer toggle — never because a second tab or a bookmark appeared.
  //
  // `live` says the call came from a real window resize, where the
  // pointer IS the animation and every frame must go out at once. A
  // dependency change (the sidebar toggled, Notes opened) must NOT send
  // one: this effect is declared above the geometry effect that tweens
  // those, so a frame sent here lands the page at the destination
  // before the tween starts and leaves it nothing to travel — which is
  // exactly why toggling the sidebar used to snap.
  useEffect(() => {
    const sync = (live: boolean) => {
      const w = window.innerWidth;
      setWinW(w);
      const wouldBe = pageWidthIfSidebarOpen(w, sidebarWidth, notesWidth);
      setAutoCollapsed((cur) => {
        if (!cur && sidebarOpen && wouldBe < SIDEBAR_COLLAPSE_PAGE_WIDTH) {
          return true;
        }
        if (cur && wouldBe >= SIDEBAR_RESTORE_PAGE_WIDTH) return false;
        return cur;
      });
      if (!live) return;
      cancelTweens();
      const pair = splitPairRef.current;
      if (pair) {
        const [ra, rb] = splitRects(rectNow(), splitRatioRef.current);
        sendFrame(pair[0], ra);
        sendFrame(pair[1], rb);
      } else {
        // Broadcast, not a tween: the pointer is already dragging the
        // window edge, so the frame has to keep up with it.
        broadcastFrame(rectNow());
      }
    };
    const onResize = () => sync(true);
    window.addEventListener("resize", onResize);
    sync(false);
    return () => window.removeEventListener("resize", onResize);
  }, [rectNow, sidebarWidth, sidebarOpen, notesWidth]);

  // Panels take over the content column, so the native page must hide —
  // React cannot paint over a native child webview.
  useEffect(() => {
    if (panelOpen) {
      ipc.hideAllTabs().catch(() => {});
    } else if (activeTab?.hasWebview) {
      ipc.activateTab(activeTab.id).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // Split view owns pane visibility and frames while a pair exists.
  // It runs after the effects above, so whatever a single-tab path
  // just did (activate one, hide all) is corrected to the pair state.
  // When the pair dissolves, every tab is put back on the full rect.
  //
  // Frame changes tween — entering a split slides the page over
  // rather than teleporting it — except while the divider is being
  // dragged, when the pointer IS the animation. After a tween lands,
  // one broadcast resize snaps every hidden tab to the current rect so
  // activating one later doesn't reveal a stale frame.
  useEffect(() => {
    const leftSplit = wasSplitRef.current && !splitPair;
    wasSplitRef.current = splitPair !== null;
    if (!splitPair) {
      if (activeTab?.hasWebview && !panelOpen) {
        // Leaving a split resizes both panes to the full rect but the
        // ex-partner's webview stays shown, stacked over the active one,
        // until some later action hides it. Re-assert single-tab
        // visibility the way a closing panel does — but only on the
        // pair→null edge, so ordinary no-split renders (every tab
        // switch) add no extra native churn.
        if (leftSplit) ipc.activateTab(activeTab.id).catch(() => {});
        tweenFrame(activeTab.id, rectNow(), FRAME_MS, () => {
          broadcastFrame(rectNow());
        });
      } else {
        broadcastFrame(rectNow());
      }
      return;
    }
    const [pa, pb] = splitPair;
    const a = tabs.find((t) => t.id === pa);
    const b = tabs.find((t) => t.id === pb);
    if (!a?.hasWebview || !b?.hasWebview) {
      setSplitPair(null);
      return;
    }
    if (activeId !== pa && activeId !== pb) {
      // The user went somewhere else entirely; the split is over.
      setSplitPair(null);
      return;
    }
    if (panelOpen) return; // both panes stay hidden under the panel
    const [ra, rb] = splitRects(rectNow(), splitRatio);
    if (dividerDraggingRef.current) {
      sendFrame(pa, ra);
      sendFrame(pb, rb);
    } else {
      tweenFrame(pa, ra);
      tweenFrame(pb, rb);
    }
    ipc.activateTabs([pa, pb], activeId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitPair, splitRatio, activeId, panelOpen, tabs, rectNow]);

  useEffect(() => {
    const promise = listen<{ id: string; url: string; title?: string | null }>(
      "tab-updated",
      (e) => {
        const { id, url, title } = e.payload;
        const resolved = title?.trim() || hostnameFor(url);
        setTabs((prev) =>
          prev.map((t) => (t.id === id ? { ...t, url, title: resolved } : t)),
        );
        if (id === activeIdRef.current && !focusedRef.current) setInput(url);
        if (url && !/^about:|^data:/i.test(url)) {
          ipc.addHistory(url, resolved).catch(() => {});
        }
      },
    );
    return () => {
      promise.then((off) => off());
    };
  }, []);

  useEffect(() => {
    const promise = listen<{ id: string; state: "started" | "finished" }>(
      "tab-load-state",
      (e) => {
        const { id, state } = e.payload;
        setLoadingTabs((prev) => {
          const next = new Set(prev);
          if (state === "started") next.add(id);
          else next.delete(id);
          return next;
        });
      },
    );
    return () => {
      promise.then((off) => off());
    };
  }, []);

  const navigateTo = useCallback(
    async (url: string) => {
      const tab = tabs.find((t) => t.id === activeId);
      if (!tab) return;
      setSelection({ kind: "tab" });
      if (tab.hasWebview) {
        await ipc.navigateTab(tab.id, url);
      } else {
        await openTabAt(tab.id, url, rectNow());
        await ipc.activateTab(tab.id);
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? { ...t, url, title: hostnameFor(url), hasWebview: true }
            : t,
        ),
      );
      setInput(url);
    },
    [activeId, tabs, rectNow, openTabAt],
  );

  const openNewTab = useCallback(
    async (url?: string) => {
      const resolved = url ?? resolveStartUrl(startPage) ?? BLANK_URL;

      // A blank tab is not yet anything. Opening a second one stacks an
      // identical, indistinguishable "New Tab" row in the sidebar — the
      // clutter every vertical-tab browser has to design away. If one is
      // already open and empty, go to it instead of making another.
      if (resolved === BLANK_URL) {
        // Blank means url === BLANK_URL, not !hasWebview: a dormant
        // session-restored tab also has no webview but carries a real
        // URL, and reusing it here would hijack — then overwrite — a
        // restored tab instead of opening a new one.
        const blank = tabsRef.current.find((t) => t.url === BLANK_URL);
        if (blank) {
          setSelection({ kind: "tab" });
          await ipc.hideAllTabs();
          setActiveId(blank.id);
          setInput("");
          inputRef.current?.focus();
          return;
        }
      }

      const id = uuid();
      const hasWebview = resolved !== BLANK_URL;
      setSelection({ kind: "tab" });
      if (hasWebview) {
        await openTabAt(id, resolved, rectNow());
        await ipc.activateTab(id);
      } else {
        await ipc.hideAllTabs();
      }
      setTabs((prev) => [
        ...prev,
        { id, url: resolved, title: hostnameFor(resolved), hasWebview },
      ]);
      setActiveId(id);
      setInput(hasWebview ? resolved : "");
      inputRef.current?.focus();
    },
    [startPage, rectNow, openTabAt],
  );

  const openNewTabRef = useRef(openNewTab);
  openNewTabRef.current = openNewTab;

  /**
   * A new tab that has not been given a destination yet.
   *
   * Nothing is created while this is set: no row in the tab list, no
   * webview, nothing in the session file. The draft lives in the input
   * that collects it, and cancelling leaves the browser exactly as it
   * was found.
   */
  const [pendingNewTab, setPendingNewTab] = useState(false);
  const pendingNewTabRef = useRef(false);
  useEffect(() => {
    pendingNewTabRef.current = pendingNewTab;
  }, [pendingNewTab]);

  /**
   * ⌘T, the toolbar's +, and the sidebar's New tab row.
   *
   * With a start page configured there is nothing to ask, so the old
   * path stands. Otherwise the input takes over: the sidebar's own row
   * when the list is on screen, the URL bar when it is not. A closed
   * sidebar is deliberately left closed — auto-revealing it would push
   * the live page 240px sideways to make room for a 26px field, and the
   * hover-reveal lifecycle belongs to the pointer, not to a shortcut.
   */
  /** The toolbar's home affordance: land on a blank Home tab, focusing
      an existing empty one rather than stacking another. Distinct from
      ⌘T's inline-search flow — this is "take me to the home surface",
      not "start typing a new tab". */
  const goHome = useCallback(() => {
    if (pendingNewTabRef.current) cancelPendingNewTabRef.current();
    openNewTabRef.current(BLANK_URL).catch(() => {});
  }, []);

  const startNewTab = useCallback(() => {
    const resolved = resolveStartUrl(startPage);
    if (resolved) {
      openNewTabRef.current(resolved).catch(() => {});
      return;
    }
    setPendingNewTab(true);
    if (!effectiveSidebarOpen) {
      setInput("");
      inputRef.current?.focus();
    }
  }, [startPage, effectiveSidebarOpen]);

  const commitPendingNewTab = useCallback(
    (text: string) => {
      pendingNewTabRef.current = false;
      setPendingNewTab(false);
      const url = resolveQuery(text, searchEngine);
      if (url) openNewTabRef.current(url).catch(() => {});
    },
    [searchEngine],
  );

  const cancelPendingNewTab = useCallback(() => {
    pendingNewTabRef.current = false;
    setPendingNewTab(false);
    if (effectiveSidebarOpen) return;
    // URL-bar mode borrowed the field; hand it back to the page it
    // belongs to rather than leaving it empty over a loaded tab.
    const act = tabsRef.current.find((t) => t.id === activeIdRef.current);
    setInput(act && act.url !== BLANK_URL ? act.url : "");
  }, [effectiveSidebarOpen]);
  const cancelPendingNewTabRef = useRef(cancelPendingNewTab);
  cancelPendingNewTabRef.current = cancelPendingNewTab;

  // The flag must not outlive its moment: a tab arriving by ANY route
  // (bookmark "open in new tab", a page's open-url event) ends the
  // pending state — otherwise the next ordinary Enter in the URL bar
  // would be hijacked into opening a second tab.
  const pendingTabCountRef = useRef(0);
  useEffect(() => {
    const grew = tabs.length > pendingTabCountRef.current;
    pendingTabCountRef.current = tabs.length;
    if (pendingNewTab && grew) cancelPendingNewTabRef.current();
  }, [tabs, pendingNewTab]);

  /** Transient download status, bottom-right of the chrome. */
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((text: string, ok: boolean, ms: number) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ text, ok });
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  const lastDownloadRef = useRef<string>("");

  // Page-initiated openings and download progress. Registered once —
  // see the ref-mirror note above for why these never re-register.
  useEffect(() => {
    const openPromise = listen<string>("open-url", (e) => {
      openNewTabRef.current(e.payload).catch(() => {});
    });
    const startPromise = listen<{ name: string; url: string }>(
      "download-started",
      (e) => {
        lastDownloadRef.current = e.payload.name;
        showToast(`Downloading ${e.payload.name}…`, true, 60000);
      },
    );
    const donePromise = listen<{ url: string; success: boolean }>(
      "download-finished",
      (e) => {
        const name = lastDownloadRef.current || "file";
        showToast(
          e.payload.success
            ? `${name} saved to Downloads`
            : `${name} failed to download`,
          e.payload.success,
          4000,
        );
      },
    );
    return () => {
      openPromise.then((off) => off());
      startPromise.then((off) => off());
      donePromise.then((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateTabById = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      // Switching tabs ends a pending new-tab attempt — the URL bar
      // goes back to naming the page on screen.
      if (pendingNewTabRef.current) cancelPendingNewTabRef.current();
      setSelection({ kind: "tab" });
      if (tab.hasWebview) await ipc.activateTab(id);
      else if (tab.url !== BLANK_URL) await materializeTab(tab.id, tab.url);
      else await ipc.hideAllTabs();
      setActiveId(id);
      setInput(tab.url !== BLANK_URL ? tab.url : "");
    },
    [tabs, materializeTab],
  );

  const closeTabById = useCallback(
    async (id: string) => {
      // Decide from the CURRENT list inside the updater, not from a
      // captured one. `ipc.closeTab` is a round trip, so two quick ⌘Ws
      // would otherwise both read the pre-first-close list and the last
      // write would resurrect a tab whose native webview is already
      // gone — a row that renders nothing and whose URL bar silently
      // fails. `decided` carries the choice back out for the IPC that
      // has to follow the state change.
      let decided: { next: Tab; wasActive: boolean } | null = null;

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        const wasActive = activeIdRef.current === id;
        if (remaining.length === 0) {
          // Never fall to zero tabs: a blank tab stands in, so the shell
          // always has something to show and somewhere to focus.
          const fresh = blankTab();
          decided = { next: fresh, wasActive: true };
          return [fresh];
        }
        if (wasActive) {
          const idx = prev.findIndex((t) => t.id === id);
          // A prior close already took this id out of `prev` — two ⌘Ws
          // landing in one React batch, the second reading the first's
          // result. There is no neighbour to pick and nothing left to
          // close; leaving `decided` null keeps the earlier close's
          // choice instead of dereferencing remaining[-1].
          if (idx >= 0) {
            // Prefer the neighbour to the right, as every other browser
            // does — jumping to the end of a 20-tab list is disorienting.
            const next = remaining[Math.min(idx, remaining.length - 1)];
            decided = { next, wasActive: true };
          }
        }
        return remaining;
      });

      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab?.hasWebview) await ipc.closeTab(id).catch(() => {});

      if (decided) {
        const { next } = decided as { next: Tab; wasActive: boolean };
        setActiveId(next.id);
        setInput(next.url !== BLANK_URL ? next.url : "");
        // Don't yank a panel out from under the user just because a
        // background tab closed.
        if (
          selectionRef.current.kind === "tab" &&
          !next.hasWebview &&
          next.url !== BLANK_URL
        ) {
          // The neighbour is a dormant restored tab: wake it rather
          // than showing Home behind a row that names a real site.
          await materializeTabRef.current(next.id, next.url).catch(() => {});
        } else if (selectionRef.current.kind !== "tab" || !next.hasWebview) {
          await ipc.hideAllTabs().catch(() => {});
          if (!next.hasWebview) inputRef.current?.focus();
        } else {
          await ipc.activateTab(next.id).catch(() => {});
        }
      }
    },
    [],
  );

  const toggleBookmark = useCallback(async () => {
    if (!activeTab || !activeTab.hasWebview) return;
    if (activeBookmark) {
      await ipc.removeBookmark(activeBookmark.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== activeBookmark.id));
    } else {
      const created = await ipc.addBookmark(activeTab.url, activeTab.title);
      setBookmarks((prev) => [...prev, created]);
    }
  }, [activeTab, activeBookmark]);

  const deleteBookmark = useCallback(async (id: number) => {
    await ipc.removeBookmark(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // A new empty folder, ready to drag pins into. It persists until a pin
  // it holds is dragged back out (storage::move_bookmark), so it will not
  // vanish before it is used.
  const createFolder = useCallback(async () => {
    const folder = await ipc.createFolder();
    setBookmarks((prev) => [...prev, folder]);
  }, []);

  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);

  const saveBookmarkEdit = useCallback(
    async (id: number, url: string, title: string) => {
      await ipc.updateBookmark(id, url, title);
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, url, title } : b)),
      );
    },
    [],
  );

  useEffect(() => {
    const promise = listen<{ action: string; id: number }>(
      "bookmark-menu-action",
      (e) => {
        const { action, id } = e.payload;
        // Create acts on the pin area, not the clicked pin — handle it
        // before the target lookup that the rest require.
        if (action === "new_folder") {
          createFolder().catch(() => {});
          return;
        }
        const target = bookmarksRef.current.find((b) => b.id === id);
        if (!target) return;
        switch (action) {
          case "open_new_tab":
            openNewTab(target.url).catch(() => {});
            break;
          case "edit":
            setEditingBookmark(target);
            break;
          case "copy_url":
            navigator.clipboard.writeText(target.url).catch(() => {});
            break;
          case "delete":
            deleteBookmark(id).catch(() => {});
            break;
        }
      },
    );
    return () => {
      promise.then((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Clicking a selected panel row again returns you to the page. */
  const selectPanel = useCallback(
    (kind: "history" | "network" | "settings") => {
      setSelection((cur) => (cur.kind === kind ? { kind: "tab" } : { kind }));
    },
    [],
  );

  /**
   * A bookmark dropped onto the page: open it in a fresh tab and pair
   * it to the right of the active page. With no live page to pair
   * against, it just opens normally.
   */
  const openInSplit = useCallback(
    async (url: string) => {
      const act = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!act?.hasWebview) {
        await navigateTo(url);
        return;
      }
      const id = uuid();
      const paneB = splitRects(rectNow(), splitRatioRef.current)[1];
      await openTabAt(id, url, paneB);
      setTabs((prev) => [
        ...prev,
        { id, url, title: hostnameFor(url), hasWebview: true },
      ]);
      setSelection({ kind: "tab" });
      setSplitPair([act.id, id]);
    },
    [navigateTo, rectNow, openTabAt],
  );

  /**
   * Enter or leave split view. Entering pairs the active tab with the
   * next tab that has a page; the pair is left→right in that order.
   */
  const toggleSplit = useCallback(() => {
    if (splitPairRef.current) {
      setSplitPair(null);
      return;
    }
    const act = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!act?.hasWebview) return;
    const other = tabsRef.current.find((t) => t.id !== act.id && t.hasWebview);
    if (!other) return;
    setSelection({ kind: "tab" });
    setSplitPair([act.id, other.id]);
  }, []);
  const toggleSplitRef = useRef(toggleSplit);
  toggleSplitRef.current = toggleSplit;

  /** Which tab row was right-clicked, and where the pointer was. */
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);

  /** Right-click in the empty pin area: a small menu whose one job is
      New Folder. Right-clicking a pin itself still raises the native
      bookmark menu (which also carries New Folder). */
  const [pinMenu, setPinMenu] = useState<{ x: number; y: number } | null>(null);
  const closePinMenu = useCallback(() => setPinMenu(null), []);

  /**
   * Pair a tab with the active one, on the named side. Reads the live
   * lists through refs so a menu opened before an async wake still acts
   * on the tabs that exist when the item is chosen. An existing pair is
   * replaced, not stacked — there is only ever one split.
   */
  const splitWithActive = useCallback(
    async (tabId: string, side: "left" | "right") => {
      const act = tabsRef.current.find((t) => t.id === activeIdRef.current);
      const clicked = tabsRef.current.find((t) => t.id === tabId);
      if (!clicked || !act || clicked.id === act.id) return;
      // A pane has to have a page in it: the active tab needs a live
      // webview, and a blank tab has no URL to wake into one.
      if (!act.hasWebview || clicked.url === BLANK_URL) return;
      if (!clicked.hasWebview) {
        await materializeTabRef.current(clicked.id, clicked.url);
      }
      setSelection({ kind: "tab" });
      setSplitPair(side === "left" ? [clicked.id, act.id] : [act.id, clicked.id]);
    },
    [],
  );

  /** Toolbar scissors: clip the current page immediately. */
  const clipPage = useCallback(async () => {
    if (!activeTab?.hasWebview) return;
    try {
      const id = await ipc.saveCurrentTab(activeTab.id);
      // Show the result where it lives: the Notes card opens (or stays
      // open) with the fresh note in front.
      const clip = await ipc.getArtifact(id);
      setOpenClip(clip);
      setNotesMode((m) => m ?? "panel");
    } catch {
      // Surface failures where notes live too.
      setNotesMode((m) => m ?? "panel");
    }
  }, [activeTab]);

  // Every shortcut arrives as a native menu accelerator, so it works
  // even while focus is inside a page — a `keydown` listener here does
  // not, because the page is a separate native webview.
  //
  // The handler lives in a ref and the listener registers exactly once.
  // Registering is an async IPC round trip while unregistering is
  // synchronous, so an effect that re-ran on every state change would
  // leave a gap on each page load with no handler attached — and
  // keypresses in that gap are dropped silently.
  const menuActionRef = useRef<(action: string) => void>(() => {});
  menuActionRef.current = (action: string) => {
    {
      switch (action) {
        case "new_tab":
          // menu.rs takes the first responder back from the page before
          // emitting this, so the field this focuses can receive keys.
          startNewTab();
          break;
        case "new_note": {
          // ⌘N: a note next to whatever you're watching. The active
          // page's URL rides along as the note's source.
          const act = tabsRef.current.find(
            (t) => t.id === activeIdRef.current,
          );
          ipc.focusShell().catch(() => {});
          ipc
            .createNote("", act?.hasWebview ? act.url : "")
            .then((clip) => {
              setOpenClip(clip);
              setNotesMode((m) => m ?? "panel");
            })
            .catch(() => {});
          break;
        }
        case "close_tab":
          closeTabById(activeId).catch(() => {});
          break;
        case "open_location":
          // ⌘L means "edit this page's location" — it ends a pending
          // new-tab borrow of the same field.
          if (pendingNewTabRef.current) cancelPendingNewTabRef.current();
          setSelection({ kind: "tab" });
          inputRef.current?.focus();
          inputRef.current?.select();
          break;
        case "find": {
          // Only when the page is actually showing — a find bar over a
          // panel would search something the user cannot see.
          if (selectionRef.current.kind !== "tab") break;
          const t = tabsRef.current.find((x) => x.id === activeIdRef.current);
          if (!t?.hasWebview) break;
          setFindOpen(true);
          window.setTimeout(() => {
            findInputRef.current?.focus();
            findInputRef.current?.select();
          }, 0);
          break;
        }
        case "find_next":
        case "find_prev":
          if (findOpen && findQuery && hasActiveWebview) {
            ipc
              .findInPage(activeId, findQuery, action === "find_next", false)
              .catch(() => {});
          }
          break;
        case "reload":
          if (hasActiveWebview) ipc.reload(activeId).catch(() => {});
          break;
        case "back":
          if (hasActiveWebview) ipc.goBack(activeId).catch(() => {});
          break;
        case "forward":
          if (hasActiveWebview) ipc.goForward(activeId).catch(() => {});
          break;
        case "bookmark":
          toggleBookmark().catch(() => {});
          break;
        case "clip_page":
          clipPage().catch(() => {});
          break;
        case "clip_selection":
          if (activeTab?.hasWebview) {
            ipc
              .clipSelection(activeTab.id)
              .then(async (id) => {
                const clip = await ipc.getArtifact(id);
                setOpenClip(clip);
                setNotesMode((m) => m ?? "panel");
              })
              .catch(() => setNotesMode((m) => m ?? "panel"));
          }
          break;
        case "clips":
          // Take the first responder back from the page, or the shell's
          // Escape handler cannot close what this just opened.
          ipc.focusShell().catch(() => {});
          toggleNotesRef.current();
          break;
        case "history":
          selectPanel("history");
          break;
        case "network":
          selectPanel("network");
          break;
        case "settings":
          selectPanel("settings");
          break;
        case "web_inspector":
          if (activeTab?.hasWebview) {
            ipc.openTabDevtools(activeTab.id).catch(() => {});
          }
          break;
        case "zoom_in":
        case "zoom_out":
        case "zoom_reset": {
          const id = activeIdRef.current;
          const tab = tabsRef.current.find((t) => t.id === id);
          if (!tab?.hasWebview) break;
          const cur = zoomRef.current.get(id) ?? 1;
          const next =
            action === "zoom_reset"
              ? 1
              : Math.min(
                  3,
                  Math.max(0.5, cur + (action === "zoom_in" ? 0.1 : -0.1)),
                );
          zoomRef.current.set(id, next);
          ipc.setTabZoom(id, next).catch(() => {});
          break;
        }
        case "toggle_split":
          toggleSplitRef.current();
          break;
        case "toggle_sidebar":
          // A deliberate toggle owns the sidebar again: it must not
          // close itself just because the pointer wanders off.
          hoverRevealedRef.current = false;
          setAutoCollapsed(false);
          setSidebarOpen((v) => !v);
          break;
        case "next_tab":
        case "prev_tab": {
          const list = tabsRef.current;
          if (list.length < 2) break;
          const i = list.findIndex((t) => t.id === activeIdRef.current);
          const delta = action === "next_tab" ? 1 : -1;
          const next = list[(i + delta + list.length) % list.length];
          activateTabById(next.id).catch(() => {});
          break;
        }
        default:
          // ⌘1–⌘8 jump to that tab; ⌘9 (goto_tab_9) to the last.
          if (action.startsWith("goto_tab_")) {
            const n = Number(action.slice("goto_tab_".length));
            const list = tabsRef.current;
            const target = n === 9 ? list[list.length - 1] : list[n - 1];
            if (target && target.id !== activeIdRef.current) {
              activateTabById(target.id).catch(() => {});
            }
          }
          break;
      }
    }
  };

  useEffect(() => {
    const promise = listen<string>("menu-action", (e) =>
      menuActionRef.current(e.payload),
    );
    return () => {
      promise.then((off) => off());
    };
  }, []);

  // Escape is not a menu accelerator: it means one thing, "put the
  // page back", one layer at a time — Notes first, then a panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // An unfinished new tab is the newest layer, so it goes first.
      // The sidebar's row stops the event itself; this is the URL-bar
      // path, where the field has no Escape handler of its own.
      if (pendingNewTabRef.current) {
        e.preventDefault();
        cancelPendingNewTab();
        return;
      }
      // Mid-sentence Esc means "stop typing", not "take my card away".
      const el = document.activeElement as HTMLElement | null;
      if (
        notesMode !== null &&
        el &&
        (el.tagName === "TEXTAREA" || el.tagName === "INPUT") &&
        el.closest('aside[aria-label="Notes"]')
      ) {
        e.preventDefault();
        el.blur();
        return;
      }
      if (notesMode !== null) {
        e.preventDefault();
        setNotesMode(null);
        setOpenClip(null);
        return;
      }
      if (panelOpen) {
        e.preventDefault();
        setSelection({ kind: "tab" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panelOpen, notesMode, cancelPendingNewTab]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveQuery(input, searchEngine);
    if (!url) return;
    try {
      // A pending new tab borrowed this field, so Enter here opens a
      // tab rather than steering the one already on screen. The ref
      // clears synchronously: the blur below fires before the state
      // round-trips, and a blur that still reads pending would cancel
      // the commit it is part of.
      if (pendingNewTabRef.current) {
        pendingNewTabRef.current = false;
        setPendingNewTab(false);
        await openNewTabRef.current(url);
      } else {
        await navigateTo(url);
      }
    } catch {
      return; // e.g. the backend refused a non-web URL scheme
    }
    inputRef.current?.blur();
  }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleChromeMouseDown}
      className="flex h-screen bg-chrome text-foreground"
    >
      {/* Hover-reveal: the PAGE_GUTTER leaves an 8px band of shell at
          the window's left edge that still receives mouse events even
          though everything beside it is a native webview. Parking the
          pointer there opens the sidebar; it closes again when the
          pointer leaves the sidebar for the page. Deliberate delay in,
          so a cursor passing through the edge on its way to the page
          does not flap the layout. */}
      {!effectiveSidebarOpen && hoverReveal && (
        <div
          className="fixed inset-y-0 left-0 z-30"
          style={{ width: PAGE_GUTTER }}
          onMouseEnter={() => {
            hoverTimerRef.current = window.setTimeout(() => {
              hoverRevealedRef.current = true;
              setAutoCollapsed(false);
              setSidebarOpen(true);
            }, 250);
          }}
          onMouseLeave={() => {
            if (hoverTimerRef.current !== null) {
              window.clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = null;
            }
          }}
        />
      )}
      {/* Sidebar host. Stays mounted at zero width when closed: CSS can
          transition a width, but it cannot transition a subtree that
          does not exist, and the column has to travel with the page
          beside it — same 220ms, same cubic ease-out the native frame
          tween runs (see FRAME_MS).

          The inner track keeps its full width and slides left by
          exactly what the host lost, so the sidebar's right edge and
          the page's left edge stay welded together for the whole
          motion. That also means nothing is ever drawn past the host's
          right edge, so no `overflow-hidden` is needed here — which
          matters, because clipping would sever the drag preview of a
          tab being pulled out onto the page.

          `inert` while closed: the subtree is off-window at negative x,
          and a keyboard user must not be able to tab into twenty
          invisible tab rows. */}
      <div
        className="h-full shrink-0 motion-safe:transition-[width] motion-safe:duration-[220ms] motion-safe:ease-out-cubic"
        style={{ width: effectiveSidebarOpen ? sidebarWidth : 0 }}
        inert={!effectiveSidebarOpen}
        onMouseEnter={() => {
          if (hoverCloseTimerRef.current !== null) {
            window.clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
          }
        }}
        onMouseLeave={(e) => {
          // Only a hover-revealed sidebar closes itself, and only
          // when the pointer left for a native webview (relatedTarget
          // is null then) — moving to the toolbar keeps it open.
          if (!hoverRevealedRef.current || e.relatedTarget) return;
          hoverCloseTimerRef.current = window.setTimeout(() => {
            hoverRevealedRef.current = false;
            setSidebarOpen(false);
          }, 400);
        }}
      >
        <div
          className="h-full motion-safe:transition-transform motion-safe:duration-[220ms] motion-safe:ease-out-cubic"
          style={{
            width: sidebarWidth,
            transform: effectiveSidebarOpen
              ? undefined
              : `translateX(${-sidebarWidth}px)`,
          }}
        >
          <Sidebar
            width={sidebarWidth}
            tabs={tabs}
            activeTabId={activeId}
            loadingTabs={loadingTabs}
            bookmarks={bookmarks}
            selection={selection}
            iconFor={iconFor}
            onToggleSidebar={() => setSidebarOpen(false)}
            onSelectTab={(id) => activateTabById(id)}
            onCloseTab={(id) => closeTabById(id)}
            onNewTab={startNewTab}
            pendingNewTab={pendingNewTab}
            onCommitPendingNewTab={commitPendingNewTab}
            onCancelPendingNewTab={cancelPendingNewTab}
            onTabContextMenu={(e, id) => {
              e.preventDefault();
              setTabMenu({ x: e.clientX, y: e.clientY, tabId: id });
            }}
            onOpenBookmark={(url) => {
              navigateTo(url).catch(() => {});
            }}
            onOpenBookmarkInNewTab={(url) => {
              openNewTab(url).catch(() => {});
            }}
            onBookmarkContextMenu={(e, id) => {
              e.preventDefault();
              ipc.showBookmarkMenu(id).catch(() => {});
            }}
            onPinAreaContextMenu={(e) => {
              e.preventDefault();
              setPinMenu({ x: e.clientX, y: e.clientY });
            }}
            onReorderBookmarks={(ids) => {
              setBookmarks((prev) => {
                const byId = new Map(prev.map((b) => [b.id, b]));
                const reordered = ids
                  .map((id) => byId.get(id))
                  .filter((b): b is Bookmark => !!b);
                // `ids` is the top-level order only. Keep every in-folder
                // pin (parent_id !== null) — rebuilding from `ids` alone
                // would drop them and empty every folder on screen until
                // the next refetch.
                const next = [
                  ...reordered,
                  ...prev.filter((b) => b.parent_id !== null),
                ];
                ipc.reorderBookmarks(ids).catch(() => {
                  ipc.listBookmarks().then(setBookmarks).catch(() => {});
                });
                return next;
              });
            }}
            onSelectPanel={selectPanel}
            mode={themeMode}
            onToggleMode={() => setMode(themeMode === "dark" ? "light" : "dark")}
            onDropTabToSplit={(tabId) => {
              const act = tabsRef.current.find(
                (t) => t.id === activeIdRef.current,
              );
              const dropped = tabsRef.current.find((t) => t.id === tabId);
              if (!dropped || dropped.url === BLANK_URL) return;
              // A dormant restored tab can be dropped to split too: wake
              // it first, then pair it.
              const ready = dropped.hasWebview
                ? Promise.resolve()
                : materializeTabRef.current(dropped.id, dropped.url);
              ready
                .then(() => {
                  if (!act?.hasWebview || act.id === dropped.id) {
                    return activateTabById(tabId);
                  }
                  setSelection({ kind: "tab" });
                  setSplitPair([act.id, dropped.id]);
                })
                .catch(() => {});
            }}
            onDropBookmarkToSplit={(url) => {
              openInSplit(url).catch(() => {});
            }}
            onSplitDragOver={setSplitDropHint}
            onPinTab={(tabId, folderId) => {
              const t = tabsRef.current.find((x) => x.id === tabId);
              // Dormant restored tabs pin fine — the URL is real even
              // before the webview exists. Only a blank tab has nothing
              // to pin.
              if (!t || t.url === BLANK_URL) return;
              if (bookmarksRef.current.some((b) => b.url === t.url)) return;
              (async () => {
                const b = await ipc.addBookmark(t.url, t.title);
                if (folderId !== null) await ipc.moveBookmark(b.id, folderId);
                setBookmarks(await ipc.listBookmarks());
              })().catch(() => {});
            }}
            onGroupBookmarks={(targetId, draggedId) => {
              (async () => {
                await ipc.groupBookmarks(targetId, draggedId);
                setBookmarks(await ipc.listBookmarks());
              })().catch(() => {});
            }}
            onMoveBookmark={(id, folderId) => {
              (async () => {
                await ipc.moveBookmark(id, folderId);
                setBookmarks(await ipc.listBookmarks());
              })().catch(() => {});
            }}
          />
        </div>
      </div>

      {/* Content column: toolbar, progress, then the page (native) or a
          React surface occupying the same box. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The left inset travels with the sidebar. When the sidebar
            closes, this row inherits window x=0 and has to clear the
            traffic lights, so the padding grows 8 → 76 on the same
            curve as the column that just vacated the space — otherwise
            the toolbar's contents jump 68px at the end of a motion
            everything else spent 220ms on. */}
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center gap-1 pr-2 motion-safe:transition-[padding] motion-safe:duration-[220ms] motion-safe:ease-out-cubic"
          style={{
            height: TOOLBAR_HEIGHT,
            paddingLeft: effectiveSidebarOpen ? 8 : TRAFFIC_LIGHT_INSET,
          }}
        >
          {/* Show-sidebar. Kept mounted and collapsed rather than
              unmounted: it is the sidebar's own control handing itself
              to the toolbar, so it grows into place instead of popping
              in and shoving the nav buttons 32px sideways. The flex gap
              is part of its footprint and collapses with it. */}
          <div
            className="shrink-0 overflow-hidden motion-safe:transition-[width,margin] motion-safe:duration-[220ms] motion-safe:ease-out-cubic"
            style={{
              width: effectiveSidebarOpen ? 0 : 28,
              marginRight: effectiveSidebarOpen ? -4 : 0,
            }}
            inert={effectiveSidebarOpen}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show sidebar"
              title="Show sidebar · ⌃⌘S"
              onClick={() => {
                hoverRevealedRef.current = false;
                setSidebarOpen(true);
                setAutoCollapsed(false);
              }}
            >
              <PanelLeft strokeWidth={1.5} />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            disabled={!hasActiveWebview}
            onClick={() => ipc.goBack(activeId)}
          >
            <ChevronLeft strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Forward"
            disabled={!hasActiveWebview}
            onClick={() => ipc.goForward(activeId)}
          >
            <ChevronRight strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reload"
            disabled={!hasActiveWebview}
            onClick={() => ipc.reload(activeId)}
          >
            <RotateCw strokeWidth={1.5} />
          </Button>

          <form
            onSubmit={handleSubmit}
            data-tauri-drag-region="false"
            className="w-full flex-1"
          >
            {/* The pill steps off the chrome ground the way tiles do —
                accent, not muted, because muted IS the ground now. */}
            <div className="group flex h-[26px] w-full items-center rounded-md border border-transparent bg-accent/50 transition-colors focus-within:border-[color-mix(in_srgb,var(--select)_50%,transparent)] focus-within:bg-accent">
              <button
                type="button"
                aria-label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
                disabled={!hasActiveWebview}
                onClick={toggleBookmark}
                className={cn(
                  "ml-1 shrink-0 rounded-sm p-1 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  activeBookmark
                    ? "text-select"
                    : "text-muted-foreground hover:text-foreground",
                  !hasActiveWebview && "opacity-30",
                )}
                title={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              >
                <Star
                  size={14}
                  strokeWidth={1.5}
                  fill={activeBookmark ? "currentColor" : "none"}
                />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  focusedRef.current = true;
                }}
                onBlur={() => {
                  focusedRef.current = false;
                  // Leaving the field abandons a pending new tab, the
                  // same way the sidebar's inline row cancels on blur.
                  // (Enter clears the ref synchronously before its own
                  // blur, so a commit never cancels itself.)
                  if (pendingNewTabRef.current) {
                    cancelPendingNewTabRef.current();
                  }
                }}
                placeholder="Search or enter URL"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="h-full w-full bg-transparent pl-1 pr-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </form>

          <div className="flex shrink-0 items-center gap-0.5">
            {/* Find bar. Same reasoning as the download chip: the
                toolbar is the only strip the native page can never
                paint over, and the chrome's height never changes, so
                opening it reflows nothing. It is summoned from this
                strip, so it arrives on the same drop the Notes card
                does. */}
            {findOpen && (
              <div
                data-tauri-drag-region="false"
                className="flex h-[26px] shrink-0 items-center rounded-md border border-transparent bg-accent/50 pl-2 transition-colors focus-within:border-[color-mix(in_srgb,var(--select)_50%,transparent)] focus-within:bg-accent motion-safe:animate-[np-drop_160ms_ease-out]"
              >
                <input
                  ref={findInputRef}
                  type="text"
                  value={findQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    setFindQuery(q);
                    if (hasActiveWebview) {
                      ipc.findInPage(activeId, q, true, true).catch(() => {});
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (findQuery && hasActiveWebview) {
                        ipc
                          .findInPage(activeId, findQuery, !e.shiftKey, false)
                          .catch(() => {});
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      // Stop the native event too, or the window-level
                      // Escape handler fires on the same keypress and
                      // closes Notes / a panel — two layers for one key.
                      e.stopPropagation();
                      closeFind();
                    }
                  }}
                  placeholder="Find on page"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Find on page"
                  className="w-36 bg-transparent font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Previous match"
                  title="Previous match · ⇧⌘G"
                  onClick={() => {
                    if (findQuery && hasActiveWebview) {
                      ipc
                        .findInPage(activeId, findQuery, false, false)
                        .catch(() => {});
                    }
                  }}
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <ChevronUp size={13} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="Next match"
                  title="Next match · ⌘G"
                  onClick={() => {
                    if (findQuery && hasActiveWebview) {
                      ipc
                        .findInPage(activeId, findQuery, true, false)
                        .catch(() => {});
                    }
                  }}
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <ChevronDown size={13} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="Close find bar"
                  title="Close · Esc"
                  onClick={closeFind}
                  className="mr-0.5 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </div>
            )}
            {/* Download status. It lives in the toolbar because the
                toolbar is the one strip that is always chrome — a
                floating toast would vanish under the native page. */}
            {toast && (
              <span
                role="status"
                className={cn(
                  "max-w-56 shrink truncate rounded-md bg-muted px-2 py-1 text-[11px] motion-safe:animate-[np-drop_160ms_ease-out]",
                  toast.ok ? "text-muted-foreground" : "text-danger",
                )}
                title={toast.text}
              >
                {toast.text}
              </span>
            )}
            {/* Notes lives here, not in the sidebar: the card drops in
                right under this button. Capturing is inside the card
                (and stays on ⇧⌘C). */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notes"
              aria-pressed={!!notesMode}
              title="Notes · ⌘/"
              onClick={toggleNotes}
              className={cn(notesMode && "text-select")}
            >
              <NotebookText strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={splitPair ? "Leave split view" : "Split with next tab"}
              title={
                splitPair ? "Leave split view · ⌥⌘S" : "Split with next tab · ⌥⌘S"
              }
              disabled={
                !splitPair && tabs.filter((t) => t.hasWebview).length < 2
              }
              onClick={toggleSplit}
              className={cn(splitPair && "text-select")}
            >
              <Columns2 strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Home"
              title="Home"
              onClick={goHome}
            >
              <House strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        {/* Progress strip + the top gutter. There used to be a hairline
            under this row; the gutter replaced it. Keeping the two in
            one box is what keeps the React panels below and the native
            webview at the same y — this row's height IS the difference
            between TOOLBAR_HEIGHT and TOP_INSET. */}
        <div
          data-tauri-drag-region
          className="relative shrink-0"
          style={{ height: PROGRESS_HEIGHT + PAGE_GUTTER }}
        >
          <TopProgress active={activeLoading} />
        </div>

        <div data-tauri-drag-region="false" className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {showHome && (
              <Home
                onOpenClip={(clip) => {
                  // Through get_artifact so external edits to the file
                  // mirror are adopted on open (notes::sync_from_disk),
                  // same as opening from the Notes list.
                  ipc
                    .getArtifact(clip.id)
                    .then((fresh) => setOpenClip(fresh ?? clip))
                    .catch(() => setOpenClip(clip));
                  setNotesMode((m) => m ?? "panel");
                }}
                onOpenUrl={(url) => {
                  navigateTo(url).catch(() => {});
                }}
              />
            )}
            {/* Drop-target preview during a sidebar drag: the vacated
                right half, outlined. pointer-events-none — the drop is
                positional, resolved by the drag's own end handler. */}
            {splitDropHint && !splitPair && selection.kind === "tab" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-40"
                style={(() => {
                  const [, pb] = splitRects(rectNow());
                  const off = effectiveSidebarOpen ? sidebarWidth : 0;
                  return {
                    left: pb.left - off,
                    width: pb.width,
                    top: 0,
                    bottom: PAGE_GUTTER,
                  };
                })()}
              >
                <div className="flex h-full w-full items-center justify-center rounded-xl bg-card ring-1 ring-select">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Drop to split
                  </span>
                </div>
              </div>
            )}
            {/* Split divider: the gutter between the panes is shell
                surface, so it can be a real drag handle. During the
                drag AppKit keeps routing pointer events to the view
                that took the pointer-down, even across the native
                panes. */}
            {splitPair && selection.kind === "tab" && (
              <div
                role="separator"
                aria-orientation="vertical"
                className="absolute inset-y-0 z-30 cursor-col-resize"
                style={{
                  left:
                    PAGE_GUTTER +
                    splitRects(rectNow(), splitRatio)[0].width,
                  width: PAGE_GUTTER,
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  dividerDraggingRef.current = true;
                  // The pointer takes the frames from here; anything
                  // still settling from entering the split hands over.
                  cancelTweens();
                  const rect = rectNow();
                  const paneSpace = rect.width - PAGE_GUTTER;
                  let raf = 0;
                  const move = (ev: PointerEvent) => {
                    const r = (ev.clientX - rect.left) / paneSpace;
                    splitRatioRef.current = Math.min(0.75, Math.max(0.25, r));
                    if (!raf) {
                      raf = requestAnimationFrame(() => {
                        raf = 0;
                        setSplitRatio(splitRatioRef.current);
                      });
                    }
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    if (raf) cancelAnimationFrame(raf);
                    dividerDraggingRef.current = false;
                    setSplitRatio(splitRatioRef.current);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              >
                {/* Swap the panes. Lives on the divider because the
                    divider is the one strip of shell between two native
                    pages — the only place a control can exist there. */}
                <button
                  type="button"
                  aria-label="Swap panes"
                  title="Swap panes"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setSplitPair((p) => (p ? [p[1], p[0]] : p))
                  }
                  className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-ring"
                >
                  <ArrowLeftRight size={11} strokeWidth={1.5} />
                </button>
              </div>
            )}
            {selection.kind === "settings" && (
              <SettingsPanel
                onClose={() => setSelection({ kind: "tab" })}
                onOpenUrl={(url) => {
                  setSelection({ kind: "tab" });
                  openNewTab(url).catch(() => {});
                }}
              />
            )}
            {selection.kind === "history" && (
              <HistoryPanel
                onClose={() => setSelection({ kind: "tab" })}
                onOpenUrl={(url) => {
                  setSelection({ kind: "tab" });
                  navigateTo(url).catch(() => {});
                }}
              />
            )}
            {selection.kind === "network" && (
              <NetworkInspector onClose={() => setSelection({ kind: "tab" })} />
            )}
            {editingBookmark && (
              <BookmarkEditPanel
                bookmark={editingBookmark}
                onSave={(url, title) => {
                  const { id } = editingBookmark;
                  setEditingBookmark(null);
                  saveBookmarkEdit(id, url, title).catch(() => {});
                }}
                onClose={() => setEditingBookmark(null)}
              />
            )}
          </div>

          {/* Notes host: the page yields this width (contentRect
              subtracts it), and the card floats inside it with the
              standard gutter on its far side. */}
          {notesMode !== null && (
            <div
              className="shrink-0 pb-2 pr-2 motion-safe:transition-[width] motion-safe:duration-[220ms] motion-safe:ease-out-cubic"
              style={{ width: notesWidth }}
            >
              <NotesPanel
                mode={notesMode}
                onSetMode={setNotesMode}
                onClose={() => {
                  setNotesMode(null);
                  setOpenClip(null);
                }}
                activeTab={
                  activeTab && activeTab.hasWebview
                    ? {
                        id: activeTab.id,
                        url: activeTab.url,
                        title: activeTab.title,
                      }
                    : null
                }
                initialClip={openClip}
                onOpenUrl={(url) => {
                  openNewTab(url).catch(() => {});
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab row menu. Fixed to the viewport, so it lives at the root
          rather than inside the content column.

          The bookmark tile menu next door is still a native NSMenu,
          which is now the odd one out: AppKit menu items cannot carry
          the lucide glyphs every other control in the app uses, and the
          menu is drawn by the system rather than the palette. Moving it
          onto this component is the obvious follow-up. */}
      {tabMenu &&
        (() => {
          const clicked = tabs.find((t) => t.id === tabMenu.tabId);
          if (!clicked) return null;
          const canSplit =
            hasActiveWebview &&
            clicked.id !== activeId &&
            clicked.url !== BLANK_URL;
          const items: ContextMenuItem[] = [
            {
              label: "Split left",
              icon: <PanelLeft size={14} strokeWidth={1.5} />,
              disabled: !canSplit,
              onSelect: () => {
                splitWithActive(clicked.id, "left").catch(() => {});
              },
            },
            {
              label: "Split right",
              icon: <PanelRight size={14} strokeWidth={1.5} />,
              disabled: !canSplit,
              onSelect: () => {
                splitWithActive(clicked.id, "right").catch(() => {});
              },
            },
            {
              label: "Close tab",
              icon: <X size={14} strokeWidth={1.5} />,
              // The same rule the row's own close control uses: the last
              // tab stays unless it has a page to close.
              disabled: !(tabs.length > 1 || clicked.hasWebview),
              onSelect: () => {
                closeTabById(clicked.id).catch(() => {});
              },
            },
          ];
          return (
            <ContextMenu
              x={tabMenu.x}
              y={tabMenu.y}
              // React cannot paint over a native page webview, so the
              // menu has to stay inside the chrome column.
              // Always the chrome column: the menu opens from a tab
              // row, and anything wider slides it under the native
              // page, where it would be invisible yet still focused.
              maxX={sidebarWidth}
              items={items}
              onClose={closeTabMenu}
            />
          );
        })()}

      {/* Pin-area menu: right-clicking empty space in the saved-sites
          grid. One item for now — New Folder — which drops an empty
          folder ready to fill. */}
      {pinMenu && (
        <ContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          maxX={sidebarWidth}
          items={[
            {
              label: "New Folder",
              icon: <FolderPlus size={14} strokeWidth={1.5} />,
              onSelect: () => {
                createFolder().catch(() => {});
              },
            },
          ]}
          onClose={closePinMenu}
        />
      )}
    </div>
  );
}

function BookmarkEditPanel({
  bookmark,
  onSave,
  onClose,
}: {
  bookmark: Bookmark;
  onSave: (url: string, title: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  // Keep Tab inside the dialog while it's open: it behaves modally
  // (overlay, closes on outside pointerdown / Escape), so focus must not
  // wander into the chrome behind it.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && activeEl === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const save = () => {
    const trimmedUrl = url.trim();
    const trimmedName = name.trim() || trimmedUrl;
    if (!trimmedUrl) return;
    onSave(trimmedUrl, trimmedName);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      data-tauri-drag-region="false"
      // Centred with a negative margin rather than -translate-x-1/2:
      // the width is a constant, and a keyframe replaces an element's
      // whole transform while it runs — the entrance would have thrown
      // the card 180px to the right for its first 160ms.
      className="absolute left-1/2 top-8 z-50 -ml-[180px] w-[360px] rounded-xl border border-border bg-background p-4 text-[13px] text-foreground motion-safe:animate-[np-drop_160ms_ease-out]"
    >
      <Kicker as="span" id={titleId} className="mb-3 block">
        Edit bookmark
      </Kicker>
      <label className="mb-2 block">
        <Kicker as="span" className="mb-1 block">
          Name
        </Kicker>
        <input
          ref={firstInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-foreground outline-none focus:border-ring"
        />
      </label>
      <label className="mb-3 block">
        <Kicker as="span" className="mb-1 block">
          URL
        </Kicker>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-foreground outline-none focus:border-ring"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-primary px-2 py-1 text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default App;
