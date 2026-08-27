import { useEffect, useRef, useState } from "react";

/**
 * The row a new tab occupies before it is anything.
 *
 * ⌘T used to mint a blank tab and hand you the URL bar at the top of the
 * window, which is a long way from the list the tab will appear in. The
 * row types where it will live, and nothing is created until there is a
 * destination — cancel leaves the tab list exactly as it was.
 */
export function PendingTabRow({
  onCommit,
  onCancel,
}: {
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      // The row arrives by moving space. No fade — brightness stays put.
      // Shared keyframe rather than a mount-then-transition dance: the
      // row drops out of the list above it, same as everything else.
      className="motion-safe:animate-[np-drop_160ms_ease-out]"
    >
      <div className="flex h-7 items-center rounded-md border border-transparent bg-accent/50 px-2 transition-colors focus-within:border-[color-mix(in_srgb,var(--select)_50%,transparent)] focus-within:bg-accent">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) onCommit(draft);
              else onCancel();
            } else if (e.key === "Escape") {
              // Stop the native event too, or the window-level Escape
              // handler fires on the same keypress and takes a second
              // layer away with it.
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          // Committing unmounts this row, so blur cannot double-fire on
          // the way out — leaving the field is the only path here.
          onBlur={onCancel}
          placeholder="Search or enter URL"
          aria-label="Search or enter URL for a new tab"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="h-full w-full bg-transparent font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
    </div>
  );
}
