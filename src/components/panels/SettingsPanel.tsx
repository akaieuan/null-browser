import { useState } from "react";
import { X } from "lucide-react";

import { AboutSection } from "@/components/panels/settings/AboutSection";
import { AppearanceSection } from "@/components/panels/settings/AppearanceSection";
import { BlockingSection } from "@/components/panels/settings/BlockingSection";
import { BrowsingSection } from "@/components/panels/settings/BrowsingSection";
import { NotesSection } from "@/components/panels/settings/NotesSection";
import { PrivacySection } from "@/components/panels/settings/PrivacySection";
import { Card, Kicker } from "@/components/ui/atoms";
import { Button } from "@/components/ui/button";
import { PANEL_HEADER_HEIGHT } from "@/lib/layout";
import { cn } from "@/lib/utils";

type SettingsSection =
  | "appearance"
  | "browsing"
  | "privacy"
  | "blocking"
  | "notes"
  | "about";

/**
 * The nav, in the order it reads. A group carries a kicker only when its
 * members need a word to hold them together — the first group is the two
 * things everyone opens Settings for, and naming it would be filing for
 * the sake of filing.
 */
const GROUPS: Array<{
  kicker?: string;
  items: Array<{ id: SettingsSection; label: string }>;
}> = [
  {
    items: [
      { id: "appearance", label: "Appearance" },
      { id: "browsing", label: "Browsing" },
    ],
  },
  {
    kicker: "Privacy",
    items: [
      { id: "privacy", label: "Privacy" },
      { id: "blocking", label: "Blocking" },
    ],
  },
  {
    kicker: "Library",
    items: [{ id: "notes", label: "Notes" }],
  },
  {
    items: [{ id: "about", label: "About" }],
  },
];

/**
 * The one preferences surface.
 *
 * It does not use `Panel`. Panel's contract is a single column on a
 * single measure — one left edge for the header and the body — and this
 * surface has two columns, so adopting it would mean adding an escape
 * hatch to the frame every other panel depends on. The header geometry
 * is still Panel's: the same PANEL_HEADER_HEIGHT, the same kicker, the
 * same close button, so switching between Settings and History moves
 * nothing at the top of the card.
 *
 * Sections are chosen from the left rail rather than scrolled past. A
 * settings surface that is one long scroll makes the user read
 * everything to find one switch, and the rail is the same source-list
 * grammar the sidebar already uses.
 */
export function SettingsPanel({
  onClose,
  onOpenUrl,
}: {
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("appearance");

  return (
    // Same entrance as `Panel`, restated because this surface does not
    // use that frame (see the note above).
    <Card className="z-40 motion-safe:animate-[np-rise_160ms_ease-out]">
      <header className="shrink-0" style={{ height: PANEL_HEADER_HEIGHT }}>
        {/* pl-6 puts the kicker on the same x as the nav labels below it,
            so the header names the surface from the column that lists
            its sections. */}
        <div className="flex h-full w-full items-center justify-between pl-6 pr-6">
          <Kicker>Settings</Kicker>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close Settings"
            onClick={onClose}
            className="-mr-1.5 h-7 w-7"
          >
            <X size={14} strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="flex w-48 shrink-0 flex-col gap-5 overflow-y-auto px-4 pb-8"
        >
          {GROUPS.map((group, i) => (
            <div key={group.kicker ?? i} className="flex flex-col gap-0.5">
              {group.kicker && (
                <Kicker as="span" className="block px-2 pb-1.5">
                  {group.kicker}
                </Kicker>
              )}
              {group.items.map((item) => (
                <NavRow
                  key={item.id}
                  label={item.label}
                  selected={section === item.id}
                  onClick={() => setSection(item.id)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* `key` is the animation: switching sections remounts this
              column, which is what re-fires the entrance. Without it
              React keeps the same node and the new section's rows
              simply replace the old ones in place. */}
          <div
            key={section}
            className="max-w-2xl px-8 pb-20 motion-safe:animate-[np-rise_160ms_ease-out]"
          >
            {section === "appearance" && <AppearanceSection />}
            {section === "browsing" && <BrowsingSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "blocking" && <BlockingSection />}
            {section === "notes" && <NotesSection />}
            {section === "about" && <AboutSection onOpenUrl={onOpenUrl} />}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** SidebarRow's grammar, minus the parts a settings rail has no use for. */
function NavRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {/* The selection signal is the bar, not the fill — see SidebarRow.
          Every row carries one and scales it on the vertical: a bar
          that is conditionally rendered can only appear, and the
          selection moving between two rows should read as one thing
          moving. Scale, not opacity — brightness stays put. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1 bottom-1 w-0.5 origin-center rounded-full bg-select motion-safe:transition-transform duration-150 ease-out",
          selected ? "scale-y-100" : "scale-y-0",
        )}
      />
      {label}
    </button>
  );
}
