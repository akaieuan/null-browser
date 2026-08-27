import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/panels/EmptyState";
import { Kicker } from "@/components/ui/atoms";
import { ipc, type Artifact } from "@/lib/ipc";

/**
 * The new-tab surface.
 *
 * The governing rule: Home shows only what the sidebar cannot. Bookmarks
 * are permanently visible two inches to the left, so a favourites grid
 * would be pure duplication; History and Network are one click away as
 * destinations. What the sidebar lists but cannot show inline is clips —
 * and clips are the one thing in Null you deliberately made.
 *
 * Deliberately absent: any counter. A number that ticks upward while you
 * look at it is a dashboard element however privacy-flavoured the
 * framing, and the network event log is a capped in-memory ring that
 * resets each launch, so it could not honestly carry the word "today".
 */
export function Home({
  onOpenClip,
  onOpenUrl,
}: {
  onOpenClip: (clip: Artifact) => void;
  onOpenUrl: (url: string) => void;
}) {
  const [clips, setClips] = useState<Artifact[]>([]);
  const [notesDir, setNotesDir] = useState<string | null>(null);

  useEffect(() => {
    ipc.listArtifacts().then(setClips).catch(() => {});
    ipc.getNotesDir().then(setNotesDir).catch(() => {});
  }, []);

  return (
    // No Card wrapper: the fresh tab is the one surface that sits
    // directly on the glass. Each note is its own small card, so the
    // desktop shows between them — the wallpaper is the ground, the
    // notes are objects on it.
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-20 pt-16">
        <Kicker>Notes</Kicker>
        {clips.length === 0 ? (
          <div className="mt-4 max-w-md rounded-xl bg-card p-5">
            <EmptyState title="Nothing saved yet.">
              Null writes notes as markdown to{" "}
              <span className="font-mono">
                {notesDir ?? "your notes folder"}
              </span>
              .
            </EmptyState>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {clips.slice(0, 9).map((c, i) => (
              <HomeClipCard
                key={c.id}
                clip={c}
                // Reading order, 24ms apart: the grid settles as a list
                // rather than as one slab. Nine cards is the cap, so the
                // last one is 192ms behind the first and the whole thing
                // is done inside a third of a second.
                delayMs={i * 24}
                onOpen={() => onOpenClip(c)}
                onOpenSource={() => onOpenUrl(c.source_url)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HomeClipCard({
  clip,
  delayMs,
  onOpen,
  onOpenSource,
}: {
  clip: Artifact;
  /** Stagger within the grid, in milliseconds. */
  delayMs: number;
  onOpen: () => void;
  onOpenSource: () => void;
}) {
  const host = useMemo(() => {
    try {
      return new URL(clip.source_url).hostname.replace(/^www\./, "");
    } catch {
      return clip.source_url;
    }
  }, [clip.source_url]);
  const when = useMemo(() => relativeTime(clip.created_at), [clip.created_at]);

  return (
    <button
      type="button"
      onClick={(e) => (e.metaKey ? onOpenSource() : onOpen())}
      title={`${clip.title}\n${clip.source_url}\n⌘-click to open the source`}
      // Hover moves space, not brightness: the card lifts a step.
      //
      // The entrance is the same idea at rest. `backwards`, not `both`:
      // backwards holds the card at its start offset through the
      // stagger delay (without it, a late card paints in place and then
      // jumps back to animate), while a forwards fill would keep
      // overriding `transform` after it lands and kill the hover lift.
      className="flex min-h-[104px] flex-col justify-between rounded-xl bg-card p-4 text-left transition-transform focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-safe:animate-[np-rise_160ms_ease-out_backwards] motion-safe:hover:-translate-y-0.5"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span className="line-clamp-2 w-full text-sm leading-snug text-foreground">
        {clip.title || "Untitled"}
      </span>
      <span className="mt-3 flex w-full items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {clip.kind === "selection" ? "selection" : "page"} · {host}
        </span>
        <span className="shrink-0 tabular-nums">{when}</span>
      </span>
    </button>
  );
}

function relativeTime(epochSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epochSec * 1000).toLocaleDateString();
}
