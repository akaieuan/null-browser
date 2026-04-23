import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "./lib/ipc";
import { resolveQuery } from "./lib/url";

// Matches `TOP_BAR_HEIGHT` in src-tauri/src/webview/mod.rs.
const TOP_BAR_HEIGHT = 44;

// With `titleBarStyle: Overlay` on macOS, the traffic lights are drawn on top
// of our custom top bar in the top-left. Pad so the back button doesn't land
// under them.
const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const TRAFFIC_LIGHT_INSET = isMac ? 76 : 8;

function App() {
  const [input, setInput] = useState("");
  const [navigated, setNavigated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const sync = () =>
      ipc
        .resizeContent(window.innerWidth, window.innerHeight - TOP_BAR_HEIGHT)
        .catch(() => {});
    window.addEventListener("resize", sync);
    sync();
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Keep the address bar in sync with the page the content webview is actually
  // on — even if the user clicks a link inside the page.
  useEffect(() => {
    const promise = listen<string>("content-url-changed", (e) => {
      if (!focusedRef.current) setInput(e.payload);
    });
    return () => {
      promise.then((off) => off());
    };
  }, []);

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
        case "r":
          e.preventDefault();
          ipc.reload();
          break;
        case "[":
          e.preventDefault();
          ipc.goBack();
          break;
        case "]":
          e.preventDefault();
          ipc.goForward();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveQuery(input);
    if (!url) return;
    await ipc.navigate(url);
    setInput(url);
    setNavigated(true);
    inputRef.current?.blur();
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-1 border-b border-neutral-800/60 bg-neutral-950"
        style={{
          height: TOP_BAR_HEIGHT,
          paddingLeft: TRAFFIC_LIGHT_INSET,
          paddingRight: 8,
        }}
      >
        <NavButton label="Back" onClick={() => ipc.goBack()}>
          <ChevronLeft />
        </NavButton>
        <NavButton label="Forward" onClick={() => ipc.goForward()}>
          <ChevronRight />
        </NavButton>
        <NavButton label="Reload" onClick={() => ipc.reload()}>
          <Reload />
        </NavButton>

        <form onSubmit={handleSubmit} className="mx-2 flex-1">
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
            className="h-7 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 text-center text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:bg-neutral-800 focus:text-left focus:outline-none"
          />
        </form>

        <div className="w-16" />
      </div>

      {!navigated && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="flex items-center gap-3 text-neutral-200">
            <span className="text-3xl font-medium tracking-tight">Null</span>
            <NullMark />
          </div>
          <div className="flex flex-col items-center gap-1 text-sm text-neutral-600">
            <div>Type a URL and press enter.</div>
            <div className="text-xs text-neutral-700">
              ⌘L focus bar · ⌘R reload · ⌘[ back · ⌘] forward
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 active:bg-neutral-700"
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

function NullMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="16"
        cy="16"
        r="11"
        stroke="currentColor"
        strokeWidth="1.25"
      />
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
