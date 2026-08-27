import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type ContextMenuItem = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * A menu in React, positioned in viewport coordinates.
 *
 * `maxX` is a hard requirement, not a nicety. Page content is a native
 * child webview that paints over everything React draws, so a menu that
 * runs past the chrome column is not clipped — it is invisible. The
 * caller passes the right edge of the surface the menu may occupy.
 */
export function ContextMenu({
  x,
  y,
  maxX,
  items,
  onClose,
}: {
  x: number;
  y: number;
  /** Right edge the menu must stay inside, in viewport pixels. */
  maxX: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });
  const [entered, setEntered] = useState(false);

  // Measure and clamp before paint, so the unclamped position never
  // reaches the screen. offsetWidth/offsetHeight, not the bounding rect:
  // the entrance transform is still applied on this frame and would
  // scale the numbers the clamp depends on.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flip = y + h + 4 > window.innerHeight;
    setPos({
      left: Math.max(4, Math.min(x, maxX - w - 4)),
      top: flip ? Math.max(4, y - h) : y,
    });
    el.focus();
  }, [x, y, maxX]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Capture, so this beats the window-level Escape handler that puts
    // the page back a layer at a time: dismissing a menu must not also
    // close Notes or a panel on the same keypress.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onLeave = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onLeave);
    window.addEventListener("scroll", onLeave, true);
    window.addEventListener("wheel", onLeave, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("wheel", onLeave, true);
    };
  }, [onClose]);

  const step = (delta: number) => {
    const el = ref.current;
    if (!el) return;
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    );
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) {
      buttons[delta > 0 ? 0 : buttons.length - 1].focus();
      return;
    }
    buttons[(i + delta + buttons.length) % buttons.length].focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      data-tauri-drag-region="false"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          step(-1);
        }
      }}
      // Border, no shadow. The entrance moves space only — nothing here
      // pulses brightness. 160ms is the app's entrance duration; this
      // one unfolds from its own top-left corner because that is where
      // the pointer is, but it takes exactly as long as the rest.
      className="fixed z-50 min-w-[176px] origin-top-left rounded-lg border border-border bg-card p-1 focus:outline-none motion-safe:transition-transform motion-safe:duration-[160ms] motion-safe:ease-out"
      style={{
        left: pos.left,
        top: pos.top,
        transform: entered ? undefined : "translateY(-4px) scale(0.98)",
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
            item.disabled && "pointer-events-none opacity-40",
          )}
        >
          {item.icon && (
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
              {item.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
