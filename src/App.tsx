import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { THEMES, type ThemeId, useTheme } from "@/lib/theme";
import { resolveQuery } from "@/lib/url";
import { cn } from "@/lib/utils";

// Matches `TOP_BAR_HEIGHT` in src-tauri/src/webview/mod.rs.
const TOP_BAR_HEIGHT = 80;
const TAB_STRIP_HEIGHT = 36;

// With `titleBarStyle: Overlay` on macOS, the traffic lights are drawn on top
// of our custom top bar in the top-left. Pad so nothing lands under them.
const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const TRAFFIC_LIGHT_INSET = isMac ? 76 : 8;

type Tab = {
  id: string;
  url: string;
  title: string;
  /** True once a content webview has been created for this tab. A tab starts
   * life with `hasWebview = false`; we only spawn the webview on first
   * navigation so blank tabs stay as the React landing page. */
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
  const [, setTheme] = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const hasActiveWebview = activeTab?.hasWebview ?? false;
  const showLanding = !activeTab || !activeTab.hasWebview;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const promise = listen<ThemeId>("theme-set", (e) => {
      setTheme(e.payload);
    });
    return () => {
      promise.then((off) => off());
    };
  }, [setTheme]);

  useEffect(() => {
    const sync = () =>
      ipc
        .resizeContent(window.innerWidth, window.innerHeight - TOP_BAR_HEIGHT)
        .catch(() => {});
    window.addEventListener("resize", sync);
    sync();
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Tab URL syncing — when a page finishes loading inside a tab, update the
  // tab's URL and (if that tab is active and the user isn't typing) the bar.
  useEffect(() => {
    const promise = listen<{ id: string; url: string }>("tab-updated", (e) => {
      const { id, url } = e.payload;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, url, title: hostnameFor(url) } : t,
        ),
      );
      if (id === activeId && !focusedRef.current) setInput(url);
    });
    return () => {
      promise.then((off) => off());
    };
  }, [activeId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabs]);

  async function openNewTab(url: string = BLANK_URL) {
    const id = uuid();
    if (url !== BLANK_URL) {
      await ipc.openTab(id, url);
      await ipc.activateTab(id);
    } else {
      await ipc.hideAllTabs();
    }
    setTabs((prev) => [
      ...prev,
      {
        id,
        url,
        title: hostnameFor(url),
        hasWebview: url !== BLANK_URL,
      },
    ]);
    setActiveId(id);
    setInput(url === BLANK_URL ? "" : url);
    inputRef.current?.focus();
  }

  async function activateTabById(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.hasWebview) {
      await ipc.activateTab(id);
    } else {
      await ipc.hideAllTabs();
    }
    setActiveId(id);
    setInput(tab.url !== BLANK_URL ? tab.url : "");
  }

  async function closeTabById(id: string) {
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveQuery(input);
    if (!url) return;

    if (!activeId) {
      await openNewTab(url);
      return;
    }

    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) return;

    if (tab.hasWebview) {
      await ipc.navigateTab(activeId, url);
    } else {
      // First navigation on this tab — create its webview now.
      await ipc.openTab(activeId, url);
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
    inputRef.current?.blur();
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
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
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
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
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New Tab"
          onClick={() => openNewTab()}
          className="mb-1 ml-1"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </div>

      {/* Row 2: toolbar */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-1 bg-muted/40 px-2"
        style={{ height: TOP_BAR_HEIGHT - TAB_STRIP_HEIGHT }}
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
          className={cn(
            "w-full",
            hasActiveWebview ? "flex-1" : "mx-auto max-w-[480px]",
          )}
        >
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
              "h-7 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:bg-accent focus:outline-none",
              hasActiveWebview ? "text-left" : "text-center focus:text-left",
            )}
          />
        </form>

        <div className="w-16 shrink-0" />
      </div>

      {showLanding && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          <div className="flex items-center gap-1.5 text-foreground">
            <span className="text-3xl font-extralight tracking-tight">
              Null
            </span>
            <NullMark />
          </div>
          <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
            <div>Type a URL and press enter.</div>
            <div className="text-xs text-subtle">
              ⌘T new tab · ⌘W close · ⌘L focus · ⌘R reload · ⌘[ back · ⌘] forward
            </div>
          </div>
          <ThemePicker />
        </div>
      )}
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

function ThemePicker() {
  const [theme, setTheme] = useTheme();
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2.5">
        {THEMES.map((t) => {
          const selected = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-pressed={selected}
              title={t.label}
              onClick={() => setTheme(t.id)}
              className={cn(
                "h-6 w-6 rounded-full border transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
                  : "border-border opacity-70 hover:opacity-100",
              )}
              style={{ background: t.swatch }}
            />
          );
        })}
      </div>
      <div className="text-xs text-subtle">{active.label}</div>
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
