import { useCallback, useSyncExternalStore } from "react";

// Lightweight user preferences stored in localStorage. When a SQLite-backed
// settings table lands later, this moves behind the same interface.

const NAME_KEY = "null.profile_name";
const START_PAGE_KEY = "null.start_page";
const SEARCH_ENGINE_KEY = "null.search_engine";
const CORNERS_KEY = "null.ui_corners";
const GLASS_KEY = "null.ui_glass";
const HOVER_REVEAL_KEY = "null.ui_hover_reveal";

const DEFAULT_NAME = "Null";

/**
 * Corner radius family. One knob drives the whole scale (`--radius`)
 * plus the native page-card corners, so the chrome and the page can
 * never disagree about how round the app is.
 */
export type CornersPref = "sharp" | "default" | "round";
export const CORNERS: Array<{
  id: CornersPref;
  label: string;
  /** Value for the CSS `--radius` custom property. */
  radius: string;
  /** CALayer cornerRadius for the native page webviews, in px. */
  nativeRadius: number;
}> = [
  { id: "sharp", label: "Sharp", radius: "0.375rem", nativeRadius: 8 },
  { id: "default", label: "Default", radius: "0.625rem", nativeRadius: 12 },
  { id: "round", label: "Round", radius: "0.875rem", nativeRadius: 16 },
];

/**
 * How much desktop shows through the chrome. Purely compositing — the
 * wash percentage over the vibrancy layer; `solid` opts out entirely.
 */
export type GlassPref = "clear" | "frosted" | "solid";
export const GLASS_OPTIONS: Array<{ id: GlassPref; label: string }> = [
  { id: "clear", label: "Clear" },
  { id: "frosted", label: "Frosted" },
  { id: "solid", label: "Solid" },
];

/**
 * Start-page preference:
 *   "null"       → show the Null landing (no webview)
 *   "duckduckgo" → open DuckDuckGo in the new tab
 *   "https://…"  → any user-supplied URL
 */
export type StartPagePref = "null" | "duckduckgo" | string;
export const DEFAULT_START_PAGE: StartPagePref = "null";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

export function loadProfileName(): string {
  return (safeGet(NAME_KEY) || DEFAULT_NAME).trim() || DEFAULT_NAME;
}

export function loadStartPage(): StartPagePref {
  const raw = safeGet(START_PAGE_KEY);
  if (!raw) return DEFAULT_START_PAGE;
  return raw;
}

/** Resolve a preference value into a URL to navigate to, or null for landing. */
export function resolveStartUrl(pref: StartPagePref): string | null {
  if (pref === "null") return null;
  if (pref === "duckduckgo") return "https://duckduckgo.com";
  if (/^https?:\/\//i.test(pref)) return pref;
  return null;
}

export function isCustomStartPage(pref: StartPagePref): boolean {
  return /^https?:\/\//i.test(pref);
}

// Search engines. Each entry is a query URL template where %s gets replaced
// with the URL-encoded query. All options are no-tracking commitments.
export type SearchEngineId =
  | "duckduckgo"
  | "brave"
  | "mojeek"
  | "startpage";

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  template: string;
  note: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    template: "https://duckduckgo.com/?q=%s",
    note: "Bing-backed · no logs",
  },
  {
    id: "brave",
    label: "Brave",
    template: "https://search.brave.com/search?q=%s",
    note: "Independent index · no logs",
  },
  {
    id: "mojeek",
    label: "Mojeek",
    template: "https://www.mojeek.com/search?q=%s",
    note: "Independent index · no tracking",
  },
  {
    id: "startpage",
    label: "Startpage",
    template: "https://www.startpage.com/sp/search?query=%s",
    note: "Anonymous Google · proxy",
  },
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "duckduckgo";

function isSearchEngineId(id: string | null): id is SearchEngineId {
  return !!id && SEARCH_ENGINES.some((e) => e.id === id);
}

