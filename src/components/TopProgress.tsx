import { useEffect, useState } from "react";

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
      className="pointer-events-none absolute inset-x-0 top-0 h-full"
      style={{ contain: "strict" }}
    >
      <div
        className={cn(
          "h-full bg-foreground",
          phase === "loading" && "animate-[np-progress_8s_ease-out_forwards]",
          phase === "done" &&
            "w-full opacity-0 transition-opacity duration-200",
        )}
        style={phase === "done" ? { width: "100%" } : undefined}
      />
    </div>
  );
}
