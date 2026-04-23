import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { THEMES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="text-sm font-medium">Settings</div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Settings"
          onClick={onClose}
          className="h-7 w-7"
        >
          <X size={14} strokeWidth={1.5} />
        </Button>
      </header>

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
  const [theme, setTheme] = useTheme();
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <Section title="Appearance">
      <Row label="Theme">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{active.label}</span>
          <div className="flex items-center gap-1.5">
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
                    "h-4 w-4 rounded-full border transition",
                    selected
                      ? "border-foreground"
                      : "border-border opacity-60 hover:opacity-100",
                  )}
                  style={{ background: t.swatch }}
                />
              );
            })}
          </div>
        </div>
      </Row>
    </Section>
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
  return (
    <Section title="AI">
      <Row label="Local model via Ollama">not detected</Row>
      <Row label="Cloud providers">none</Row>
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