export function loadSearchEngine(): SearchEngineId {
  const raw = safeGet(SEARCH_ENGINE_KEY);
  return isSearchEngineId(raw) ? raw : DEFAULT_SEARCH_ENGINE;
}

/** Build a full search URL for a query against the given engine. */
export function searchUrlFor(engine: SearchEngineId, query: string): string {
  const found =
    SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0];
  return found.template.replace("%s", encodeURIComponent(query));
}

/**
 * One store, shared by every caller of `usePreferences`.
 *
 * This used to be plain `useState` inside the hook, which meant each
 * component that called it got its own private copy. `App` calls it and
 * so does `SettingsPanel`, so changing the search engine or the start
 * page in Settings updated Settings' copy and left App's stale for the
 * rest of the session — the setting appeared to save and then did
 * nothing. A module-level snapshot plus `useSyncExternalStore` gives
 * every caller the same value and re-renders all of them on a write.
 */
type Prefs = {
  name: string;
  startPage: StartPagePref;
  searchEngine: SearchEngineId;
  corners: CornersPref;
  glass: GlassPref;
  hoverReveal: boolean;
};

/** localStorage key per pref, for the generic write path. */
const KEYS: Record<keyof Prefs, string> = {
  name: NAME_KEY,
  startPage: START_PAGE_KEY,
  searchEngine: SEARCH_ENGINE_KEY,
  corners: CORNERS_KEY,
  glass: GLASS_KEY,
  hoverReveal: HOVER_REVEAL_KEY,
};

function loadCorners(): CornersPref {
  const raw = safeGet(CORNERS_KEY);
  return CORNERS.some((c) => c.id === raw) ? (raw as CornersPref) : "default";
}

function loadGlass(): GlassPref {
  const raw = safeGet(GLASS_KEY);
  return GLASS_OPTIONS.some((g) => g.id === raw) ? (raw as GlassPref) : "frosted";
}

let snapshot: Prefs | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Prefs {
  snapshot ??= {
    name: loadProfileName(),
    startPage: loadStartPage(),
    searchEngine: loadSearchEngine(),
    corners: loadCorners(),
    glass: loadGlass(),
    hoverReveal: safeGet(HOVER_REVEAL_KEY) !== "off",
  };
  return snapshot;
}

function write(patch: Partial<Prefs>): void {
  const cur = getSnapshot();
  const next = { ...cur, ...patch };
  // Identity must change for useSyncExternalStore to see the update, and
  // must NOT change when nothing did, or every writer loops.
  if ((Object.keys(KEYS) as Array<keyof Prefs>).every((k) => next[k] === cur[k])) {
    return;
  }
  snapshot = next;
  for (const k of Object.keys(patch) as Array<keyof Prefs>) {
    const v = next[k];
    safeSet(KEYS[k], typeof v === "boolean" ? (v ? "on" : "off") : String(v));
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook with reactive state + localStorage persistence. */
export function usePreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setName = useCallback((next: string) => {
    write({ name: next.trim() || DEFAULT_NAME });
  }, []);

  const setStartPage = useCallback((next: StartPagePref) => {
    write({ startPage: next });
  }, []);

  const setSearchEngine = useCallback((next: SearchEngineId) => {
    write({ searchEngine: next });
  }, []);

  const setCorners = useCallback((next: CornersPref) => {
    write({ corners: next });
  }, []);

  const setGlass = useCallback((next: GlassPref) => {
    write({ glass: next });
  }, []);

  const setHoverReveal = useCallback((next: boolean) => {
    write({ hoverReveal: next });
  }, []);

  return {
    name: prefs.name,
    setName,
    startPage: prefs.startPage,
    setStartPage,
    searchEngine: prefs.searchEngine,
    setSearchEngine,
    corners: prefs.corners,
    setCorners,
    glass: prefs.glass,
    setGlass,
    hoverReveal: prefs.hoverReveal,
    setHoverReveal,
  };
}
