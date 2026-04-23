import { useEffect, useRef } from "react";

export function ProfileMenu({
  profileName,
  onClose,
}: {
  profileName: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer one tick so the click that opened the menu doesn't close it.
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
    <div
      ref={ref}
      role="menu"
      className="absolute right-2 top-full z-40 mt-1 w-64 rounded-lg border border-border bg-background p-2 shadow-lg"
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
          {profileName[0]?.toUpperCase() ?? "N"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">{profileName}</div>
          <div className="truncate text-xs text-muted-foreground">
            Local profile · no sync
          </div>
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Manage profiles
      </button>
    </div>
  );
}
