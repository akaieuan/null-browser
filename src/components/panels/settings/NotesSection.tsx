import { useEffect, useState } from "react";

import { Row, SectionHeader } from "@/components/panels/settings/controls";
import { ipc } from "@/lib/ipc";

export function NotesSection() {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    ipc.getNotesDir().then(setDir).catch(() => {});
  }, []);
  return (
    <section>
      <SectionHeader title="Notes" />
      <div className="mt-1 flex flex-col">
        <Row label="Notes folder">
          <span
            className="block truncate font-mono text-[11px]"
            title={dir ?? undefined}
          >
            {dir ?? "—"}
          </span>
        </Row>
        <Row label="Format">markdown · YAML front matter</Row>
        <Row label="Inference">never — Null captures, nothing more</Row>
      </div>
    </section>
  );
}
