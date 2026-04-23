import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="text-sm font-medium">History</div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close History"
          onClick={onClose}
        >
          <X strokeWidth={1.5} />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <div className="text-sm text-foreground">No history yet.</div>
        <div className="max-w-md text-xs text-muted-foreground">
          Pages you visit will appear here. History is stored locally — never
          synced, never uploaded. You can clear it any time.
        </div>
      </div>
    </div>
  );
}
