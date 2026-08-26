import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Moon, Sun, Trash2 } from "lucide-react";

import { Panel } from "@/components/panels/Panel";
import { Kicker } from "@/components/ui/atoms";
import { ipc } from "@/lib/ipc";
import {
  CORNERS,
  DEFAULT_START_PAGE,
  GLASS_OPTIONS,
  isCustomStartPage,
  SEARCH_ENGINES,
  usePreferences,
  type CornersPref,
  type GlassPref,
  type StartPagePref,
} from "@/lib/preferences";
import { PALETTES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The one preferences surface. Everything that used to live in the
 * profile dropdown is a section here instead — the dropdown reserved a
 * strip of the window, which reflowed the live page just to show a
 * settings card.
 */
export function SettingsPanel({
  onClose,
  onOpenUrl,
}: {
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <Panel title="Settings" onClose={onClose} measure="form" align="left">
      <div className="space-y-10 pt-2">
        <AppearanceSection />
        <BrowsingSection />
        <PrivacySection />
        <NotesSection />
        <AboutSection onOpenUrl={onOpenUrl} />
      </div>
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      {/* h3: Panel renders the panel's own title as the h2. */}
      <Kicker as="h3">{title}</Kicker>
      <div className="mt-1 flex flex-col">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-6 py-2.5 text-sm">
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="min-w-0 text-muted-foreground">{children}</span>
    </div>
  );
}

function AppearanceSection() {
  const { palette, mode, setPalette, setMode } = useTheme();
  const { corners, setCorners, glass, setGlass, hoverReveal, setHoverReveal } =
    usePreferences();
  const active = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
  return (
    <Section title="Appearance">
      <Row label="Theme">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{active.label}</span>
          {/* The selected swatch is haloed, not tinted. Marking it with
              --select would make it invisible on whichever swatch *is*
              --select — which, for the default palette, is the one you
              are most likely to be looking at. A ring separated from the
              swatch by a gap in the background colour reads on any hue. */}
          <div className="flex items-center gap-2.5">
            {PALETTES.map((p) => {
              const selected = palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={p.label}
                  aria-pressed={selected}
                  title={p.label}
                  onClick={() => setPalette(p.id)}
                  className={cn(
                    "h-4 w-4 rounded-full border border-border transition",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring",
                    selected
                      ? "ring-1 ring-offset-2 ring-offset-background ring-foreground"
                      : "opacity-70 hover:opacity-100",
                  )}
                  style={{ background: p.swatch }}
                />
              );
            })}
          </div>
        </div>
      </Row>
      <Row label="Mode">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <ModeButton
            label="Light"
            active={mode === "light"}
            onClick={() => setMode("light")}
          >
            <Sun size={14} strokeWidth={1.5} />
          </ModeButton>
          <ModeButton
            label="Dark"
            active={mode === "dark"}
            onClick={() => setMode("dark")}
          >
            <Moon size={14} strokeWidth={1.5} />
          </ModeButton>
        </div>
      </Row>
      <Row label="Corners">
        <SegmentedControl
          options={CORNERS.map((c) => ({ id: c.id, label: c.label }))}
          value={corners}
          onChange={(id) => setCorners(id as CornersPref)}
        />
      </Row>
      <Row label="Glass">
        {/* Only means anything inside the app — a plain browser has no
            vibrancy to show through, and the control says so. */}
        <SegmentedControl
          options={GLASS_OPTIONS.map((g) => ({ id: g.id, label: g.label }))}
          value={glass}
          onChange={(id) => setGlass(id as GlassPref)}
        />
      </Row>
      <Row label="Sidebar">
        <Toggle
          label="Open on hover at the left edge"
          checked={hoverReveal}
          onChange={setHoverReveal}
        />
      </Row>
    </Section>
  );
}

/**
 * A row of mutually exclusive options — the Mode control's shape,
 * generalized. Selection is a fill, not the accent: these are quiet
 * chrome controls, and the accent stays reserved for chosen content.
 */
