import { Moon, Sun } from "lucide-react";

import {
  ModeButton,
  Row,
  SectionHeader,
  SegmentedControl,
  Toggle,
} from "@/components/panels/settings/controls";
import {
  CORNERS,
  GLASS_OPTIONS,
  usePreferences,
  type CornersPref,
  type GlassPref,
} from "@/lib/preferences";
import { PALETTES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function AppearanceSection() {
  const { palette, mode, setPalette, setMode } = useTheme();
  const { corners, setCorners, glass, setGlass, hoverReveal, setHoverReveal } =
    usePreferences();
  const active = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
  return (
    <section>
      <SectionHeader title="Appearance" />
      <div className="mt-1 flex flex-col">
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
      </div>
    </section>
  );
}
