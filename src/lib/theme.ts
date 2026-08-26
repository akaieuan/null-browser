import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";

export type PaletteId =
  | "aka"
  | "slate"
  | "sand"
  | "0400am"
  | "mudd"
  | "cyberspace";

export type Mode = "light" | "dark";

export interface Palette {
  id: PaletteId;
  label: string;
  swatch: string;
}

export const PALETTES: Palette[] = [
  { id: "aka", label: "aka", swatch: "oklch(0.707 0.108 152.216)" },
  { id: "slate", label: "Slate", swatch: "#334b6b" },
  { id: "sand", label: "Sand", swatch: "#8b6b45" },
  { id: "0400am", label: "0400AM", swatch: "oklch(0.686 0.143 285.656)" },
  { id: "mudd", label: "Mudd", swatch: "oklch(0.182 0.014 94.03)" },
  { id: "cyberspace", label: "Cyberspace", swatch: "oklch(0.748 0.043 31.264)" },
];

export const DEFAULT_PALETTE: PaletteId = "aka";
export const DEFAULT_MODE: Mode = "dark";

const PALETTE_KEY = "null.palette";
const MODE_KEY = "null.mode";

export function isPaletteId(id: string | null): id is PaletteId {
  return !!id && PALETTES.some((t) => t.id === id);
}

function isMode(m: string | null): m is Mode {
  return m === "light" || m === "dark";
}

export function loadPalette(): PaletteId {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    if (isPaletteId(stored)) return stored;
  } catch {
    /* localStorage may be unavailable; fall through. */
  }
  return DEFAULT_PALETTE;
}

export function loadMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    /* fall through */
  }
  return DEFAULT_MODE;
}

export function applyTheme(palette: PaletteId, mode: Mode): void {
  const root = document.documentElement;
  root.dataset.palette = palette;
  root.dataset.mode = mode;

  // Keep the native window on the same side of light/dark as the
  // palette. This is what the vibrancy material reads: without it, a
  // dark palette sits over the light blur variant (or vice versa) and
  // the glass composites to flat gray fog.
  //
  // Through a Rust command, deliberately. The JS `setTheme` API needs
  // the `core:window:allow-set-theme` capability, which was never
  // granted — so the previous version of this call rejected silently
  // for its entire life and nobody saw the glass it was meant to fix.
  // Custom commands carry their own permission by being registered.
  ipc.setWindowTheme(mode).catch(() => {});
}

function persist(palette: PaletteId, mode: Mode): void {
  try {
    localStorage.setItem(PALETTE_KEY, palette);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* best-effort */
  }
}

export interface UseThemeReturn {
  palette: PaletteId;
  mode: Mode;
  setPalette: (id: PaletteId) => void;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

export function useTheme(): UseThemeReturn {
  const [palette, setPaletteState] = useState<PaletteId>(loadPalette);
  const [mode, setModeState] = useState<Mode>(loadMode);

  useEffect(() => {
    applyTheme(palette, mode);
    persist(palette, mode);
  }, [palette, mode]);

  return {
    palette,
    mode,
    setPalette: setPaletteState,
    setMode: setModeState,
    toggleMode: () => setModeState((m) => (m === "dark" ? "light" : "dark")),
  };
}
