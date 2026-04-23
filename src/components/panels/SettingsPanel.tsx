import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { THEMES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="text-sm font-medium">Settings</div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Settings"
          onClick={onClose}
        >
          <X strokeWidth={1.5} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-8">
          <AppearanceSection />
          <PrivacySection />
          <AISection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">
        {title}
      </h2>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4">
        {children}
      </div>
    </section>
  );
}

function StatusRow({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "muted";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-foreground">{label}</div>
      <div
        className={cn(
          "text-xs tabular-nums",
          tone === "ok" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between">
        <div className="text-sm">Theme</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">{active.label}</div>
          <div className="flex items-center gap-2">
            {THEMES.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-label={t.label}
                  aria-pressed={selected}
                  title={t.label}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    "h-5 w-5 rounded-full border transition",
                    selected
                      ? "border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
                      : "border-border opacity-70 hover:opacity-100",
                  )}
                  style={{ background: t.swatch }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}

function PrivacySection() {
  return (
    <Section title="Privacy">
      <StatusRow label="Zero telemetry" value="active" />
      <StatusRow label="Default cloud connections" value="none" />
      <StatusRow label="All data local" value="✓" />
      <div className="pt-1 text-xs text-muted-foreground">
        These are invariants, not settings. They can't be turned off.
      </div>
    </Section>
  );
}

function AISection() {
  return (
    <Section title="AI">
      <StatusRow
        label="Local model via Ollama"
        value="not detected"
        tone="muted"
      />
      <StatusRow label="Cloud providers" value="none" tone="muted" />
      <div className="pt-1 text-xs text-muted-foreground">
        Local models run via Ollama at localhost:11434. Cloud providers
        (Anthropic, OpenAI) are opt-in and require your own API key.
      </div>
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
      <StatusRow label="Version" value={version ? `v${version}` : "—"} />
      <div className="pt-2 text-sm text-muted-foreground">
        An open-source web browser where nothing is sent, nothing is stored,
        nothing is tracked — unless you explicitly choose otherwise.
      </div>
      <a
        href="https://github.com/akaieuan/null-browser"
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        github.com/akaieuan/null-browser
      </a>
    </Section>
  );
}
