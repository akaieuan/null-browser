// If the input looks like a URL, return it (adding https:// if no scheme).
// Otherwise treat it as a search query and route to the user's chosen
// search engine.

import { searchUrlFor, type SearchEngineId } from "@/lib/preferences";

const HAS_PROTOCOL = /^[a-z][a-z0-9+\-.]*:\/\//i;
const LOOKS_LIKE_DOMAIN = /^[^\s]+\.[a-z]{2,}([\/?#]|$)/i;

export function resolveQuery(
  q: string,
  searchEngine: SearchEngineId = "duckduckgo",
): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  if (HAS_PROTOCOL.test(trimmed)) return trimmed;
  if (LOOKS_LIKE_DOMAIN.test(trimmed) && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }
  return searchUrlFor(searchEngine, trimmed);
}
