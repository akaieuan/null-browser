import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";

// One palette for now — aka. The others were a range of half-finished
// moods; only this one earned its keep, so the picker is down to light
// vs. dark and the identity is fixed. The plumbing (data-palette, the
// menu event, this list) is kept intact so adding a palette later is a
// block of CSS and a line here, not a rewire.
export type PaletteId = "aka";

export type Mode = "light" | "dark";

export interface Palette {
  id: PaletteId;
  label: string;
  swatch: string;
}

export const PALETTES: Palette[] = [
  { id: "aka", label: "aka", swatch: "oklch(0.707 0.108 152.216)" },
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
