import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  Plus,
  RotateCw,
  Settings as SettingsIcon,
  Activity,
  Sparkles,
  Star,
  User,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { AIDrawer } from "@/components/panels/AIDrawer";
import { HistoryPanel } from "@/components/panels/HistoryPanel";
import { NetworkInspector } from "@/components/panels/NetworkInspector";
import { ProfileMenu } from "@/components/panels/ProfileMenu";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { TopProgress } from "@/components/TopProgress";
import { ipc, type Bookmark } from "@/lib/ipc";
import { AI_DRAWER_WIDTH } from "@/lib/layout";
import { usePreferences, resolveStartUrl } from "@/lib/preferences";
import { type Mode, type PaletteId, useTheme } from "@/lib/theme";
import { resolveQuery } from "@/lib/url";
import { cn } from "@/lib/utils";

// Tab strip + toolbar.
const NAV_BARS_HEIGHT = 80;
const TAB_STRIP_HEIGHT = 36;
const BOOKMARK_BAR_HEIGHT = 32;
// Thin strip reserved at the bottom of the top bar for the page-load
// progress line. Always reserved so starting a load doesn't re-lay out
// the native content webview.
const PROGRESS_BAR_HEIGHT = 2;

// Reserved for the profile dropdown so the active tab's webview doesn't
// clip it. Matches w-80 card + outer padding.
const PROFILE_STRIP_WIDTH = 336;


// With `titleBarStyle: Overlay` on macOS, the traffic lights are drawn on top
// of our custom top bar in the top-left. Pad so nothing lands under them.
const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const TRAFFIC_LIGHT_INSET = isMac ? 76 : 8;

type Tab = {
  id: string;
  url: string;
  title: string;
  hasWebview: boolean;
};

