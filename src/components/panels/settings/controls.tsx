import { useEffect, useRef, useState, type ReactNode } from "react";
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
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
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
            "h-3.5 w-3.5 rounded-full bg-background transition-transform",
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
        active
          ? "bg-accent text-foreground"
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-md border bg-input px-2.5 text-sm text-foreground transition-colors",
          open ? "border-ring" : "border-border hover:border-ring/60",
        )}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-background">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors",
                  selected
                    ? "bg-muted/60 text-foreground"
                    : "text-foreground hover:bg-muted/60",
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
              </button>
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

  function commit(next: string) {
    const trimmed = next.trim();
    if (/^https?:\/\//i.test(trimmed)) onChange(trimmed);
    else if (!trimmed) onChange(DEFAULT_START_PAGE);
  }

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
