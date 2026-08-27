/**
 * Last session's open tabs, so quitting the app doesn't cost the user
 * their working set.
 *
 * localStorage, like every other piece of shell preference state: the
 * tab list is chrome state, not browsing data — history already
 * remembers where you've been, this only remembers what was open.
 * The three questions: **stores** url + title per open tab and which
 * one was active, locally; **transmits** nothing; **remembers** one
 * session back — every save overwrites the last.
 *
 * Restored tabs come back dormant (no webview) and load on selection,
 * so restoring twenty tabs costs nothing until they're wanted.
 */

export type SavedTab = { url: string; title: string };

const KEY = "null.session.v1";

export function loadSession(): { tabs: SavedTab[]; active: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter(
      (t): t is SavedTab =>
        !!t &&
        typeof (t as SavedTab).url === "string" &&
        typeof (t as SavedTab).title === "string" &&
        /^https?:\/\//.test((t as SavedTab).url),
    );
    if (tabs.length === 0) return null;
    const active =
      typeof parsed.active === "number"
        ? Math.min(Math.max(0, Math.floor(parsed.active)), tabs.length - 1)
        : 0;
    return { tabs, active };
  } catch {
    return null;
  }
}

export function saveSession(tabs: SavedTab[], active: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs, active }));
  } catch {
    // Best-effort: a full or blocked store must never break browsing.
  }
}
