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

import { EmptyState } from "@/components/panels/EmptyState";
import { Panel } from "@/components/panels/Panel";
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
    <Panel title="Network" onClose={onClose}>
      {events.length === 0 ? (
        <NetworkEmpty paused={paused} blockedCount={blocked.size} />
      ) : (
        <>
              <div className="flex h-8 items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-1.5 w-1.5 rounded-full",
                      paused ? "bg-muted-foreground" : "bg-select",
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

              <div className="mt-3 flex flex-col gap-0.5">
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
    </Panel>
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
    <section>
      <div className="group -mx-3 flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted">
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
            "mr-1 shrink-0 rounded-sm p-1 transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            blocked
              ? "text-foreground hover:bg-accent"
              : "text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
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
        // The expanded body is a recessed surface rather than a bracket
        // of rules: one tone step says "these belong to the row above"
        // without drawing four more lines into a panel that is already
        // a list of lists.
        <div className="mb-1 ml-5 flex flex-col rounded-lg bg-muted/60 px-3 py-1.5">
          {events
            .slice()
            .reverse()
            .map((e) => (
              <div key={e.id} className="flex items-start gap-3 py-1">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
                    e.blocked ? "text-danger" : "text-subtle",
                  )}
                >
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
      className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function NetworkEmpty({
  paused,
  blockedCount,
}: {
  paused: boolean;
  blockedCount: number;
}) {
  return (
    <EmptyState title={paused ? "Recording paused" : "No requests yet"}>
      Every request Null makes is listed here as it happens, grouped by origin.
      Hover an origin and click the shield to block everything it sends after
      that.
      {blockedCount > 0 &&
        ` ${blockedCount} ${blockedCount === 1 ? "origin is" : "origins are"} blocked.`}
    </EmptyState>
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