function SegmentedControl({
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function ModeButton({
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

/** Start page, search engine, and the local profile name. */
function BrowsingSection() {
  const {
    name,
    setName,
    startPage,
    setStartPage,
    searchEngine,
    setSearchEngine,
  } = usePreferences();
  const [nameDraft, setNameDraft] = useState(name);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const startPageKey: "null" | "duckduckgo" | "custom" =
    startPage === "null" || startPage === "duckduckgo" ? startPage : "custom";
  const customUrl = isCustomStartPage(startPage) ? startPage : "";

  function handleStartPageChange(next: string) {
    if (next === "null" || next === "duckduckgo") {
      setStartPage(next);
    } else if (next === "custom" && !isCustomStartPage(startPage)) {
      setStartPage("");
    }
  }

  return (
    <Section title="Browsing">
      <Row label="Name">
        {/* Matches the dropdowns beneath it: same height, same width,
            same left-aligned value. Right-aligning text inside a field
            you type into fights the caret for no gain — the row's right
            rail is already held by the box's own edge. */}
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft !== name) setName(nameDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Null"
          spellCheck={false}
          className="h-8 w-56 rounded-md border border-border bg-input px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
      </Row>
      <Row label="Start page">
        <div className="w-56">
          <Dropdown
            value={startPageKey}
            options={[
              { value: "null", label: "Null home" },
              { value: "duckduckgo", label: "DuckDuckGo" },
              { value: "custom", label: "Custom URL" },
            ]}
            onChange={handleStartPageChange}
          />
          {startPageKey === "custom" && (
            <CustomStartPageInput value={customUrl} onChange={setStartPage} />
          )}
        </div>
      </Row>
      <Row label="Search">
        <div className="w-56">
          <Dropdown
            value={searchEngine}
            options={SEARCH_ENGINES.map((e) => ({
              value: e.id,
              label: e.label,
              hint: e.note,
            }))}
            onChange={(v) => setSearchEngine(v as typeof searchEngine)}
          />
        </div>
      </Row>
    </Section>
  );
}

function PrivacySection() {
  const [count, setCount] = useState<number | null>(null);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "done">(
    "idle",
  );

  const refresh = () => {
    ipc
      .listHistory(10000)
      .then((rows) => setCount(rows.length))
      .catch(() => setCount(null));
  };

  useEffect(refresh, []);

  async function clearBrowsingData() {
    if (clearState !== "confirm") {
      setClearState("confirm");
      window.setTimeout(() => {
        setClearState((s) => (s === "confirm" ? "idle" : s));
      }, 3000);
      return;
    }
    try {
      await Promise.all([ipc.clearHistory(), ipc.clearTabStorage()]);
    } catch {
      // best-effort
    }
    setClearState("done");
    refresh();
    window.setTimeout(() => setClearState("idle"), 1500);
  }

  return (
    <Section title="Privacy">
      <Row label="Telemetry">off</Row>
      <Row label="Cloud connections">none</Row>
      <Row label="All data">local</Row>
      <Row label="History">
        {count === null ? "—" : `${count} ${count === 1 ? "entry" : "entries"}`}
      </Row>
      <Row label="Clear browsing data">
        <button
          type="button"
          onClick={clearBrowsingData}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
            clearState === "confirm"
              ? "border-danger text-danger"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Trash2 size={12} strokeWidth={1.5} />
          {clearState === "confirm"
            ? "Click again to wipe history + logins"
            : clearState === "done"
              ? "Cleared"
              : "Clear history & logins"}
        </button>
      </Row>
    </Section>
  );
}

function NotesSection() {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    ipc.getNotesDir().then(setDir).catch(() => {});
  }, []);
  return (
    <Section title="Notes">
      <Row label="Notes folder">
        <span
          className="block truncate font-mono text-[11px]"
          title={dir ?? undefined}
        >
          {dir ?? "—"}
        </span>
      </Row>
      <Row label="Format">markdown · YAML front matter</Row>
      <Row label="Inference">never — Null captures, nothing more</Row>
    </Section>
  );
}

function AboutSection({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <Section title="About">
      <Row label="Null">
        <span className="flex items-center gap-2">
          <ZeroMark />
          <span>{version ? `v${version}` : "—"}</span>
        </span>
      </Row>
      <Row label="Source">
        <button
          type="button"
          onClick={() => onOpenUrl("https://github.com/akaieuan/null-browser")}
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          github.com/akaieuan/null-browser
        </button>
      </Row>
    </Section>
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
function ZeroMark() {
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

function Dropdown({
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

function CustomStartPageInput({
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
