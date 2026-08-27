import {
  Check,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  FileText,
  Pencil,
  Plus,
  TextSelect,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { EmptyState } from "@/components/panels/EmptyState";
import { Kicker, ListRow } from "@/components/ui/atoms";
import { Button } from "@/components/ui/button";
import { ipc, type Artifact } from "@/lib/ipc";
import { PANEL_HEADER_HEIGHT } from "@/lib/layout";
import { cn } from "@/lib/utils";

type ActiveTab = { id: string; url: string; title: string } | null;

/**
 * Notes: a card that drops in on the right, anchored under the
 * toolbar's Notes button — the page yields the width rather than being
 * covered, because nothing can paint over a native webview. One
 * control expands it to half the window (a split with the page) and
 * back. Esc or ⌘/ closes it. It lives here, not in the sidebar: it is
 * something you summon next to a page, not a place you go.
 *
 * The product point is the copy button. Every note is markdown shaped
 * for pasting into a chat — that is the whole workflow Null supports
 * instead of embedding a model (invariant 3), so copy sits visible on
 * every row rather than behind a hover.
 */
export function NotesPanel({
  mode,
  onSetMode,
  onClose,
  activeTab,
  onOpenUrl,
  initialClip = null,
}: {
  mode: "panel" | "wide";
  onSetMode: (mode: "panel" | "wide") => void;
  onClose: () => void;
  activeTab: ActiveTab;
  onOpenUrl: (url: string) => void;
  /** Open straight to this note — used when Home hands one over. */
  initialClip?: Artifact | null;
}) {
  const [clips, setClips] = useState<Artifact[]>([]);
  const [open, setOpenState] = useState<Artifact | null>(initialClip);
  /** Whether the open note shows the editor or the rendered view. A
      typed note opens straight into typing; a capture opens rendered. */
  const [editing, setEditing] = useState(initialClip?.kind === "note");
  const [busy, setBusy] = useState<null | "page" | "selection">(null);
  const [error, setError] = useState<string | null>(null);

  const setOpen = useCallback((clip: Artifact | null) => {
    setOpenState(clip);
    setEditing(clip?.kind === "note");
  }, []);

  const refresh = useCallback(() => {
    ipc.listArtifacts().then(setClips).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (initialClip) setOpen(initialClip);
    // A menu capture (⇧⌘C) or ⌘N hands the fresh note over while the
    // card is already open — the list must show it too.
    refresh();
  }, [initialClip, refresh, setOpen]);

  const newNote = useCallback(async () => {
    try {
      const clip = await ipc.createNote("", activeTab?.url ?? "");
      if (clip) {
        setOpen(clip);
        refresh();
      }
    } catch (e) {
      setError(cleanError(e));
    }
  }, [activeTab, refresh, setOpen]);

  const capture = async (kind: "page" | "selection") => {
    if (!activeTab || busy) return;
    setBusy(kind);
    setError(null);
    try {
      const id =
        kind === "page"
          ? await ipc.saveCurrentTab(activeTab.id)
          : await ipc.clipSelection(activeTab.id);
      const clip = await ipc.getArtifact(id);
      refresh();
      setOpen(clip);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    try {
      await ipc.deleteArtifact(id);
      setClips((xs) => xs.filter((c) => c.id !== id));
      setOpenState((cur) => (cur?.id === id ? null : cur));
    } catch {
      /* the row is gone from the list either way on next refresh */
    }
  };

  const wide = mode === "wide";

  return (
    <aside
      aria-label="Notes"
      className="flex h-full w-full animate-[np-drop_160ms_ease-out] flex-col overflow-hidden rounded-xl bg-card text-foreground"
    >
      <header
        className="flex shrink-0 items-center justify-between pl-4 pr-2.5"
        style={{ height: PANEL_HEADER_HEIGHT }}
      >
        <Kicker>Notes</Kicker>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="New note"
            title="New note · ⌘N"
            onClick={() => void newNote()}
            className="h-7 w-7"
          >
            <Plus size={14} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={wide ? "Narrow notes" : "Expand notes"}
            title={wide ? "Back to panel" : "Split with the page"}
            onClick={() => onSetMode(wide ? "panel" : "wide")}
            className="h-7 w-7"
          >
            {wide ? (
              <ChevronsRight size={14} strokeWidth={1.5} />
            ) : (
              <ChevronsLeft size={14} strokeWidth={1.5} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close notes"
            title="Close · ⌘/"
            onClick={onClose}
            className="h-7 w-7"
          >
            <X size={14} strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 px-4 pb-4",
          open && editing ? "flex flex-col overflow-hidden" : "overflow-y-auto",
        )}
      >
        {open && editing ? (
          <NoteEditor
            key={open.id}
            clip={open}
            onSaved={(a) => {
              setOpenState(a);
              setClips((prev) => prev.map((c) => (c.id === a.id ? a : c)));
            }}
            onPreview={() => setEditing(false)}
            onBack={() => setOpen(null)}
            onDelete={() => remove(open.id)}
            onOpenUrl={onOpenUrl}
          />
        ) : open ? (
          <NoteViewer
            clip={open}
            onEdit={() => setEditing(true)}
            onBack={() => setOpen(null)}
            onDelete={() => remove(open.id)}
            onOpenUrl={onOpenUrl}
          />
        ) : clips.length === 0 ? (
          <EmptyState title="Nothing here yet.">
            ⌘N starts a note — it autosaves as markdown you can paste into
            any chat. Saving a page works too, from the buttons below.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-0.5">
            {clips.map((c) => (
              <NoteRow
                key={c.id}
                clip={c}
                onOpen={() => {
                  // Through get_artifact, not the list row's copy:
                  // opening is when external edits to the file mirror
                  // get adopted (notes::sync_from_disk).
                  ipc
                    .getArtifact(c.id)
                    .then((fresh) => {
                      setOpen(fresh ?? c);
                      refresh();
                    })
                    .catch(() => setOpen(c));
                }}
                onDelete={() => remove(c.id)}
              />
            ))}
          </div>
        )}
      </div>

      {!open && (
        <footer className="shrink-0 px-4 pb-3">
          <div className="flex items-center gap-2">
            <CaptureButton
              label={busy === "page" ? "Saving…" : "Save page"}
              icon={<FileText size={13} strokeWidth={1.75} />}
              disabled={!activeTab || busy !== null}
              onClick={() => void capture("page")}
            />
            <CaptureButton
              label={busy === "selection" ? "Saving…" : "Save selection"}
              icon={<TextSelect size={13} strokeWidth={1.75} />}
              disabled={!activeTab || busy !== null}
              onClick={() => void capture("selection")}
            />
          </div>
          <p
            className={cn(
              "mt-2 truncate text-[11px] leading-relaxed",
              error ? "text-danger" : "text-subtle",
            )}
            title={error ?? undefined}
          >
            {error ??
              (activeTab
                ? "Markdown on disk — copy any note into any chat."
                : "Open a page to save it.")}
          </p>
        </footer>
      )}
    </aside>
  );
}

function CaptureButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-lg bg-muted px-3 text-[13px] text-foreground transition-colors",
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function NoteRow({
  clip,
  onOpen,
  onDelete,
}: {
  clip: Artifact;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const host = useHost(clip.source_url);
  const when = useMemo(() => relativeTime(clip.created_at), [clip.created_at]);
  return (
    <ListRow>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="w-full truncate text-sm text-foreground">
          {clip.title || "Untitled"}
        </span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {clip.kind === "selection" ? "selection" : "page"} · {host} · {when}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Copy is always visible — it is the point of the surface.
            Delete stays behind hover (and focus-within, so a keyboard
            user never lands on an invisible control). */}
        <CopyButton markdown={clipMarkdown(clip)} compact />
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete note"
          className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      </div>
    </ListRow>
  );
}

/**
 * The typing surface — the actual point of Notes. Title and markdown
 * body, autosaved (debounced) to SQLite and the `.md` mirror, so the
 * flow is: watch the thing on the left, type here, copy the markdown
 * into whatever chat or app wants it. The eye toggles the rendered
 * view; captures share the same editor through the viewer's pencil.
 */
function NoteEditor({
  clip,
  onSaved,
  onPreview,
  onBack,
  onDelete,
  onOpenUrl,
}: {
  clip: Artifact;
  onSaved: (a: Artifact) => void;
  onPreview: () => void;
  onBack: () => void;
  onDelete: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [title, setTitle] = useState(clip.title);
  const [body, setBody] = useState(clip.markdown);
  const [dirty, setDirty] = useState(false);
  const latestRef = useRef({ title: clip.title, body: clip.markdown });
  const timerRef = useRef<number | null>(null);

  const save = useCallback(() => {
    const { title: t, body: b } = latestRef.current;
    ipc
      .updateNote(clip.id, t.trim() || "Untitled", b)
      .then((a) => {
        if (a) onSaved(a);
        setDirty(false);
      })
      .catch(() => {});
  }, [clip.id, onSaved]);

  const queue = useCallback(
    (t: string, b: string) => {
      latestRef.current = { title: t, body: b };
      setDirty(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(save, 600);
    },
    [save],
  );

  // Flush on unmount — closing the card mid-sentence must not eat the
  // sentence.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        save();
      }
    };
  }, [save]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to notes"
          onClick={onBack}
          className="-ml-1.5 h-7 w-7 shrink-0"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </Button>
        {clip.source_url ? (
          <button
            type="button"
            onClick={() => onOpenUrl(clip.source_url)}
            title={clip.source_url}
            className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            {clip.source_url}
          </button>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Saved-state: space, not blinking. The dot appears only
              while unsaved changes exist. */}
          {dirty && (
            <span
              aria-label="Unsaved changes"
              className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-subtle"
            />
          )}
          <CopyButton
            markdown={clipMarkdown({ ...clip, title, markdown: body })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Preview note"
            title="Preview"
            onClick={onPreview}
            className="h-7 w-7"
          >
            <Eye size={13} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete note"
            onClick={onDelete}
            className="h-7 w-7"
          >
            <Trash2 size={13} strokeWidth={1.5} />
          </Button>
        </div>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          queue(e.target.value, body);
        }}
        placeholder="Untitled"
        autoFocus={!clip.title}
        spellCheck={false}
        className="mt-4 w-full shrink-0 bg-transparent text-[17px] font-medium text-foreground placeholder:text-subtle focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          queue(title, e.target.value);
        }}
        placeholder="Type markdown. It saves itself."
        autoFocus={!!clip.title}
        spellCheck={false}
        className="mt-3 min-h-0 w-full flex-1 resize-none bg-transparent text-[15px] leading-[1.6] text-foreground placeholder:text-subtle focus:outline-none"
      />
    </div>
  );
}

