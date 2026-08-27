import { X } from "lucide-react";

import { Card, Kicker } from "@/components/ui/atoms";
import { Button } from "@/components/ui/button";
import { PANEL_HEADER_HEIGHT } from "@/lib/layout";
import { cn } from "@/lib/utils";

/**
 * The frame every full-surface panel sits in — History, Network,
 * Settings, Notes. A Card in the page's own rect, so opening a panel
 * swaps the page for a surface of identical geometry.
 *
 * It owns the measure. The header and the body take the same column,
 * which gives the panel one left edge and one right edge: the title
 * lines up with the first row beneath it, and the close button lines
 * up with whatever trailing control the body puts in its first row.
 *
 * `measure` is the one thing a panel chooses. Settings is a form, so it
 * reads better narrow; lists want the extra column.
 */
export function Panel({
  title,
  onClose,
  measure = "list",
  align = "center",
  children,
}: {
  title: string;
  onClose: () => void;
  /** `form` for label/control pairs, `list` for rows. */
  measure?: "form" | "list";
  /** `left` anchors the column to the card's left edge (Settings). */
  align?: "center" | "left";
  children: React.ReactNode;
}) {
  const column = cn(
    measure === "form" ? "max-w-xl" : "max-w-2xl",
    align === "center" && "mx-auto",
  );

  return (
    // The surface takes the page's own rect, so it arrives the way a
    // page would if a page could be animated: a short rise into place.
    // One class here covers History and Network — Settings states it
    // itself, being the one panel that does not use this frame.
    <Card className="z-40 motion-safe:animate-[np-rise_160ms_ease-out]">
      <header className="shrink-0" style={{ height: PANEL_HEADER_HEIGHT }}>
        <div
          className={cn(
            "flex h-full w-full items-center justify-between px-8",
            column,
          )}
        >
          <Kicker>{title}</Kicker>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="-mr-1.5 h-7 w-7"
          >
            <X size={14} strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className={cn("w-full px-8 pb-20", column)}>{children}</div>
      </main>
    </Card>
  );
}
