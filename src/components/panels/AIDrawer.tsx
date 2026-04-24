import { ArrowUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AI_DRAWER_WIDTH } from "@/lib/layout";

export { AI_DRAWER_WIDTH };

export function AIDrawer({ onClose }: { onClose: () => void }) {
  return (
    <aside
      className="z-30 flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width: AI_DRAWER_WIDTH }}
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="text-sm font-medium">Chat</div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Chat"
          onClick={onClose}
          className="h-7 w-7"
        >
          <X size={14} strokeWidth={1.5} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <EmptyState />
      </div>

      <div className="shrink-0 p-3">
        <div className="rounded-2xl border border-border bg-muted/30 p-3 transition-colors focus-within:border-ring focus-within:bg-muted/60">
          <textarea
            disabled
            placeholder="Ask anything…"
            rows={2}
            className="block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wider text-subtle">
              Local · not connected
            </div>
            <button
              type="button"
              disabled
              aria-label="Send"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background opacity-30 transition-opacity disabled:cursor-not-allowed"
            >
              <ArrowUp size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <div className="mt-2 px-1 text-[10px] leading-relaxed text-subtle">
          No model connected. Install Ollama for local inference, or add a
          cloud provider in Settings.
        </div>
      </div>
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="text-sm font-medium text-foreground">
        Start a conversation
      </div>
      <div className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
        Connect a local Ollama model or a cloud provider to chat. Every call is
        logged locally and — for cloud — surfaced in the UI before it leaves
        your machine.
      </div>
      <a
        href="https://ollama.com"
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Install Ollama ↗
      </a>
    </div>
  );
}
