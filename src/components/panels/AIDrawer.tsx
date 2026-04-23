import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export const AI_DRAWER_WIDTH = 360;

export function AIDrawer({ onClose }: { onClose: () => void }) {
  return (
    <aside
      className="z-30 flex h-full shrink-0 flex-col border-l border-border bg-muted/40"
      style={{ width: AI_DRAWER_WIDTH }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="text-xs font-medium uppercase tracking-wider text-subtle">
          Chat
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Chat"
          onClick={onClose}
          className="h-6 w-6"
        >
          <X size={14} strokeWidth={1.5} />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-sm text-foreground">
          Local model via Ollama — not detected
        </div>
        <div className="text-xs text-muted-foreground">
          Install Ollama and pull a model to chat locally. Nothing leaves your
          machine.
        </div>
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          ollama.com
        </a>
      </div>

      <div className="border-t border-border p-3">
        <textarea
          disabled
          placeholder="Connect a model to start chatting"
          className="h-16 w-full resize-none rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
        />
      </div>
    </aside>
  );
}