const BLANK_URL = "about:blank";

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

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [draggingBookmarkId, setDraggingBookmarkId] = useState<number | null>(
    null,
  );
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState<Set<string>>(new Set());
  const { setPalette, setMode } = useTheme();
  const { startPage, searchEngine } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const hasActiveWebview = activeTab?.hasWebview ?? false;
  const modalOpen = showSettings || showHistory || showNetwork;
  const showLanding = !modalOpen && (!activeTab || !activeTab.hasWebview);
  const showBookmarkBar = bookmarks.length > 0;

  const topBarHeight =
    NAV_BARS_HEIGHT +
    (showBookmarkBar ? BOOKMARK_BAR_HEIGHT : 0) +
    PROGRESS_BAR_HEIGHT;

  const activeLoading =
    activeId !== null && hasActiveWebview && loadingTabs.has(activeId);

  const activeBookmark = useMemo(() => {
    if (!activeTab || !activeTab.hasWebview) return null;
    return bookmarks.find((b) => b.url === activeTab.url) ?? null;
  }, [activeTab, bookmarks]);

  const draggingBookmark = useMemo(
    () => bookmarks.find((b) => b.id === draggingBookmarkId) ?? null,
    [bookmarks, draggingBookmarkId],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleBookmarkDragStart = useCallback((e: DragStartEvent) => {
    setDraggingBookmarkId(Number(e.active.id));
  }, []);

  const handleBookmarkDragEnd = useCallback((e: DragEndEvent) => {
    setDraggingBookmarkId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBookmarks((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === active.id);
      const newIdx = prev.findIndex((b) => b.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      ipc
        .reorderBookmarks(next.map((b) => b.id))
        .catch(() => {
          ipc.listBookmarks().then(setBookmarks).catch(() => {});
        });
      return next;
    });
  }, []);

  const handleBookmarkDragCancel = useCallback(() => {
    setDraggingBookmarkId(null);
  }, []);

  // Explicit window-drag handler. The `data-tauri-drag-region` attribute
  // can be flaky depending on Tauri version and WebView; calling
  // startDragging() directly is always reliable. Opt out when the click
  // target is interactive (button/input/form) or an ancestor is marked
  // data-tauri-drag-region="false".
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

  // Load bookmarks on mount.
  useEffect(() => {
    ipc.listBookmarks().then(setBookmarks).catch(() => {});
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const palettePromise = listen<PaletteId>("palette-set", (e) => {
      setPalette(e.payload);
    });
    const modePromise = listen<Mode>("mode-set", (e) => {
      setMode(e.payload);
    });
    return () => {
      palettePromise.then((off) => off());
      modePromise.then((off) => off());
    };
  }, [setPalette, setMode]);

  // Resize + reposition content webview any time the window resizes, the
  // top bar's height changes (bookmarks bar appearing), the AI drawer
  // toggles, or the profile dropdown opens (each reserves a right strip).
  useEffect(() => {
    const sync = () =>
      ipc
        .resizeContent(
          topBarHeight,
          window.innerWidth -
            (showAiDrawer ? AI_DRAWER_WIDTH : 0) -
            (profileMenuOpen ? PROFILE_STRIP_WIDTH : 0),
          window.innerHeight - topBarHeight,
        )
        .catch(() => {});
    window.addEventListener("resize", sync);
    sync();
    return () => window.removeEventListener("resize", sync);
  }, [topBarHeight, showAiDrawer, profileMenuOpen]);

  // Full-screen modals hide all tabs; closing them reactivates the tab.
  useEffect(() => {
    if (modalOpen) {
      ipc.hideAllTabs().catch(() => {});
    } else if (activeId) {
      const tab = tabs.find((t) => t.id === activeId);
      if (tab?.hasWebview) ipc.activateTab(activeId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  useEffect(() => {
    const promise = listen<{ id: string; url: string }>("tab-updated", (e) => {
      const { id, url } = e.payload;
      const title = hostnameFor(url);
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, url, title } : t)),
      );
      if (id === activeId && !focusedRef.current) setInput(url);
      // Local history: every finished page load, URL + title go to SQLite.
      // Skip about:* and data: URLs — those aren't real visits.
      if (url && !/^about:|^data:/i.test(url)) {
        ipc.addHistory(url, title).catch(() => {});
      }
    });
    return () => {
      promise.then((off) => off());
    };
  }, [activeId]);

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
      if (!activeId) {
        const id = uuid();
        await ipc.openTab(id, url, topBarHeight);
        await ipc.activateTab(id);
        setTabs((prev) => [
          ...prev,
          { id, url, title: hostnameFor(url), hasWebview: true },
        ]);
        setActiveId(id);
        setInput(url);
        return;
      }
      const tab = tabs.find((t) => t.id === activeId);
      if (!tab) return;
      if (tab.hasWebview) {
        await ipc.navigateTab(activeId, url);
      } else {
        await ipc.openTab(activeId, url, topBarHeight);
        await ipc.activateTab(activeId);
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? { ...t, url, title: hostnameFor(url), hasWebview: true }
            : t,
        ),
      );
      setInput(url);
    },
    [activeId, tabs, topBarHeight],
  );

  const openNewTab = useCallback(
    async (url?: string) => {
      const resolved = url ?? resolveStartUrl(startPage) ?? BLANK_URL;
      const id = uuid();
      const hasWebview = resolved !== BLANK_URL;
      if (hasWebview) {
        await ipc.openTab(id, resolved, topBarHeight);
        await ipc.activateTab(id);
      } else {
        await ipc.hideAllTabs();
      }
      setTabs((prev) => [
        ...prev,
        {
          id,
          url: resolved,
          title: hostnameFor(resolved),
          hasWebview,
        },
      ]);
      setActiveId(id);
      setInput(hasWebview ? resolved : "");
      inputRef.current?.focus();
    },
    [topBarHeight, startPage],
  );

  const activateTabById = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      if (tab.hasWebview) {
        await ipc.activateTab(id);
      } else {
        await ipc.hideAllTabs();
      }
      setActiveId(id);
      setInput(tab.url !== BLANK_URL ? tab.url : "");
    },
    [tabs],
  );

  const closeTabById = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab?.hasWebview) {
        await ipc.closeTab(id);
      }
      const remaining = tabs.filter((t) => t.id !== id);
      setTabs(remaining);
      if (activeId === id) {
        if (remaining.length > 0) {
          const next = remaining[remaining.length - 1];
          if (next.hasWebview) {
            await ipc.activateTab(next.id);
          } else {
            await ipc.hideAllTabs();
          }
          setActiveId(next.id);
          setInput(next.url !== BLANK_URL ? next.url : "");
        } else {
          setActiveId(null);
          setInput("");
        }
      }
    },
    [tabs, activeId],
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

  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);

  const openBookmarkMenu = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.preventDefault();
      ipc.showBookmarkMenu(id).catch(() => {});
    },
    [],
  );

  const saveBookmarkEdit = useCallback(
    async (id: number, url: string, title: string) => {
      await ipc.updateBookmark(id, url, title);
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, url, title } : b)),
      );
    },
    [],
  );

  // Native bookmark context-menu actions. The Rust side builds the OS
  // menu, pops it up, and emits this event with the chosen action + id.
  useEffect(() => {
    const promise = listen<{ action: string; id: number }>(
      "bookmark-menu-action",
      (e) => {
        const { action, id } = e.payload;
        const target = bookmarks.find((b) => b.id === id);
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
  }, [bookmarks, openNewTab, deleteBookmark]);

  const toggleHistory = useCallback(() => {
    setShowSettings(false);
    setShowNetwork(false);
    setShowHistory((v) => !v);
  }, []);

  const toggleSettings = useCallback(() => {
    setShowHistory(false);
    setShowNetwork(false);
    setShowSettings((v) => !v);
  }, []);

  const toggleNetwork = useCallback(() => {
    setShowSettings(false);
    setShowHistory(false);
    setShowNetwork((v) => !v);
  }, []);

  const closeHistory = useCallback(() => setShowHistory(false), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeNetwork = useCallback(() => setShowNetwork(false), []);

  const closeAllOverlays = useCallback(() => {
    setShowSettings(false);
    setShowHistory(false);
    setShowNetwork(false);
    setShowAiDrawer(false);
    setProfileMenuOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Panels and drawer have their own unmodified Esc behavior.
      if (e.key === "Escape") {
        if (
          showSettings ||
          showHistory ||
          showNetwork ||
          showAiDrawer ||
          profileMenuOpen
        ) {
          e.preventDefault();
          closeAllOverlays();
          return;
        }
      }

      if (!meta) return;
      switch (e.key) {
        case "l":
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
          break;
        case "t":
          e.preventDefault();
          openNewTab();
          break;
        case "w":
          e.preventDefault();
          if (activeId) closeTabById(activeId);
          break;
        case "r":
          e.preventDefault();
          if (activeId) ipc.reload(activeId);
          break;
        case "d":
          e.preventDefault();
          toggleBookmark();
          break;
        case "y":
          e.preventDefault();
          toggleHistory();
          break;
        case ",":
          e.preventDefault();
          toggleSettings();
          break;
        case "/":
          e.preventDefault();
          setShowAiDrawer((v) => !v);
          break;
        case "I":
          if (e.shiftKey) {
            e.preventDefault();
            toggleNetwork();
          }
          break;
        case "[":
          e.preventDefault();
          if (activeId) ipc.goBack(activeId);
          break;
        case "]":
          e.preventDefault();
          if (activeId) ipc.goForward(activeId);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeId,
    openNewTab,
    closeTabById,
    toggleBookmark,
    toggleHistory,
    toggleSettings,
    toggleNetwork,
    showSettings,
    showHistory,
    showNetwork,
    showAiDrawer,
    profileMenuOpen,
    closeAllOverlays,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveQuery(input, searchEngine);
    if (!url) return;
    await navigateTo(url);
    inputRef.current?.blur();
  }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleChromeMouseDown}
      className="flex h-screen flex-col bg-background text-foreground"
    >
      {/* Row 1: tab strip */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-end gap-1 bg-muted/40"
        style={{
          height: TAB_STRIP_HEIGHT,
          paddingLeft: TRAFFIC_LIGHT_INSET,
          paddingRight: 8,
        }}
      >
        <div
          data-tauri-drag-region
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              canClose={tabs.length > 1 || tab.hasWebview}
              onActivate={() => activateTabById(tab.id)}
              onClose={() => closeTabById(tab.id)}
            />
          ))}
          <Button
            variant="ghost"
            size="icon"
            aria-label="New Tab"
            onClick={() => openNewTab()}
            data-tauri-drag-region="false"
            className="mb-1 shrink-0"
          >
            <Plus strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {/* Row 2: toolbar */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-1 bg-muted/40 px-2"
        style={{ height: NAV_BARS_HEIGHT - TAB_STRIP_HEIGHT }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          disabled={!hasActiveWebview}
          onClick={() => activeId && ipc.goBack(activeId)}
        >
          <ChevronLeft strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Forward"
          disabled={!hasActiveWebview}
          onClick={() => activeId && ipc.goForward(activeId)}
        >
          <ChevronRight strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reload"
          disabled={!hasActiveWebview}
          onClick={() => activeId && ipc.reload(activeId)}
        >
          <RotateCw strokeWidth={1.5} />
        </Button>

        <form
          onSubmit={handleSubmit}
          data-tauri-drag-region="false"
          className={cn(
            "w-full",
            hasActiveWebview ? "flex-1" : "mx-auto max-w-[480px]",
          )}
        >
          <div className="group flex h-7 w-full items-center rounded-md border border-border bg-input focus-within:border-ring focus-within:bg-accent">
            <button
              type="button"
              aria-label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              disabled={!hasActiveWebview}
              onClick={toggleBookmark}
              className={cn(
                "shrink-0 rounded-sm p-1 ml-1 transition-colors",
                activeBookmark
                  ? "text-foreground"
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
              }}
              placeholder="Search or enter URL"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={cn(
                "h-full w-full bg-transparent pl-1 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none",
                hasActiveWebview ? "text-left" : "text-center focus:text-left",
              )}
            />
          </div>
        </form>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Network"
            title="Network · ⌘⇧I"
            onClick={toggleNetwork}
            className={cn(showNetwork && "bg-muted text-foreground")}
          >
            <Activity strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="History"
            onClick={toggleHistory}
            className={cn(showHistory && "bg-muted text-foreground")}
          >
            <HistoryIcon strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Chat"
            onClick={() => setShowAiDrawer((v) => !v)}
            className={cn(showAiDrawer && "bg-muted text-foreground")}
          >
            <Sparkles strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={toggleSettings}
            className={cn(showSettings && "bg-muted text-foreground")}
          >
            <SettingsIcon strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Profile"
            data-profile-trigger
            onClick={() => {
              setShowSettings(false);
              setShowHistory(false);
              setProfileMenuOpen((v) => !v);
            }}
            className={cn(profileMenuOpen && "bg-muted text-foreground")}
          >
            <User strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {/* Row 3: bookmarks bar (only when there are bookmarks).
          Shares the toolbar's bg so it reads as one continuous surface.
          Gaps between items are window-drag surface; items opt out via
          data-tauri-drag-region="false" on the sortable wrapper. */}
      {showBookmarkBar && (
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto bg-muted/40 px-2 pb-1"
          style={{ height: BOOKMARK_BAR_HEIGHT }}
        >
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={handleBookmarkDragStart}
            onDragEnd={handleBookmarkDragEnd}
            onDragCancel={handleBookmarkDragCancel}
          >
            <SortableContext
              items={bookmarks.map((b) => b.id)}
              strategy={horizontalListSortingStrategy}
            >
              {bookmarks.map((b) => (
                <SortableBookmarkBarItem
                  key={b.id}
                  bookmark={b}
                  onClick={() => navigateTo(b.url)}
                  onContextMenu={(e) => openBookmarkMenu(e, b.id)}
                />
              ))}
            </SortableContext>
            <DragOverlay>
              {draggingBookmark ? (
                <div className="rounded shadow-md opacity-90">
                  <BookmarkBarItem
                    bookmark={draggingBookmark}
                    onClick={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
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

      {/* Thin progress strip. Always reserved so starting a load doesn't
          re-lay out the native webview. Hidden via opacity when idle. */}
      <div
        data-tauri-drag-region
        className="relative shrink-0 bg-muted/40"
        style={{ height: PROGRESS_BAR_HEIGHT }}
      >
        <TopProgress active={activeLoading} />
      </div>

      {/* Below the top bars: content area + AI drawer side-by-side.
          Content webview is positioned here by Tauri; React just manages
          landing/panels/drawer on top. */}
      <div
        data-tauri-drag-region="false"
        className="relative flex flex-1 min-h-0"
      >
        <div className="relative flex-1">
          {showLanding && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-8">
              <div className="flex items-center gap-1.5 text-foreground">
                <span className="text-3xl font-extralight tracking-tight">
                  Null
                </span>
                <NullMark />
              </div>
              <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                <div>Type a URL and press enter.</div>
                <div className="text-xs text-subtle">
                  ⌘T new tab · ⌘W close · ⌘L focus · ⌘D bookmark · ⌘, settings
                </div>
              </div>
            </div>
          )}
          {showSettings && <SettingsPanel onClose={closeSettings} />}
          {showHistory && (
            <HistoryPanel
              onClose={closeHistory}
              onOpenUrl={(url) => {
                setShowHistory(false);
                navigateTo(url);
              }}
            />
          )}
          {showNetwork && <NetworkInspector onClose={closeNetwork} />}
          {profileMenuOpen && (
            <ProfileMenu
              onClose={() => setProfileMenuOpen(false)}
              onOpenSettings={() => {
                setProfileMenuOpen(false);
                setShowSettings(true);
              }}
            />
          )}
        </div>
        {showAiDrawer && (
          <AIDrawer
            onClose={() => setShowAiDrawer(false)}
            activeTab={
              activeTab && activeTab.hasWebview
                ? { id: activeTab.id, url: activeTab.url, title: activeTab.title }
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function TabPill({
  tab,
  active,
  canClose,
  onActivate,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  canClose: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      data-tauri-drag-region="false"
      className={cn(
        "group relative flex h-7 min-w-0 max-w-[200px] flex-1 cursor-default items-center gap-2 rounded-md px-3 text-xs transition-colors",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      {canClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close tab"
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <X size={10} strokeWidth={1.5} />
        </button>
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

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

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
      data-tauri-drag-region="false"
      className="fixed left-1/2 top-20 z-50 w-[360px] -translate-x-1/2 rounded-lg border border-border bg-background p-3 text-[13px] text-foreground shadow-lg"
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Edit bookmark
      </div>
      <label className="mb-2 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
          Name
        </span>
        <input
          ref={firstInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="w-full rounded border border-border bg-muted/40 px-2 py-1 text-foreground outline-none focus:border-foreground/40"
        />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
          URL
        </span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="w-full rounded border border-border bg-muted/40 px-2 py-1 text-foreground outline-none focus:border-foreground/40"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded bg-foreground px-2 py-1 text-background hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function BookmarkBarItem({
  bookmark,
  onClick,
  onContextMenu,
}: {
  bookmark: Bookmark;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={bookmark.url}
      className="flex h-6 max-w-[180px] shrink-0 items-center rounded px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="truncate">{bookmark.title}</span>
    </button>
  );
}

function SortableBookmarkBarItem({
  bookmark,
  onClick,
  onContextMenu,
}: {
  bookmark: Bookmark;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: bookmark.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tauri-drag-region="false"
      {...attributes}
      {...listeners}
    >
      <BookmarkBarItem
        bookmark={bookmark}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

function NullMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.25" />
      <line
        x1="6"
        y1="26"
        x2="26"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default App;
