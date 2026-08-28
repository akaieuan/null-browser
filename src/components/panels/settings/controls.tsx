import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { DEFAULT_START_PAGE, type StartPagePref } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * The controls every settings section is assembled from. They were
 * private to one 595-line file; the sections are separate files now, so
 * the shapes they share have to be too.
 */

/**
 * A section's own heading. The nav already names the section, so this
 * is not a repeat for its own sake — it is the anchor the content
 * column scrolls to and the place the section's one line of context
 * goes.
 */
export function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  // pt-1 puts the title on the same baseline as the first nav row, so the
  // rail and the section it opened line up across the gap.
  return (
    <div className="pb-1 pt-1">
      {/* h3: the panel header renders "Settings" as the h2. */}
      <h3 className="text-sm text-foreground">{title}</h3>
      {children && (
        <p className="mt-1.5 max-w-md text-xs font-light leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-6 py-2.5 text-sm">
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="min-w-0 text-muted-foreground">{children}</span>
    </div>
  );
}

/**
 * A row of mutually exclusive options — the Mode control's shape,
 * generalized. Selection is a fill, not the accent: these are quiet
 * chrome controls, and the accent stays reserved for chosen content.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex h-6 items-center rounded-sm px-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            value === o.id
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  ariaLabel,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  /** A descriptive accessible name, for when the visible `label` is a
      state word ("On"/"Off") rather than what the switch controls — the
      state itself is already announced by `aria-checked`. */
  ariaLabel?: string;
  checked: boolean;
  /** No answer from the backend yet, so the switch has no truth to show. */
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4.5 w-8 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-select" : "bg-accent",
        )}
      >
        <span
          className={cn(
            "h-3.5 w-3.5 rounded-full bg-background motion-safe:transition-transform",
            checked && "translate-x-3.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function ModeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        // Selection is the same quiet --muted fill the SegmentedControl
        // beside it uses, not the louder --accent — they are the same
        // control family and read that way now.
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/**
 * The Null mark. Flat — the glow it used to carry was a drop shadow
 * wearing an SVG filter, which the design language does not allow.
 *
 * It inherits its colour rather than taking `--select`. The accent means
 * "this is the chosen thing"; a 14px mark beside a version number is not
 * chosen, and painting it in the accent both says so falsely and makes
 * the mark change hue with every palette.
 */
export function ZeroMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <ellipse
        cx="48"
        cy="48"
        rx="20"
        ry="26"
        stroke="currentColor"
        strokeWidth="9"
      />
    </svg>
  );
}

type DropdownOption = { value: string; label: string; hint?: string };

export function Dropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // The keyboard-highlighted row while open, tracked by index so it can
  // move independently of the committed value and drive
  // aria-activedescendant. -1 only before the first open.
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  // Set when a close should hand focus back to the trigger (keyboard
  // close), consumed by the open/close effect below.
  const returnFocusRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const current = options[selectedIndex] ?? options[0];

  // Opening moves focus into the listbox (so arrow keys work at once) and
  // starts the highlight on the committed value.
  const openList = (index = selectedIndex < 0 ? 0 : selectedIndex) => {
    setActiveIndex(index);
    setOpen(true);
  };
  const closeList = (returnFocus: boolean) => {
    // Focus return happens in the effect below, after React commits the
    // unmount — a synchronous focus loses to the focused listbox being
    // removed (focus falls to <body>), and rAF pauses in a background
    // tab, so neither is reliable on its own.
    returnFocusRef.current = returnFocus;
    setOpen(false);
  };
  const commit = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    closeList(true);
  };

  useEffect(() => {
    if (open) {
      listRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList(
              e.key === "ArrowUp"
                ? options.length - 1
                : selectedIndex < 0
                  ? 0
                  : selectedIndex,
            );
          }
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border bg-input px-2.5 text-sm text-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          open ? "border-ring" : "border-border hover:border-ring/60",
        )}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-muted-foreground motion-safe:transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          id={listId}
          tabIndex={-1}
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          onKeyDown={(e) => {
            switch (e.key) {
              case "ArrowDown":
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex((i) => Math.min(options.length - 1, i + 1));
                break;
              case "ArrowUp":
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex((i) => Math.max(0, i - 1));
                break;
              case "Home":
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex(0);
                break;
              case "End":
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex(options.length - 1);
                break;
              case "Enter":
              case " ":
                e.preventDefault();
                e.stopPropagation();
                if (activeIndex >= 0) commit(activeIndex);
                break;
              case "Escape":
                // Own the key: the window has a global Escape ("put the
                // page back one layer") that would otherwise fire too and
                // yank focus out of Settings behind the closing list.
                e.preventDefault();
                e.stopPropagation();
                closeList(true);
                break;
              case "Tab":
                // Let focus leave naturally, but don't leave an
                // orphaned popup open behind it.
                closeList(false);
                break;
            }
          }}
          className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-background outline-none"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            const active = i === activeIndex;
            return (
              <div
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(i)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors",
                  selected || active
                    ? "bg-muted/60 text-foreground"
                    : "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-3 w-3 shrink-0 items-center justify-center",
                    selected ? "text-select" : "text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                    {o.hint}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CustomStartPageInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: StartPagePref) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitRef = useRef<() => void>(() => {});

  function commit(next: string) {
    const trimmed = next.trim();
    if (/^https?:\/\//i.test(trimmed)) onChange(trimmed);
    else if (!trimmed) onChange(DEFAULT_START_PAGE);
  }

  commitRef.current = () => commit(draft);

  // Switching Settings sections remounts the section subtree
  // (`key={section}`), and a click that changes sections does not blur
  // this input first — flush the draft on unmount so a typed URL is
  // not silently discarded.
  useEffect(() => () => commitRef.current(), []);

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="https://example.com"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="mt-1.5 h-7 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
    />
  );
}
