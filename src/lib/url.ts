// If the input looks like a URL, return it (adding https:// if no scheme).
// Otherwise treat it as a search query and route to the user's chosen
// search engine.

import { searchUrlFor, type SearchEngineId } from "@/lib/preferences";

const WEB_PROTOCOL = /^https?:\/\//i;
const HAS_PROTOCOL = /^[a-z][a-z0-9+\-.]*:\/\//i;
// A dotted host with an alphabetic TLD, optionally carrying a port or a
// path: example.com, example.com:8080, sub.example.co.uk/path.
const LOOKS_LIKE_DOMAIN = /^[^\s]+\.[a-z]{2,}(:\d+)?([\/?#]|$)/i;
// Hosts an alphabetic TLD can't vouch for but a browser still treats as
// navigations rather than searches: localhost and a bare IPv4 literal,
// each with an optional port. Without these, "localhost:3000" and
// "192.168.1.1" fell through to a (useless) web search.
const LOCALHOST = /^localhost(:\d+)?([\/?#]|$)/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([\/?#]|$)/;

export function resolveQuery(
  q: string,
  searchEngine: SearchEngineId = "duckduckgo",
): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  if (WEB_PROTOCOL.test(trimmed)) return trimmed;
  // Tabs only load http(s) — the Rust side refuses everything else.
  // A non-web scheme (file:, ftp:, …) becomes a search instead of a
  // silent dead-end.
  if (HAS_PROTOCOL.test(trimmed)) {
    return searchUrlFor(searchEngine, trimmed);
  }
  const noSpace = !trimmed.includes(" ");
  if (noSpace && (LOCALHOST.test(trimmed) || IPV4.test(trimmed))) {
    // localhost and IP literals are almost always local dev servers
    // speaking http; https would hand the user a TLS error page instead
    // of the site they meant.
    return `http://${trimmed}`;
  }
  if (noSpace && LOOKS_LIKE_DOMAIN.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return searchUrlFor(searchEngine, trimmed);
}
