import { PanelHeader } from "@/components/panels/PanelHeader";

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <PanelHeader title="History" onClose={onClose} />
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-sm text-foreground">No history yet</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          Pages you visit will appear here. Local only — never synced, never
          uploaded.
        </div>
      </main>
    </div>
  );
}
