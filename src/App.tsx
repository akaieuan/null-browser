import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "./lib/ipc";
import { THEMES, type ThemeId, useTheme } from "./lib/theme";
import { resolveQuery } from "./lib/url";

// Matches `TOP_BAR_HEIGHT` in src-tauri/src/webview/mod.rs.
const TOP_BAR_HEIGHT = 80;
const TAB_STRIP_HEIGHT = 36;

// With `titleBarStyle: Overlay` on macOS, the traffic lights are drawn on top
// of our custom top bar in the top-left. Pad so nothing lands under them.
const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const TRAFFIC_LIGHT_INSET = isMac ? 76 : 8;

type Tab = { id: string; url: string; title: string };

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
        prev.map((t) => (t.id === id ? { ...t, url, title: hostnameFor(url) } : t)),
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
    await ipc.openTab(id, url);
    await ipc.activateTab(id);
    setTabs((prev) => [...prev, { id, url, title: hostnameFor(url) }]);
    setActiveId(id);
    setInput(url === BLANK_URL ? "" : url);
    inputRef.current?.focus();
  }

  async function activateTabById(id: string) {
    await ipc.activateTab(id);
    setActiveId(id);
    const tab = tabs.find((t) => t.id === id);
    setInput(tab && tab.url !== BLANK_URL ? tab.url : "");
  }

  async function closeTabById(id: string) {
    await ipc.closeTab(id);
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeId === id) {
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        await ipc.activateTab(next.id);
        setActiveId(next.id);
        setInput(next.url === BLANK_URL ? "" : next.url);
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
    if (activeId) {
      await ipc.navigateTab(activeId, url);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, url, title: hostnameFor(url) } : t,
        ),
      );
    } else {
      await openNewTab(url);
      return;
    }
    setInput(url);
    inputRef.current?.blur();
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Row 1: tab strip */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-end gap-px bg-muted/40"
        style={{
          height: TAB_STRIP_HEIGHT,
          paddingLeft: TRAFFIC_LIGHT_INSET,
          paddingRight: 8,
        }}
      >
        <div className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto">
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              canClose={tabs.length > 1 || tab.url !== BLANK_URL}
              onActivate={() => activateTabById(tab.id)}
              onClose={() => closeTabById(tab.id)}
            />
          ))}
        </div>
        <IconButton
          label="New Tab"
          onClick={() => openNewTab()}
          className="mb-1 ml-1"
        >
          <Plus />
        </IconButton>
      </div>

      {/* Row 2: toolbar */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2"
        style={{ height: TOP_BAR_HEIGHT - TAB_STRIP_HEIGHT }}
      >
        <IconButton
          label="Back"
          onClick={() => activeId && ipc.goBack(activeId)}
          disabled={!activeId}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          label="Forward"
          onClick={() => activeId && ipc.goForward(activeId)}
          disabled={!activeId}
        >
          <ChevronRight />
        </IconButton>
        <IconButton
          label="Reload"
          onClick={() => activeId && ipc.reload(activeId)}
          disabled={!activeId}
        >
          <Reload />
        </IconButton>

        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full"
          style={{ maxWidth: 480 }}
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
            className="h-7 w-full rounded-md border border-border bg-input px-3 text-center text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:bg-accent focus:text-left focus:outline-none"
          />
        </form>

        <ThemeSwitcher />
      </div>

      {tabs.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="flex items-center gap-3 text-foreground">
            <span className="text-3xl font-medium tracking-tight">Null</span>
            <NullMark />
          </div>
          <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
            <div>Type a URL and press enter.</div>
            <div className="text-xs text-subtle">
              ⌘T new tab · ⌘W close · ⌘L focus · ⌘R reload · ⌘[ back · ⌘] forward
            </div>
          </div>
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
      className={
        "group relative flex h-7 min-w-0 max-w-[200px] flex-1 cursor-default items-center gap-2 rounded-t-md border-b-0 px-3 text-xs transition-colors " +
        (active
          ? "border border-border bg-background text-foreground"
          : "border border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground")
      }
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
          <XSmall />
        </button>
      )}
    </div>
  );
}

function ThemeSwitcher() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex shrink-0 items-center gap-1 pl-1">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={t.label}
          title={t.label}
          onClick={() => setTheme(t.id)}
          className={
            "h-4 w-4 rounded-full border " +
            (theme === t.id ? "border-foreground" : "border-border")
          }
          style={{ background: t.swatch }}
        />
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:bg-accent disabled:opacity-30 disabled:hover:bg-transparent " +
        className
      }
    >
      {children}
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 3L5 8L10 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 3L11 8L6 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Reload() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.5 0 2.9.6 3.9 1.6M13.5 3v2.5h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Plus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 3V13M3 8H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function XSmall() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M2 2L8 8M8 2L2 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
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
