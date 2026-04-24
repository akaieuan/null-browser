import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Shield,
  ShieldOff,
  Trash2,
} from "lucide-react";

import { PanelHeader } from "@/components/panels/PanelHeader";
import { ipc, type NetworkEvent } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function NetworkInspector({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [paused, setPausedState] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    ipc.listNetworkEvents().then(setEvents).catch(() => {});
    ipc.networkIsPaused().then(setPausedState).catch(() => {});
    ipc
      .listBlockedOrigins()
      .then((rows) => setBlocked(new Set(rows.map((b) => b.origin))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<NetworkEvent>("network-event", (e) => {
      setEvents((prev) => {
        const next = [...prev, e.payload];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [refresh]);

  async function togglePaused() {
    const next = !paused;
    await ipc.setNetworkPaused(next).catch(() => {});
    setPausedState(next);
  }

  async function clearAll() {
    await ipc.clearNetworkEvents().catch(() => {});
    setEvents([]);
  }

  async function toggleBlocked(origin: string) {
    if (blocked.has(origin)) {
      await ipc.unblockOrigin(origin).catch(() => {});
      setBlocked((prev) => {
        const next = new Set(prev);
        next.delete(origin);
        return next;
      });
    } else {
      await ipc.blockOrigin(origin).catch(() => {});
      setBlocked((prev) => new Set(prev).add(origin));
    }
  }

  function toggleExpand(origin: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  }

  const groups = useMemo(() => groupByOrigin(events), [events]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <PanelHeader title="Network" onClose={onClose} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          {events.length === 0 ? (
            <EmptyState paused={paused} blockedCount={blocked.size} />
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-1.5 w-1.5 rounded-full",
                      paused
                        ? "bg-muted-foreground"
                        : "bg-foreground animate-pulse",
                    )}
                  />
                  <span className="text-muted-foreground">
                    {events.length}{" "}
                    {events.length === 1 ? "request" : "requests"} ·{" "}
                    {groups.length}{" "}
                    {groups.length === 1 ? "origin" : "origins"}
                    {blocked.size > 0 &&
                      ` · ${blocked.size} blocked`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <ActionButton onClick={togglePaused}>
                    {paused ? (
                      <>
                        <Play size={12} strokeWidth={1.5} />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause size={12} strokeWidth={1.5} />
                        Pause
                      </>
                    )}
                  </ActionButton>
                  <ActionButton onClick={clearAll}>
                    <Trash2 size={12} strokeWidth={1.5} />
                    Clear
                  </ActionButton>
                </div>
              </div>

              <div className="flex flex-col border-t border-border">
                {groups.map(([origin, rows]) => (
                  <OriginGroup
                    key={origin}
                    origin={origin}
                    events={rows}
                    expanded={expanded.has(origin)}
                    blocked={blocked.has(origin)}
                    onToggle={() => toggleExpand(origin)}
                    onToggleBlock={() => toggleBlocked(origin)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function OriginGroup({
  origin,
  events,
  expanded,
  blocked,
  onToggle,
  onToggleBlock,
}: {
  origin: string;
  events: NetworkEvent[];
  expanded: boolean;
  blocked: boolean;
  onToggle: () => void;
  onToggleBlock: () => void;
}) {
  const last = events[events.length - 1];
  return (
    <section className="border-b border-border">
      <div className="group flex items-center gap-2 py-3 hover:bg-muted/30">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown
              size={12}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
            />
          ) : (
            <ChevronRight
              size={12}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
            />
          )}
          <span
            className={cn(
              "flex-1 truncate text-sm",
              blocked
                ? "text-muted-foreground line-through"
                : "text-foreground",
            )}
          >
            {origin}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {events.length}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {formatTime(last.at)}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleBlock}
          aria-label={blocked ? "Unblock origin" : "Block origin"}
          title={blocked ? "Unblock" : "Block"}
          className={cn(
            "mr-1 shrink-0 rounded p-1 transition-colors",
            blocked
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100",
          )}
        >
          {blocked ? (
            <ShieldOff size={12} strokeWidth={1.5} />
          ) : (
            <Shield size={12} strokeWidth={1.5} />
          )}
        </button>
      </div>
      {expanded && (
        <div className="pb-2 pl-5">
          {events
            .slice()
            .reverse()
            .map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 border-t border-border/60 py-1.5 first:border-t-0"
              >
                <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wider text-subtle">
                  {e.blocked ? "blocked" : e.kind}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 break-all text-xs",
                    e.blocked
                      ? "text-muted-foreground line-through"
                      : "text-muted-foreground",
                  )}
                >
                  {e.url}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle">
                  {formatTime(e.at)}
                </span>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function EmptyState({
  paused,
  blockedCount,
}: {
  paused: boolean;
  blockedCount: number;
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm text-foreground">
        {paused ? "Recording paused" : "No requests yet"}
      </div>
      <div className="max-w-sm text-xs text-muted-foreground">
        Every navigation Null makes is listed here in real time, grouped by
        origin. Hover an origin and click the shield to block all future
        requests to it.
        {blockedCount > 0 && ` (${blockedCount} currently blocked.)`}
      </div>
    </div>
  );
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function groupByOrigin(
  events: NetworkEvent[],
): Array<[string, NetworkEvent[]]> {
  const groups = new Map<string, NetworkEvent[]>();
  for (const e of events) {
    const existing = groups.get(e.origin);
    if (existing) existing.push(e);
    else groups.set(e.origin, [e]);
  }
  return Array.from(groups.entries()).sort((a, b) => {
    const aLast = a[1][a[1].length - 1].at;
    const bLast = b[1][b[1].length - 1].at;
    return bLast - aLast;
  });
}
