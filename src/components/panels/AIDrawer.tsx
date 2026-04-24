import { ArrowUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AI_DRAWER_WIDTH } from "@/lib/layout";
import { cn } from "@/lib/utils";

export { AI_DRAWER_WIDTH };

type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Placeholder until the Ollama/cloud provider wiring lands.
const STATUS: ConnectionStatus = "disconnected";

export function AIDrawer({ onClose }: { onClose: () => void }) {
  const connected = STATUS === "connected";

  return (
    <aside
      className="z-30 flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width: AI_DRAWER_WIDTH }}
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Chat</span>
          <StatusDot status={STATUS} />
        </div>
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
        <div className="rounded-2xl border border-border bg-muted/20 px-3 py-2.5 transition-colors focus-within:border-ring focus-within:bg-muted/40">
          <textarea
            disabled={!connected}
            placeholder="Ask anything"
            rows={1}
            className="block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-1.5 flex items-center justify-end">
            <button
              type="button"
              disabled={!connected}
              aria-label="Send"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
            >
              <ArrowUp size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting"
        : "No model connected";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "connecting" && "animate-pulse bg-amber-500",
        status === "disconnected" && "bg-red-500",
      )}
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="text-[11px] uppercase tracking-[0.2em] text-subtle">
        local first
      </div>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Run Ollama models or add provider keys.
      </div>
      <div className="mt-5 flex items-center gap-4 text-xs">
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Install Ollama
        </a>
        <span className="text-subtle">·</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
        >
          Add provider key
        </button>
      </div>
    </div>
  );
}
