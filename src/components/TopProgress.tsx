import { useEffect, useState } from "react";

import { PROGRESS_HEIGHT } from "@/lib/layout";
import { cn } from "@/lib/utils";

type Phase = "idle" | "loading" | "done";

export function TopProgress({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (active) {
      setPhase("loading");
      return;
    }
    if (phase === "loading") {
      setPhase("done");
      const t = window.setTimeout(() => setPhase("idle"), 220);
      return () => window.clearTimeout(t);
    }
  }, [active, phase]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      // Explicit height, not h-full: the row it sits in is the progress
      // strip plus PAGE_GUTTER, and a bar that filled the box would be
      // five times too thick.
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{ height: PROGRESS_HEIGHT, contain: "strict" }}
    >
      <div
        className={cn(
          "h-full bg-select",
          phase === "loading" && "animate-[np-progress_8s_ease-out_forwards]",
          phase === "done" &&
            "w-full opacity-0 transition-opacity duration-200",
        )}
        style={phase === "done" ? { width: "100%" } : undefined}
      />
    </div>
  );
}
