import { useEffect, useRef, useState } from "react";
import { ipc } from "./lib/ipc";
import { resolveQuery } from "./lib/url";

// Matches `TOP_BAR_HEIGHT` in src-tauri/src/webview/mod.rs.
const TOP_BAR_HEIGHT = 40;

function App() {
  const [input, setInput] = useState("");
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
  }

  return (
    <div className="h-screen bg-neutral-950 text-neutral-100">
      <form
        onSubmit={handleSubmit}
        className="flex h-10 items-center gap-2 border-b border-neutral-800/80 bg-neutral-950 px-3"
        style={{ height: TOP_BAR_HEIGHT }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search or enter URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-7 flex-1 rounded-md bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-700"
        />
      </form>
    </div>
  );
}

export default App;
