import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { ipc, type NetworkEvent } from "@/lib/ipc";

/**
 * Reach — where your data goes, live.
 *
 * The old Home instrument was a year-calendar of "trackers seen": a card
 * that scrolled sideways, went to a sea of empty cells the moment real
 * usage turned out to be sparse, and buried its point under labels. This
 * replaces it with the thing Null is actually about — data movement made
 * visible — and reads it from the same live stream the Network Inspector
 * does, not a persisted daily tally.
 *
 * The picture is a hub and spoke: you at the centre, every origin your
 * browsing has reached this session a node radiating out, sized by how
 * often it was hit. An origin Null blocked is a severed spoke and a
 * hollow ring in `--danger` — the connection that never opened, shown
 * rather than counted. It sits directly on the background (no card), it
 * never scrolls, it carries one short caption instead of a legend, and a
 * handful of nodes reads as a calm constellation rather than an empty
 * grid.
 *
 * Honest framing, kept in the code so the surface stays quiet: this maps
 * connections the browser *observed*. With Null's blocking on, a tracker
 * dies in WebKit before the observer sees it, so a blocked spoke is one
 * you shielded by hand from the inspector; the map thins as blocking
 * works. It is a live instrument, not a ledger — it reflects this
 * session, and fills as you browse.
 */

const VIEW_W = 640;
const VIEW_H = 260;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const MAX_R = 108;
/** The golden angle: successive spokes never line up, so the spread
    stays even at three nodes and at thirty without a layout pass. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

type Origin = {
  origin: string;
  host: string;
  count: number;
  blocked: boolean;
  /** Placement, resolved once per render from the sorted rank. */
  x: number;
  y: number;
  r: number;
};

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/^www\./, "");
  }
}

/** Fold the raw event stream into one node per origin. An origin counts
    as blocked when its most recent request was refused — the state the
    shield leaves it in. */
function fold(events: NetworkEvent[]): Origin[] {
  const by = new Map<string, { count: number; blocked: boolean; at: number }>();
  for (const e of events) {
    const cur = by.get(e.origin);
    if (!cur) {
      by.set(e.origin, { count: 1, blocked: e.blocked, at: e.at });
    } else {
      cur.count += 1;
      if (e.at >= cur.at) {
        cur.at = e.at;
        cur.blocked = e.blocked;
      }
    }
  }
  const rows = [...by.entries()]
    .map(([origin, v]) => ({ origin, ...v }))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));

  const n = rows.length;
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 1);
  return rows.map((row, i) => {
    // Phyllotaxis: radius by rank so the busiest sit nearest the hub,
    // angle by the golden step so nothing collides. Even a lone origin
    // takes a real radius — placing it on the hub would draw the one
    // site the map exists to show as a zero-length spoke under the "you"
    // dot.
    const radius = MAX_R * Math.sqrt((i + 0.55) / n);
    const angle = i * GOLDEN;
    const size = 3.5 + 5 * (Math.log1p(row.count) / Math.log1p(maxCount));
    return {
      origin: row.origin,
      host: hostOf(row.origin),
      count: row.count,
      blocked: row.blocked,
      x: CX + radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
      r: size,
    };
  });
}

