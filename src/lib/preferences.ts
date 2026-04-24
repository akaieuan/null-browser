import { useCallback, useEffect, useState } from "react";

// Lightweight user preferences stored in localStorage. When a SQLite-backed
// settings table lands later, this moves behind the same interface.

const NAME_KEY = "null.profile_name";
const START_PAGE_KEY = "null.start_page";

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

/** React hook with reactive state + localStorage persistence. */
export function usePreferences() {
  const [name, setNameState] = useState<string>(loadProfileName);
  const [startPage, setStartPageState] = useState<StartPagePref>(loadStartPage);

  useEffect(() => {
    safeSet(NAME_KEY, name);
  }, [name]);

  useEffect(() => {
    safeSet(START_PAGE_KEY, startPage);
  }, [startPage]);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    setNameState(trimmed || DEFAULT_NAME);
  }, []);

  const setStartPage = useCallback((next: StartPagePref) => {
    setStartPageState(next);
  }, []);

  return { name, setName, startPage, setStartPage };
}