function NoteViewer({
  clip,
  onEdit,
  onBack,
  onDelete,
  onOpenUrl,
}: {
  clip: Artifact;
  onEdit: () => void;
  onBack: () => void;
  onDelete: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const components = useMemo(
    () => markdownComponentsFor(onOpenUrl),
    [onOpenUrl],
  );
  const body = useMemo(
    () => withoutLeadingTitle(clip.markdown, clip.title),
    [clip.markdown, clip.title],
  );
  // The title renders exactly once, as the article's display heading.
  // If the captured body opens with its own h1 (a *different* one —
  // an identical one was just stripped), that heading leads and ours
  // stays out of the way; otherwise the note's title takes the slot.
  // The old header said the identity three times before the first
  // content line: header title, URL host, then the body's h1.
  const bodyLeadsWithH1 = /^#\s/.test(body.trimStart());
  return (
    <div>
      {/* One-line header: provenance and actions only — the title
          renders once, in the article. */}
      <div className="relative flex h-7 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to notes"
          onClick={onBack}
          className="-ml-1.5 h-7 w-7 shrink-0"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </Button>
        <button
          type="button"
          onClick={() => onOpenUrl(clip.source_url)}
          title={clip.source_url}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          {clip.source_url}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyButton markdown={clipMarkdown(clip)} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit note"
            title="Edit"
            onClick={onEdit}
            className="h-7 w-7"
          >
            <Pencil size={13} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete note"
            onClick={onDelete}
            className="h-7 w-7"
          >
            <Trash2 size={13} strokeWidth={1.5} />
          </Button>
        </div>
      </div>
      {/* The reading column. 32rem, not the panel's full measure — the
          list wants the width, prose wants ~70 characters (65ch of SF
          actually sets ~86 characters; ch is the width of "0"). Body
          at regular weight: SF Light below ~20px goes wiry, light is
          reserved for the display sizes where it reads as a choice. */}
      <article className="mt-8 max-w-[32rem] text-[15px] leading-[1.6] text-foreground">
        {!bodyLeadsWithH1 && (
          <h1 className="mb-4 text-[22px] font-light tracking-[-0.01em]">
            {clip.title || "Untitled"}
          </h1>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {body}
        </ReactMarkdown>
      </article>
      {clip.file_path && (
        <p
          className="mt-10 truncate font-mono text-[10px] text-subtle"
          title={clip.file_path}
        >
          {clip.file_path}
        </p>
      )}
    </div>
  );
}

/// Copy the note as markdown — title, source, body. The whole point:
/// get it onto the clipboard and into whatever you use.
function CopyButton({
  markdown,
  compact = false,
}: {
  markdown: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      /* clipboard denied — nothing useful to say */
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      aria-label="Copy as Markdown"
      title="Copy as Markdown"
      className={cn(
        "rounded-sm p-1 transition-colors",
        copied
          ? "text-select"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        compact ? "" : "h-7 w-7 shrink-0",
      )}
    >
      {copied ? (
        <Check size={13} strokeWidth={2} />
      ) : (
        <Copy size={13} strokeWidth={1.5} />
      )}
    </button>
  );
}

/**
 * Drop the note's own `# Title` heading when the viewer is already
 * showing that title in its header. Readability puts the article title
 * at the top of the extracted markdown, so without this the title
 * appears twice, an inch apart.
 *
 * Only the rendered body is trimmed. What gets copied — and what is on
 * disk — keeps the heading, because a markdown file that opens with its
 * own title is what every other tool expects.
 */
function withoutLeadingTitle(markdown: string, title: string): string {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith("#")) return markdown;
  const end = trimmed.indexOf("\n");
  const first = (end === -1 ? trimmed : trimmed.slice(0, end)).trim();
  const heading = first.replace(/^#{1,6}\s+/, "");
  if (heading !== first && heading === title.trim()) {
    return end === -1 ? "" : trimmed.slice(end + 1).trimStart();
  }
  return markdown;
}

/**
 * What lands on the clipboard: one `# Title`, the source, then the body.
 *
 * The body is stripped of its own leading title first. Readability puts
 * the article title at the top of what it extracts, so pasting the raw
 * markdown under a heading we just wrote produced the title twice, an
 * inch apart — in the clipboard, which is the whole point.
 */
function clipMarkdown(clip: Artifact): string {
  const title = clip.title || "Untitled";
  const body = withoutLeadingTitle(clip.markdown, clip.title);
  return `# ${title}\n\nSource: ${clip.source_url}\n\n${body}\n`;
}

function useHost(url: string): string {
  return useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }, [url]);
}

function relativeTime(epochSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epochSec * 1000).toLocaleDateString();
}

