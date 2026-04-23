import { useEffect, useRef } from "react";

import { PanelHeader } from "@/components/panels/PanelHeader";

/**
 * Profile panel. Structured like Settings/History (full-surface overlay so
 * tabs can be hidden behind it) with a small floating card in the top-right.
 * A dropdown anchored to the button alone gets clipped by Tauri child
 * webviews — they always render above React.
 */
export function ProfileMenu({
  profileName,
  onClose,
}: {
  profileName: string;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 bg-background text-foreground">
      <PanelHeader title="Profile" onClose={onClose} />
      <div className="flex justify-end px-4">
        <div
          ref={cardRef}
          className="w-72 rounded-lg border border-border bg-muted/20 p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {profileName[0]?.toUpperCase() ?? "N"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">
                {profileName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Local · no sync, no account
              </div>
            </div>
          </div>
          <div className="my-3 h-px bg-border" />
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded px-2 py-1.5 text-left text-xs text-muted-foreground disabled:opacity-50"
          >
            Manage profiles
          </button>
          <div className="mt-1 px-2 text-[10px] leading-relaxed text-subtle">
            Multiple local profiles land when Settings grows up. Each profile
            keeps its own bookmarks, history, and AI conversations — all on
            your machine.
          </div>
        </div>
      </div>
    </div>
  );
}
