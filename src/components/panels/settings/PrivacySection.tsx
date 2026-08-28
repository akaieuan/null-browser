import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { Row, SectionHeader } from "@/components/panels/settings/controls";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function PrivacySection() {
  const [count, setCount] = useState<number | null>(null);
  const [clearState, setClearState] = useState<"idle" | "confirm" | "done">(
    "idle",
  );

  const refresh = () => {
    ipc
      .listHistory(10000)
      .then((rows) => setCount(rows.length))
      .catch(() => setCount(null));
  };

  useEffect(refresh, []);

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
    refresh();
    window.setTimeout(() => setClearState("idle"), 1500);
  }

  return (
    <section>
      <SectionHeader title="Privacy" />
      <div className="mt-1 flex flex-col">
        <Row label="Telemetry">off</Row>
        <Row label="Cloud connections">none</Row>
        <Row label="All data">local</Row>
        <Row label="History">
          {count === null
            ? "—"
            : `${count} ${count === 1 ? "entry" : "entries"}`}
        </Row>
        <Row label="Clear browsing data">
          <button
            type="button"
            onClick={clearBrowsingData}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              clearState === "confirm"
                ? "border-danger text-danger"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Trash2 size={12} strokeWidth={1.5} />
            {clearState === "confirm"
              ? "Click again to wipe history + logins"
              : clearState === "done"
                ? "Cleared"
                : "Clear history & logins"}
          </button>
        </Row>
      </div>
    </section>
  );
}
