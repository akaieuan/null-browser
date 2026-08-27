import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/panels/EmptyState";
import { Row, SectionHeader, Toggle } from "@/components/panels/settings/controls";
import { Kicker, ListRow } from "@/components/ui/atoms";
import { ipc, type BlockedOrigin } from "@/lib/ipc";

/**
 * The blocking surface. Two things live here and they are not the same
 * thing: the bundled rule list, which is one switch, and the origins the
 * user blocked by hand from the Network panel, which are a list they can
 * take back one at a time.
 */
export function BlockingSection() {
  // null is "no answer yet" — either the command is still in flight or
  // the backend does not have it. Either way the switch has nothing
  // truthful to show, so it stays inert rather than claiming "off".
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState<BlockedOrigin[]>([]);

  const refresh = useCallback(() => {
    ipc.listBlockedOrigins().then(setBlocked).catch(() => {});
  }, []);

  useEffect(() => {
    ipc.adBlockingEnabled().then(setEnabled).catch(() => setEnabled(null));
    refresh();
  }, [refresh]);

  async function setBlocking(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    try {
      await ipc.setAdBlocking(next);
    } catch {
      setEnabled(previous);
    }
  }

  async function unblock(origin: string) {
    await ipc.unblockOrigin(origin).catch(() => {});
    refresh();
  }

  return (
    <section>
      <SectionHeader title="Blocking">
        Rules are compiled by WebKit from a list bundled in the app. Nothing is
        downloaded to build the list and nothing updates it over the network.
      </SectionHeader>
      <div className="mt-1 flex flex-col">
        <Row label="Block ads and trackers">
          <Toggle
            // Unknown is unknown: while the backend hasn't answered,
            // the label must not claim "Off".
            label={enabled === null ? "—" : enabled ? "On" : "Off"}
            checked={enabled === true}
            disabled={enabled === null}
            onChange={setBlocking}
          />
        </Row>
      </div>
      <p className="max-w-md text-xs font-light leading-relaxed text-muted-foreground">
        Some sites detect blocking and object — YouTube while signed in is the
        usual one. The switch is yours; turn it off for a site that will not
        load without it.
      </p>

      <div className="mt-10">
        <Kicker as="span" className="block">
          Blocked origins
        </Kicker>
        {blocked.length === 0 ? (
          <EmptyState title="Nothing blocked.">
            Block origins from the Network panel.
          </EmptyState>
        ) : (
          <div className="mt-2 flex flex-col gap-0.5">
            {blocked.map((b) => (
              <ListRow key={b.origin} className="items-center">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
                  title={b.origin}
                >
                  {b.origin}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle">
                  {relativeTime(b.created_at)}
                </span>
                <button
                  type="button"
                  onClick={() => unblock(b.origin)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Unblock
                </button>
              </ListRow>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
