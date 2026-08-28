import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/panels/EmptyState";
import { TrackerGraph } from "@/components/TrackerGraph";
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
 * One number does belong here: the trackers-seen calendar. The old
 * objection to a counter was that a figure ticking upward as you watch
 * is a dashboard element, and that the in-memory event ring could not
 * honestly say "today". A retrospective calendar answers both — it is a
 * record, not a live tally, and it reads from a persisted per-day table
 * (migration 010), so every cell is a real day. And it is honest about
 * itself: it counts trackers the browser *saw*, which blocking makes
 * fall, not blocks (which are uncountable). It hides itself until there
 * is a first sighting, so a fresh install still opens on the notes.
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

  const removeClip = (id: number) => {
    // Optimistic: the row leaves at once; the backend keeps an
    // externally-edited file (notes::delete_note's guard).
    setClips((xs) => xs.filter((c) => c.id !== id));
    ipc.deleteArtifact(id).catch(() => {});
  };

  return (
    // No Card wrapper: the fresh tab is the one surface that sits
    // directly on the glass. Each note is its own small card, so the
    // desktop shows between them — the wallpaper is the ground, the
    // notes are objects on it.
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-20 pt-16">
        {/* Self-hides until the first tracker sighting, and carries its
            own trailing gap so a fresh install opens straight on Notes
            with no empty band above them. */}
        <TrackerGraph />
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
                onDelete={() => removeClip(c.id)}
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
  onDelete,
}: {
  clip: Artifact;
  /** Stagger within the grid, in milliseconds. */
  delayMs: number;
  onOpen: () => void;
  onOpenSource: () => void;
  onDelete: () => void;
}) {
  const host = useMemo(() => {
    try {
      return new URL(clip.source_url).hostname.replace(/^www\./, "");
    } catch {
      return clip.source_url;
    }
  }, [clip.source_url]);
  const when = useMemo(() => relativeTime(clip.created_at), [clip.created_at]);

  // A wrapper holds two siblings — the open button and the delete
  // button — rather than nesting one inside the other (invalid, and it
  // would swallow the delete click). The wrapper carries the entrance
  // and the hover-lift so the trash rides along with the card. See the
  // NoteRow in NotesPanel for the same shape in the list.
  return (
    <div
      className="group relative transition-transform motion-safe:animate-[np-rise_160ms_ease-out_backwards] motion-safe:hover:-translate-y-0.5"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <button
        type="button"
        onClick={(e) => (e.metaKey ? onOpenSource() : onOpen())}
        title={`${clip.title}\n${clip.source_url}\n⌘-click to open the source`}
        className="flex min-h-[104px] w-full flex-col justify-between rounded-xl bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="line-clamp-2 w-full pr-6 text-sm leading-snug text-foreground">
          {clip.title || "Untitled"}
        </span>
        <span className="mt-3 flex w-full items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {clip.kind === "selection" ? "selection" : "page"} · {host}
          </span>
          <span className="shrink-0 tabular-nums">{when}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>
    </div>
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
