import { cn } from "@/lib/utils";

/**
 * One 28px source-list row — the single visual atom of the sidebar.
 *
 * **The selection signal is the bar, not the fill.** Every palette keeps
 * `--muted` deliberately close to `--background`, so a ramp built from
 * fills alone separates its rungs by about 1.02:1 — hover and selection
 * become the same pixel. A 2px leading bar in `--select` measures
 * 4.7:1 or better against the ground in all twelve palette blocks, and
 * it is the accent doing exactly its job: marking the chosen thing.
 * This is also AppKit's own behaviour — focused selection takes the
 * accent, unfocused selection goes grey.
 *
 * The label is never tinted: `--select` as 13px text on a muted fill
 * drops under 4.5:1 in several palettes, and this is the app's
 * permanent navigation.
 *
 * The label is a real `<button>` so the row is reachable by keyboard and
 * announced as a control; the optional trailing control is a sibling
 * rather than a child, because a button inside a button is invalid.
 */
export function SidebarRow({
  label,
  icon,
  selected = false,
  focused = true,
  loading = false,
  dimIcon = true,
  trailing,
  onClick,
  onAuxClick,
  onContextMenu,
  title,
  dragProps,
}: {
  label: string;
  icon?: React.ReactNode;
  /** This row is what the content area is showing. */
  selected?: boolean;
  /** False when something else (a panel) owns the content area. */
  focused?: boolean;
  loading?: boolean;
  /** False for icons that carry their own colour (a site mark). */
  dimIcon?: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
  onAuxClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  /** Drag attributes/listeners, applied to the row's own control so a
      sortable row stays a single tab stop with one accessible name. */
  dragProps?: Record<string, unknown>;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 transition-colors",
        // Steps off the sidebar's own ground, which is `--muted`.
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
    >
      {selected && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1 bottom-1 w-0.5 rounded-full",
            focused ? "bg-select" : "bg-muted-foreground",
          )}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        title={title ?? label}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        {...dragProps}
      >
        {icon && (
          // The 70% is there to soften a lucide glyph drawn in
          // currentColor. A site mark carries its own colour, and parent
          // opacity composites the whole subtree, so it cannot opt out
          // from the inside — hence the prop.
          <span
            className={cn(
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center",
              dimIcon && "opacity-70",
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {loading && (
        <span
          className="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-select"
          role="status"
          aria-label={`${label} is loading`}
        />
      )}
      {trailing}
    </div>
  );
}
