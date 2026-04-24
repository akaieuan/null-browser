import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Trash2,
} from "lucide-react";

import {
  DEFAULT_START_PAGE,
  isCustomStartPage,
  SEARCH_ENGINES,
  usePreferences,
  type StartPagePref,
} from "@/lib/preferences";
import { ipc, type ProviderStatus } from "@/lib/ipc";
import { PALETTES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Profile dropdown. Small prefs card pinned to the top-right under the
 * profile button. The active tab's webview is shrunk (not hidden) while
 * this is open so a strip on the right stays free for the card.
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
  const [clearState, setClearState] = useState<"idle" | "confirm" | "done">(
    "idle",
  );
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(
    null,
  );

  const refreshProviders = useCallback(() => {
    ipc.aiProviderStatus().then(setProviderStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-profile-trigger]")) return;
      if (cardRef.current && !cardRef.current.contains(target)) {
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

  const startPageKey: "null" | "duckduckgo" | "custom" =
    startPage === "null" || startPage === "duckduckgo"
      ? startPage
      : "custom";
  const customUrl = isCustomStartPage(startPage) ? startPage : "";

  const startPageOptions = [
    { value: "null", label: "Null landing" },
    { value: "duckduckgo", label: "DuckDuckGo" },
    { value: "custom", label: "Custom URL" },
  ];

  function handleStartPageChange(next: string) {
    if (next === "null" || next === "duckduckgo") {
      setStartPage(next);
    } else if (next === "custom" && !isCustomStartPage(startPage)) {
      setStartPage("");
    }
  }

  const searchOptions = SEARCH_ENGINES.map((engine) => ({
    value: engine.id,
    label: engine.label,
    hint: engine.note,
  }));

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
    window.setTimeout(() => setClearState("idle"), 1500);
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
                if (e.key === "Enter") e.currentTarget.blur();
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

        {/* Appearance */}
        <div className="px-4 pb-3">
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

        {/* Start page */}
        <div className="px-4 pb-3">
          <Label>Start page</Label>
          <Dropdown
            value={startPageKey}
            options={startPageOptions}
            onChange={handleStartPageChange}
          />
          {startPageKey === "custom" && (
            <CustomStartPageInput
              value={customUrl}
              onChange={setStartPage}
            />
          )}
        </div>

        {/* Search engine */}
        <div className="px-4 pb-3">
          <Label>Search</Label>
          <Dropdown
            value={searchEngine}
            options={searchOptions}
            onChange={(v) => setSearchEngine(v as typeof searchEngine)}
          />
        </div>

        {/* AI providers */}
        <div className="px-4 pb-3">
          <Label>AI providers</Label>
          <div className="mt-1.5 flex flex-col gap-0.5">
            <ProviderRow
              label="Anthropic"
              hint="Claude · bring your own key"
              placeholder="sk-ant-…"
              configured={providerStatus?.anthropic ?? false}
              onSave={async (key) => {
                await ipc.aiSetKey("anthropic", key);
                refreshProviders();
              }}
            />
            <ProviderRow
              label="OpenAI"
              hint="GPT · bring your own key"
              placeholder="sk-…"
              configured={providerStatus?.openai ?? false}
              onSave={async (key) => {
                await ipc.aiSetKey("openai", key);
                refreshProviders();
              }}
            />
          </div>
          <div className="mt-2 px-1 text-[10px] leading-relaxed text-subtle">
            Keys live in your OS keychain — never synced, never written to
            disk, never sent anywhere except to the provider you use them
            against. Every call is logged in the Network Inspector.
          </div>
        </div>

        {/* Clear browsing data */}
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={clearBrowsingData}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs transition-colors",
              clearState === "confirm"
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Trash2 size={12} strokeWidth={1.5} />
            {clearState === "confirm"
              ? "Click again to wipe history + logins"
              : clearState === "done"
                ? "Cleared"
                : "Clear history & logins"}
          </button>
        </div>

        {/* Footer */}
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

function ProviderRow({
  label,
  hint,
  placeholder,
  configured,
  onSave,
}: {
  label: string;
  hint: string;
  placeholder: string;
  configured: boolean;
  onSave: (key: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
      setDraft("");
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
        className="flex items-center gap-1"
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              setDraft("");
            }
          }}
          autoFocus
          disabled={saving}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-7 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/60"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          configured ? "bg-foreground" : "bg-border",
        )}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-sm text-foreground">{label}</span>
        <span className="truncate text-[10px] text-subtle">{hint}</span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground group-hover:text-foreground">
        {configured ? "Change" : "Connect"}
      </span>
    </button>
  );
}

type DropdownOption = {
  value: string;
  label: string;
  hint?: string;
};

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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative mt-1.5">
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
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg">
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
                    selected ? "text-foreground" : "text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && (
                  <span className="shrink-0 truncate text-[10px] text-subtle">
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
    if (/^https?:\/\//i.test(trimmed)) {
      onChange(trimmed);
    } else if (!trimmed) {
      onChange(DEFAULT_START_PAGE);
    }
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
