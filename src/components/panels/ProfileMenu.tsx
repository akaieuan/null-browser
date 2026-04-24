import { useEffect, useRef, useState } from "react";
import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";

import {
  DEFAULT_START_PAGE,
  isCustomStartPage,
  SEARCH_ENGINES,
  usePreferences,
  type StartPagePref,
} from "@/lib/preferences";
import { PALETTES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Profile dropdown. Small prefs card pinned to the top-right under the
 * profile button. The active tab is hidden while this is open (tabs are
 * Tauri child webviews that always render above React — the only way for
 * the dropdown not to be clipped is to hide them).
 */
export function ProfileMenu({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    name,
    setName,
    startPage,
    setStartPage,
    searchEngine,
    setSearchEngine,
  } = usePreferences();
  const { palette, setPalette, mode, toggleMode } = useTheme();
  const [nameDraft, setNameDraft] = useState(name);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  function commitName() {
    if (nameDraft !== name) setName(nameDraft);
  }

  return (
    <div className="absolute inset-0 z-40 flex justify-end p-2 text-foreground">
      <div
        ref={cardRef}
        className="h-fit w-80 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      >
          {/* Identity */}
          <div className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {name[0]?.toUpperCase() ?? "N"}
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Null"
                spellCheck={false}
                className="w-full truncate bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="truncate text-xs text-muted-foreground">
                Local · no sync, no account
              </div>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Appearance */}
          <div className="p-4">
            <Label>Appearance</Label>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
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
                        "h-4 w-4 rounded-full border transition",
                        selected
                          ? "border-foreground"
                          : "border-border opacity-60 hover:opacity-100",
                      )}
                      style={{ background: p.swatch }}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                onClick={toggleMode}
                aria-label={
                  mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
                }
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {mode === "dark" ? (
                  <Moon size={14} strokeWidth={1.5} />
                ) : (
                  <Sun size={14} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Start page */}
          <div className="p-4">
            <Label>Start page</Label>
            <div className="mt-1 flex flex-col gap-0.5">
              <Radio
                label="Null landing"
                selected={startPage === "null"}
                onSelect={() => setStartPage("null")}
              />
              <Radio
                label="DuckDuckGo"
                selected={startPage === "duckduckgo"}
                onSelect={() => setStartPage("duckduckgo")}
              />
              <CustomStartPage
                value={startPage}
                onChange={setStartPage}
              />
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Search engine */}
          <div className="p-4">
            <Label>Search</Label>
            <div className="mt-1 flex flex-col gap-0.5">
              {SEARCH_ENGINES.map((engine) => (
                <Radio
                  key={engine.id}
                  label={engine.label}
                  hint={engine.note}
                  selected={searchEngine === engine.id}
                  onSelect={() => setSearchEngine(engine.id)}
                />
              ))}
            </div>
          </div>

          <div className="h-px bg-border" />

        {/* Footer action */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <SettingsIcon size={12} strokeWidth={1.5} />
          Open full settings
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-subtle">
      {children}
    </div>
  );
}

function Radio({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded px-1 py-1.5 text-left hover:bg-muted/60"
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full border transition-colors",
          selected
            ? "border-foreground bg-foreground"
            : "border-border",
        )}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-sm text-foreground">{label}</span>
        {hint && (
          <span className="truncate text-[10px] text-subtle">{hint}</span>
        )}
      </span>
    </button>
  );
}

function CustomStartPage({
  value,
  onChange,
}: {
  value: StartPagePref;
  onChange: (next: StartPagePref) => void;
}) {
  const isCustom = isCustomStartPage(value);
  const [draft, setDraft] = useState(isCustom ? value : "");

  useEffect(() => {
    if (isCustom) setDraft(value);
  }, [isCustom, value]);

  function commit(next: string) {
    const trimmed = next.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      onChange(trimmed);
    } else if (!trimmed && isCustom) {
      onChange(DEFAULT_START_PAGE);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (/^https?:\/\//i.test(draft)) onChange(draft);
        }}
        className="flex w-full items-center gap-2.5 rounded px-1 py-1.5 text-left text-sm text-foreground hover:bg-muted/60"
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full border transition-colors",
            isCustom ? "border-foreground bg-foreground" : "border-border",
          )}
        />
        <span>Custom URL</span>
      </button>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder="https://example.com"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="ml-[18px] h-7 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
      />
    </div>
  );
}
