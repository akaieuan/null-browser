import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

import { PanelHeader } from "@/components/panels/PanelHeader";
import { ipc, type HistoryEntry } from "@/lib/ipc";

export function HistoryPanel({
  onClose,
  onOpenUrl,
}: {
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    ipc
      .listHistory()
      .then((rows) => setEntries(rows))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRemove(id: number) {
    await ipc.removeHistory(id).catch(() => {});
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleClearAll() {
    await ipc.clearHistory().catch(() => {});
    setEntries([]);
  }

  const grouped = groupByDay(entries);

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <PanelHeader title="History" onClose={onClose} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {entries.length} {entries.length === 1 ? "visit" : "visits"}
                </div>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                  Clear all
                </button>
              </div>
              <div className="flex flex-col gap-8">
                {grouped.map(([label, rows]) => (
                  <section key={label}>
                    <h3 className="mb-2 text-xs font-medium text-subtle">
                      {label}
                    </h3>
                    <div className="border-t border-border">
                      {rows.map((e) => (
                        <HistoryRow
                          key={e.id}
                          entry={e}
                          onOpen={() => onOpenUrl(e.url)}
                          onRemove={() => handleRemove(e.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function HistoryRow({
  entry,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const time = formatTime(entry.visited_at);
  return (
    <div className="group flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <span className="truncate text-sm text-foreground group-hover:underline underline-offset-2">
          {entry.title || entry.url}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {entry.url}
        </span>
      </button>
      <span className="shrink-0 text-xs tabular-nums text-subtle">{time}</span>
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm text-foreground">No history yet</div>
      <div className="max-w-sm text-xs text-muted-foreground">
        Pages you visit will appear here. Local only — never synced, never
        uploaded.
      </div>
    </div>
  );
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function groupByDay(entries: HistoryEntry[]): Array<[string, HistoryEntry[]]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const label = dayLabel(entry.visited_at);
    const list = groups.get(label);
    if (list) list.push(entry);
    else groups.set(label, [entry]);
  }
  return Array.from(groups.entries());
}

function dayLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round(
    (todayStart.getTime() - entryStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
