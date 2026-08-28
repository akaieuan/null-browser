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
import { useTheme } from "@/lib/theme";

export function AppearanceSection() {
  const { mode, setMode } = useTheme();
  const { corners, setCorners, glass, setGlass, hoverReveal, setHoverReveal } =
    usePreferences();
  return (
    <section>
      <SectionHeader title="Appearance" />
      <div className="mt-1 flex flex-col">
        {/* One palette for now (aka), so there is no swatch row — the
            mode switch below is the whole of Theme. */}
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
