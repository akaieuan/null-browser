import { useEffect, useState } from "react";

import {
  Row,
  SectionHeader,
  ZeroMark,
} from "@/components/panels/settings/controls";
import { ipc } from "@/lib/ipc";

export function AboutSection({
  onOpenUrl,
}: {
  onOpenUrl: (url: string) => void;
}) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <section>
      <SectionHeader title="About" />
      <div className="mt-1 flex flex-col">
        <Row label="Null">
          <span className="flex items-center gap-2">
            <ZeroMark />
            <span>{version ? `v${version}` : "—"}</span>
          </span>
        </Row>
        <Row label="Source">
          <button
            type="button"
            onClick={() => onOpenUrl("https://github.com/akaieuan/null-browser")}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            github.com/akaieuan/null-browser
          </button>
        </Row>
      </div>
    </section>
  );
}
