import { useEffect, useState } from "react";

export type ThemeId =
  | "charcoal"
  | "slate"
  | "sand"
  | "paper"
  | "0400am"
  | "mudd"
  | "cyberspace";

export interface Theme {
  id: ThemeId;
  label: string;
  swatch: string;
}

export const THEMES: Theme[] = [
  { id: "charcoal", label: "Charcoal", swatch: "#2a2a2a" },
  { id: "slate", label: "Slate", swatch: "#334b6b" },
  { id: "sand", label: "Sand", swatch: "#8b6b45" },
  { id: "paper", label: "Paper", swatch: "#f4f2ec" },
  { id: "0400am", label: "0400AM", swatch: "oklch(0.686 0.143 285.656)" },
  { id: "mudd", label: "Mudd", swatch: "oklch(0.707 0.108 152.216)" },
  { id: "cyberspace", label: "Cyberspace", swatch: "oklch(0.748 0.043 31.264)" },
];

export const DEFAULT_THEME: ThemeId = "charcoal";
const STORAGE_KEY = "null.theme";

function isThemeId(id: string | null): id is ThemeId {
  return !!id && THEMES.some((t) => t.id === id);
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // localStorage may be unavailable in some WebViews; fall through.
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

export function persistTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort.
  }
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  return [theme, setTheme];
}
