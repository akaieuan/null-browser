import { useEffect, useMemo, useState } from "react";

import { Kicker } from "@/components/ui/atoms";
import { ipc, type TrackerDay } from "@/lib/ipc";

/**
 * A year of trackers seen — the GitHub-contribution shape, one cell per
 * day, intensity by count, filling the content width as one card.
 *
 * The honest framing is load-bearing and lives in the code, not on the
 * surface (the card stays visual): this counts requests to known
 * tracker hosts the browser *observed*, not ones it blocked. A blocked
 * request never reaches the observer — it dies in WebKit before a
 * connection opens — so turning blocking on makes this graph fall. It
 * reads as exposure, and the drop is the blocker working; it is not a
 * scoreboard of blocks, which are by design uncountable
 * (`docs/PHILOSOPHY.md`).
 */

const WEEKS = 53;
const DAY_MS = 86_400_000;
const CELL = 11;
const GAP = 3;
const COL = CELL + GAP;

/** 0 = Sunday. Epoch day 0 (1970-01-01) was a Thursday. */
function weekday(epochDay: number): number {
  return ((((epochDay % 7) + 4) % 7) + 7) % 7;
}

/** Five buckets: empty, then four rising bands of the accent. */
function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < 4) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}

const FILL: Record<number, string> = {
  0: "color-mix(in srgb, var(--foreground) 6%, transparent)",
  1: "color-mix(in srgb, var(--select) 30%, transparent)",
  2: "color-mix(in srgb, var(--select) 52%, transparent)",
  3: "color-mix(in srgb, var(--select) 74%, transparent)",
  4: "var(--select)",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export function TrackerGraph() {
  const [rows, setRows] = useState<TrackerDay[] | null>(null);

  useEffect(() => {
    ipc
      .listTrackerSightings()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const model = useMemo(() => {
    if (!rows) return null;
    const counts = new Map(rows.map((r) => [r.day, r.count]));
    const today = Math.floor(Date.now() / DAY_MS);
    // Each column is a clean Sun→Sat week; the leftmost starts on the
    // Sunday that opens the earliest shown week.
    const start = today - weekday(today) - (WEEKS - 1) * 7;

    const weeks = Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const day = start + w * 7 + d;
        return { day, count: day > today ? null : counts.get(day) ?? 0 };
      }),
    );

    // A month label sits over the first column whose Sunday is in a
    // month the previous column wasn't.
    const months: { label: string; left: number }[] = [];
    let prev = -1;
    weeks.forEach((col, w) => {
      const m = new Date(col[0].day * DAY_MS).getMonth();
      if (m !== prev) {
        months.push({ label: MONTHS[m], left: w * COL });
        prev = m;
      }
    });

    const total = rows
      .filter((r) => r.day >= start)
      .reduce((sum, r) => sum + r.count, 0);
    const busiest = rows
      .filter((r) => r.day >= start)
      .reduce((max, r) => Math.max(max, r.count), 0);

    return { weeks, months, total, busiest };
  }, [rows]);

  // Nothing to show until the first sighting — a fresh install opens on
  // the notes, not an empty grid asking to be filled.
  if (!model || model.total === 0) return null;

  const gridWidth = WEEKS * COL - GAP;

  return (
    <section className="mb-10 rounded-xl bg-card p-5 motion-safe:animate-[np-rise_160ms_ease-out]">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Kicker>Trackers seen</Kicker>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-light tabular-nums leading-none text-foreground">
              {model.total.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              this year · blocking makes it fall
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pb-0.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="rounded-[2px]"
              style={{ width: CELL, height: CELL, backgroundColor: FILL[l] }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <div className="flex gap-1.5">
          {/* Weekday gutter */}
          <div
            className="flex shrink-0 flex-col text-[9px] text-muted-foreground"
            style={{ gap: GAP, paddingTop: 16 }}
          >
            {WEEKDAY_LABELS.map((d, i) => (
              <span
                key={i}
                className="flex items-center leading-none"
                style={{ height: CELL }}
              >
                {d}
              </span>
            ))}
          </div>

          <div>
            {/* Month ticks, absolutely placed over their columns */}
            <div className="relative h-4" style={{ width: gridWidth }}>
              {model.months.map((m, i) => (
                <span
                  key={i}
                  className="absolute top-0 text-[9px] leading-none text-muted-foreground"
                  style={{ left: m.left }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* The calendar */}
            <div className="flex" style={{ gap: GAP }}>
              {model.weeks.map((col, w) => (
                <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                  {col.map((cell) =>
                    cell.count === null ? (
                      <div key={cell.day} style={{ width: CELL, height: CELL }} />
                    ) : (
                      <div
                        key={cell.day}
                        className="rounded-[2px] transition-transform motion-safe:hover:scale-125"
                        style={{
                          width: CELL,
                          height: CELL,
                          backgroundColor: FILL[level(cell.count)],
                        }}
                        title={`${cell.count} tracker${
                          cell.count === 1 ? "" : "s"
                        } · ${new Date(cell.day * DAY_MS).toLocaleDateString()}`}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
