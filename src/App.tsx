import { useEffect, useRef, useState } from "react";
import { ipc } from "./lib/ipc";
import { resolveQuery } from "./lib/url";

// Matches `TOP_BAR_HEIGHT` in src-tauri/src/webview/mod.rs.
const TOP_BAR_HEIGHT = 40;

function App() {
  const [input, setInput] = useState("");
  const [navigated, setNavigated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const sync = () =>
      ipc
        .resizeContent(window.innerWidth, window.innerHeight - TOP_BAR_HEIGHT)
        .catch(() => {
          // Content webview might not exist yet — fire and forget.
        });
    window.addEventListener("resize", sync);
    sync();
    return () => window.removeEventListener("resize", sync);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveQuery(input);
    if (!url) return;
    await ipc.navigate(url);
    setInput(url);
    setNavigated(true);
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4"
        style={{ height: TOP_BAR_HEIGHT }}
      >
        <span className="select-none text-sm font-medium tracking-tight text-neutral-400">
          Null
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search or enter URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-7 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
        />
      </form>
      {!navigated && (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
          Type a URL and press enter.
        </div>
      )}
    </div>
  );
}

export default App;
