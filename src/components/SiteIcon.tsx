import { useMemo } from "react";

import { cn } from "@/lib/utils";

/**
 * A site's mark: the real favicon when one has been captured, a
 * hostname-derived letter tile until then.
 *
 * `icon` is a `data:image/png;base64,` URL captured *from the page as
 * it was visited* — never fetched by Null itself, which would contact
 * every host the user has ever bookmarked (invariant 2). Capture,
 * validation and storage live in `src-tauri/src/favicons.rs`; three
 * G-tiles for three Google properties is what this replaces.
 *
 * The fallback letter's colour is a hash of the hostname, so a site
 * keeps the same mark across launches with nothing stored.
 */
export function SiteIcon({
  url,
  icon,
  size = 14,
  className,
}: {
  url: string;
  /** Captured favicon as a validated data URL, if the origin has one. */
  icon?: string | null;
  /** Edge length in px. */
  size?: number;
  className?: string;
}) {
  const { letter, hue } = useMemo(() => derive(url), [url]);

  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-[3px]", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[3px] font-medium text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.58),
        lineHeight: 1,
        // Fixed chroma and lightness: only the hue varies, so a row of
        // these reads as one family rather than a bag of sweets, and
        // white text clears contrast on every one of them.
        background: `oklch(0.55 0.13 ${hue})`,
      }}
    >
      {letter}
    </span>
  );
}

/** Stable per-hostname letter and hue. */
function derive(url: string): { letter: string; hue: number } {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = url.replace(/^https?:\/\//i, "").replace(/^www\./, "");
  }

  // The registrable-ish label: for "mail.google.com" this is "google",
  // which is the word a person would use for the site. Falls back to the
  // whole string for anything that is not a normal hostname.
  const parts = host.split(".").filter(Boolean);
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || host;

  const letter = (label[0] || "?").toUpperCase();

  // FNV-1a over the full host, so mail.google.com and drive.google.com
  // are distinguishable even though they share a letter.
  let h = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return { letter, hue: Math.abs(h) % 360 };
}