export function DataReach() {
  const [events, setEvents] = useState<NetworkEvent[] | null>(null);
  /** The origin of the most recent event — the live one, marked as
      connected. */
  const [liveOrigin, setLiveOrigin] = useState<string | null>(null);
  // Hover is keyed on the origin string, never a node object: `fold`
  // mints a fresh Origin on every live tick, so an object-identity guard
  // would never match on leave and the caption would stick to a node the
  // pointer had left — and read a frozen count off the stale object.
  const [hoverOrigin, setHoverOrigin] = useState<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    ipc
      .listNetworkEvents()
      .then((rows) => {
        setEvents(rows);
        if (rows.length) setLiveOrigin(rows[rows.length - 1].origin);
      })
      .catch(() => setEvents([]));

    // The live stream only exists inside the app. In a plain browser
    // (dev server, screenshots) `listen` reaches for Tauri internals that
    // are not there and throws — and unlike the inspector this component
    // is always mounted, so an unguarded call spams the console on every
    // Home. The seed above is enough to render; live ticks are the app's.
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = listen<NetworkEvent>("network-event", (e) => {
      setEvents((prev) => {
        const next = [...(prev ?? []), e.payload];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
      setLiveOrigin(e.payload.origin);
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, []);

  const nodes = useMemo(() => (events ? fold(events) : []), [events]);

  // Record which origins have been drawn *after* the render commits, not
  // during it. Mutating the ref inside the render body let StrictMode's
  // dev double-invoke mark a node seen on the throwaway pass, so the
  // committed pass thought it was old and dropped the pop-in entrance.
  useEffect(() => {
    for (const o of nodes) seenRef.current.add(o.origin);
  }, [nodes]);

  const blockedCount = useMemo(
    () => nodes.reduce((n, o) => n + (o.blocked ? 1 : 0), 0),
    [nodes],
  );

  const hover = hoverOrigin
    ? (nodes.find((n) => n.origin === hoverOrigin) ?? null)
    : null;

  // Hold the read until the first fetch resolves, so the surface never
  // flashes an empty state it is about to fill.
  if (!events) return null;

  const empty = nodes.length === 0;

  return (
    <section className="mb-10 select-none motion-safe:animate-[np-rise_160ms_ease-out]">
      {empty ? (
        <div className="flex h-[220px] items-center justify-center">
          <p className="max-w-xs text-center text-xs font-light leading-relaxed text-muted-foreground">
            As you browse, Null maps every place your data goes — and marks
            the ones it shut out.
          </p>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full overflow-visible"
            style={{ height: "auto" }}
            role="img"
            aria-label={`${nodes.length} sites reached, ${blockedCount} blocked`}
          >
            {/* Spokes, in two layers. The faint base line is the reach
                itself; a blocked one is dashed and tinted danger — the
                line that was cut. */}
            {nodes.map((o) => (
              <line
                key={`e-${o.origin}`}
                x1={CX}
                y1={CY}
                x2={o.x}
                y2={o.y}
                style={{
                  stroke: o.blocked ? "var(--danger)" : "var(--foreground)",
                  strokeOpacity: o.blocked ? 0.28 : 0.1,
                  strokeDasharray: o.blocked ? "2 3" : undefined,
                }}
                strokeWidth={1}
              />
            ))}

            {/* The current: a short dash that streams from you toward each
                open site, so the reach reads as live traffic and not a
                frozen diagram. Blocked spokes carry none — the block is
                the absence of flow. The live site's current runs in the
                accent. */}
            {nodes
              .filter((o) => !o.blocked)
              .map((o, i) => {
                const live = o.origin === liveOrigin;
                return (
                  <line
                    key={`f-${o.origin}`}
                    x1={CX}
                    y1={CY}
                    x2={o.x}
                    y2={o.y}
                    strokeLinecap="round"
                    className="motion-safe:[animation:np-flow_2.4s_linear_infinite]"
                    style={{
                      stroke: live ? "var(--select)" : "var(--foreground)",
                      strokeOpacity: live ? 0.75 : 0.42,
                      strokeDasharray: "3 22",
                      animationDelay: `${(i % 6) * 0.32}s`,
                    }}
                    strokeWidth={live ? 1.6 : 1.2}
                  />
                );
              })}

            {/* The hub: you. A quiet ring, and a dot at true centre. */}
            <circle
              cx={CX}
              cy={CY}
              r={9}
              fill="none"
              style={{ stroke: "var(--foreground)", strokeOpacity: 0.16 }}
            />
            <circle
              cx={CX}
              cy={CY}
              r={2.5}
              style={{ fill: "var(--muted-foreground)" }}
            />

            {/* Destinations. */}
            {nodes.map((o) => {
              const live = o.origin === liveOrigin && !o.blocked;
              // Read only — the seen set is written in an effect.
              const isNew = !seenRef.current.has(o.origin);
              return (
                <g
                  key={`n-${o.origin}`}
                  transform={`translate(${o.x} ${o.y})`}
                  onMouseEnter={() => setHoverOrigin(o.origin)}
                  onMouseLeave={() =>
                    setHoverOrigin((h) => (h === o.origin ? null : h))
                  }
                  style={{ cursor: "default" }}
                >
                  {/* Connected marker on the live node: a ring that
                      breathes in scale — the heartbeat of the live
                      connection, space not brightness. */}
                  {live && (
                    <circle
                      r={o.r + 4}
                      fill="none"
                      className="motion-safe:[animation:np-breathe_2.4s_ease-in-out_infinite]"
                      style={{
                        stroke: "var(--select)",
                        strokeOpacity: 0.5,
                        transformBox: "fill-box",
                        transformOrigin: "center",
                      }}
                      strokeWidth={1}
                    />
                  )}
                  <circle
                    r={o.r}
                    className={
                      isNew ? "motion-safe:animate-[np-pop_160ms_ease-out]" : ""
                    }
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      fill: o.blocked
                        ? "none"
                        : live
                          ? "var(--select)"
                          : "var(--muted-foreground)",
                      fillOpacity: o.blocked ? 1 : live ? 1 : 0.45,
                      stroke: o.blocked ? "var(--danger)" : "none",
                      strokeWidth: o.blocked ? 1.4 : 0,
                    }}
                  />
                </g>
              );
            })}
          </svg>

          {/* One line, not a legend. The counts carry the ink; the words
              stay muted. A hovered node borrows the line to name itself. */}
          <p className="mt-1 text-center font-mono text-[11px] tracking-wide text-muted-foreground">
            {hover ? (
              <span className="text-foreground">
                {hover.host}
                <span className="text-muted-foreground">
                  {" · "}
                  {hover.count} {hover.count === 1 ? "request" : "requests"}
                  {hover.blocked ? " · blocked" : ""}
                </span>
              </span>
            ) : (
              <>
                <span className="text-foreground">{nodes.length}</span> sites
                {blockedCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-danger">{blockedCount}</span> blocked
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
