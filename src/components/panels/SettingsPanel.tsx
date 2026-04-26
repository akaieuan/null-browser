import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

import { PanelHeader } from "@/components/panels/PanelHeader";
import {
  ipc,
  type OllamaStatus,
  type ProviderStatus,
} from "@/lib/ipc";
import { PALETTES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground"
      style={{ contain: "layout paint style" }}
    >
      <PanelHeader title="Settings" onClose={onClose} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl space-y-14 px-8 py-10">
          <AppearanceSection />
          <PrivacySection />
          <AISection />
          <AboutSection />
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="mt-3 border-t border-border">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 text-sm last:border-b-0">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function AppearanceSection() {
  const { palette, mode, setPalette, setMode } = useTheme();
  const active = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
  return (
    <Section title="Appearance">
      <Row label="Theme">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{active.label}</span>
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
    </Section>
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
        "flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function PrivacySection() {
  return (
    <Section title="Privacy">
      <Row label="Telemetry">off</Row>
      <Row label="Cloud connections">none</Row>
      <Row label="All data">local</Row>
    </Section>
  );
}

function AISection() {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    ipc.aiProviderStatus().then(setProviders).catch(() => {});
    ipc
      .aiOllamaStatus()
      .then(setOllama)
      .catch(() => setOllama({ running: false, models: [] }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ollamaLabel = (() => {
    if (!ollama) return "checking…";
    if (!ollama.running) return "not detected";
    if (ollama.models.length === 0) return "running · no models installed";
    const n = ollama.models.length;
    return `running · ${n} model${n === 1 ? "" : "s"}`;
  })();

  const saveKey = async () => {
    const k = keyDraft.trim();
    if (!k) return;
    setSavingKey(true);
    setKeyError(null);
    try {
      await ipc.aiSetKey("anthropic", k);
      setKeyDraft("");
      refresh();
    } catch (e) {
      setKeyError(String(e));
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <Section title="AI">
      <Row label="Local model via Ollama">{ollamaLabel}</Row>
      {ollama?.running && ollama.models.length > 0 && (
        <Row label="Installed models">
          <span className="truncate text-right" title={ollama.models.map((m) => m.name).join(", ")}>
            {ollama.models.map((m) => m.name).join(", ")}
          </span>
        </Row>
      )}
      {!ollama?.running && (
        <Row label="Install Ollama">
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            ollama.com/download
          </a>
        </Row>
      )}
      <Row label="Anthropic">
        {providers?.anthropic ? (
          <span>key set</span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              placeholder="sk-ant-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveKey();
              }}
              className="h-7 w-44 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={savingKey || !keyDraft.trim()}
              className={cn(
                "h-7 rounded border border-border px-2 text-xs",
                savingKey || !keyDraft.trim()
                  ? "text-muted-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {savingKey ? "saving…" : "save"}
            </button>
          </div>
        )}
      </Row>
      {keyError && (
        <Row label=" ">
          <span className="text-red-500">{keyError}</span>
        </Row>
      )}
      <Row label="Default routing">
        {ollama?.running
          ? "local · Ollama"
          : providers?.anthropic
            ? "cloud · Anthropic (opt-in)"
            : "none"}
      </Row>
    </Section>
  );
}

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <Section title="About">
      <Row label="Version">{version ? `v${version}` : "—"}</Row>
      <Row label="Source">
        <a
          href="https://github.com/akaieuan/null-browser"
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          github.com/akaieuan/null-browser
        </a>
      </Row>
    </Section>
  );
}