function cleanError(e: unknown): string {
  const s = String(e);
  if (s.includes("nothing selected")) {
    return "Nothing selected — highlight something on the page first.";
  }
  return s.replace(/^\[extraction failed: /, "").replace(/\]$/, "");
}

/// Markdown component map for note rendering. Links open in a Null tab
/// via `onOpenUrl` instead of navigating the privileged shell webview —
/// react-markdown's default urlTransform has already stripped
/// javascript:/data: schemes by the time the href lands here.
function markdownComponentsFor(onOpenUrl: (url: string) => void) {
  return {
    ...markdownComponents,
    a: ({ href, ...props }: React.HTMLProps<HTMLAnchorElement>) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) onOpenUrl(href);
        }}
        className="text-foreground underline underline-offset-2 hover:no-underline"
        {...props}
      />
    ),
  };
}

/**
 * The type system of the reading column. The scale is deliberately
 * short — 22/17/15 over a 15px body — because a captured article
 * arrives with whatever heading levels its site used, and a dramatic
 * scale amplifies someone else's structure. Emphasis inside a `light`
 * body is `medium`, never `bold`: bold next to 300-weight text reads
 * as shouting.
 *
 * No rules anywhere. The thematic break an author wrote as `---` still
 * means "breathe here", so it renders as space with three quiet dots —
 * a browser-default <hr> was drawing the heaviest line in the entire
 * app through the middle of its calmest surface.
 */
