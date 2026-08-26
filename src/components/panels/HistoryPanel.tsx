import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

import { EmptyState } from "@/components/panels/EmptyState";
import { Panel } from "@/components/panels/Panel";
import { Kicker, ListRow } from "@/components/ui/atoms";
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
    <Panel title="History" onClose={onClose}>
      {loading ? (
        <HistorySkeleton />
      ) : entries.length === 0 ? (
        <HistoryEmpty />
      ) : (
        <>
          <div className="flex h-8 items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? "visit" : "visits"}
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              className="-mr-2 flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              Clear all
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-8">
            {grouped.map(([label, rows]) => (
              <section key={label}>
                <Kicker as="h3" className="mb-2 text-subtle">
                  {label}
                </Kicker>
                <div className="flex flex-col gap-0.5">
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
    </Panel>
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
    <ListRow
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 56px" }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="w-full truncate text-sm text-foreground underline-offset-2 group-hover:underline">
          {entry.title || entry.url}
        </span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {entry.url}
        </span>
      </button>
      <span className="mt-0.5 shrink-0 text-xs tabular-nums text-subtle">
        {time}
      </span>
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </ListRow>
  );
}

function HistorySkeleton() {
  // Show a believable shell of the real list while SQLite resolves.
  // Rows match HistoryRow's height so the layout doesn't jump.
  return (
    <div aria-hidden="true">
      <div className="flex h-8 items-center justify-between">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="mb-2 mt-4 h-3 w-20 rounded bg-muted" />
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="h-3 w-3/5 rounded bg-muted" />
              <div className="h-2.5 w-4/5 rounded bg-muted/60" />
            </div>
            <div className="h-2.5 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryEmpty() {
  return (
    <EmptyState title="No history yet">
      Pages you visit appear here. Local only — never synced, never uploaded.
    </EmptyState>
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
