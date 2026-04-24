import { useCallback, useEffect, useState } from "react";

// Lightweight user preferences stored in localStorage. When a SQLite-backed
// settings table lands later, this moves behind the same interface.

const NAME_KEY = "null.profile_name";
const START_PAGE_KEY = "null.start_page";
const SEARCH_ENGINE_KEY = "null.search_engine";

const DEFAULT_NAME = "Null";

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

/** React hook with reactive state + localStorage persistence. */
export function usePreferences() {
  const [name, setNameState] = useState<string>(loadProfileName);
  const [startPage, setStartPageState] = useState<StartPagePref>(loadStartPage);
  const [searchEngine, setSearchEngineState] =
    useState<SearchEngineId>(loadSearchEngine);

  useEffect(() => {
    safeSet(NAME_KEY, name);
  }, [name]);

  useEffect(() => {
    safeSet(START_PAGE_KEY, startPage);
  }, [startPage]);

  useEffect(() => {
    safeSet(SEARCH_ENGINE_KEY, searchEngine);
  }, [searchEngine]);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    setNameState(trimmed || DEFAULT_NAME);
  }, []);

  const setStartPage = useCallback((next: StartPagePref) => {
    setStartPageState(next);
  }, []);

  const setSearchEngine = useCallback((next: SearchEngineId) => {
    setSearchEngineState(next);
  }, []);

  return {
    name,
    setName,
    startPage,
    setStartPage,
    searchEngine,
    setSearchEngine,
  };
}