const markdownComponents = {
  h1: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h1
      className="mb-4 mt-10 text-[22px] font-light tracking-[-0.01em] text-foreground first:mt-0"
      {...props}
    />
  ),
  h2: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h2
      className="mb-3 mt-9 text-[17px] font-medium text-foreground first:mt-0"
      {...props}
    />
  ),
  h3: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h3
      className="mb-2 mt-7 text-[15px] font-semibold text-foreground first:mt-0"
      {...props}
    />
  ),
  p: (props: React.HTMLProps<HTMLParagraphElement>) => (
    <p className="mb-4" {...props} />
  ),
  // One weight step above the regular body. Default browser bold is
  // two steps up and reads as loud as an h2 at a squint.
  strong: (props: React.HTMLProps<HTMLElement>) => (
    <strong className="font-semibold" {...props} />
  ),
  ul: (props: React.HTMLProps<HTMLUListElement>) => (
    <ul
      className="mb-4 ml-[1.2em] list-disc space-y-1 marker:text-subtle"
      {...props}
    />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol
      className="mb-4 ml-[1.2em] list-decimal space-y-1 marker:text-subtle"
      {...props}
    />
  ),
  li: (props: React.HTMLProps<HTMLLIElement>) => (
    <li className="pl-1" {...props} />
  ),
  blockquote: (props: React.HTMLProps<HTMLQuoteElement>) => (
    // A tone step, not a left rule — the same move the chrome makes.
    // Full-token bg and full-color text: the card alone carries the
    // "quoted" semantics. Dimming the text on a near-invisible fill
    // made quotes read as disabled paragraphs.
    <blockquote
      className="my-5 rounded-xl bg-muted px-4 py-3 [&>*:last-child]:mb-0"
      {...props}
    />
  ),
  hr: () => (
    <div role="separator" className="my-9 flex items-center justify-center gap-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[3px] w-[3px] rounded-full bg-subtle" />
      ))}
    </div>
  ),
  // react-markdown ≥9 passes no `inline` flag, so `code` styles the
  // inline pill and `pre` un-pills the code element it wraps. The old
  // `inline` branch silently became `display: block` for every inline
  // code span the day react-markdown was upgraded.
  code: (props: React.HTMLProps<HTMLElement>) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
      {...props}
    />
  ),
  pre: (props: React.HTMLProps<HTMLPreElement>) => (
    <pre
      className="mb-4 overflow-x-auto rounded-xl bg-muted p-3.5 text-xs leading-relaxed [&>code]:block [&>code]:bg-transparent [&>code]:p-0"
      {...props}
    />
  ),
  // GFM tables: content furniture at the quietest tone that still
  // works as a grid. `--muted` is within 1.6:1 of the ground, so these
  // read as structure, not chrome.
  table: (props: React.HTMLProps<HTMLTableElement>) => (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full text-left text-[13px]" {...props} />
    </div>
  ),
  th: (props: React.HTMLProps<HTMLTableCellElement>) => (
    <th className="pb-2 pr-4 font-medium text-muted-foreground" {...props} />
  ),
  td: (props: React.HTMLProps<HTMLTableCellElement>) => (
    <td className="border-t border-muted py-1.5 pr-4 align-top" {...props} />
  ),
  img: (props: React.HTMLProps<HTMLImageElement>) => (
    // Remote images are CSP-blocked by design (img-src 'self' data:) —
    // alt text stands in, so keep the element from painting a broken
    // frame at arbitrary size.
    // eslint-disable-next-line jsx-a11y/alt-text
    <img className="my-4 h-auto max-w-full rounded-lg" {...props} />
  ),
};
