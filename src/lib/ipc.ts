import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { ContentRect } from "@/lib/layout";

/**
 * In a dev build opened as an ordinary web page there is no Rust side,
 * so every command would reject and every surface would render empty.
 * Fall back to fixtures there so the UI can be styled without launching
 * the app. Both guards matter: `import.meta.env.DEV` removes this from
 * production output entirely, and the Tauri check means the real app
 * always uses the real IPC — including when a command legitimately fails.
 */
const USE_FIXTURES =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  !("__TAURI_INTERNALS__" in window);

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_FIXTURES) {
    return import("@/lib/fixtures").then(
      (m) => m.fixtureFor(cmd, args) as T,
    );
  }
  return tauriInvoke<T>(cmd, args);
}

export type Bookmark = {
  id: number;
  url: string;
  title: string;
  created_at: number;
  /** "bookmark" or "folder". A folder has an empty URL. */
  kind: "bookmark" | "folder";
  /** Folder this row lives in; null at the top level. */
  parent_id: number | null;
};

export type HistoryEntry = {
  id: number;
  url: string;
  title: string;
  visited_at: number;
};

export type NetworkEvent = {
  id: number;
  tab_id: string | null;
  url: string;
  origin: string;
  kind: string;
  blocked: boolean;
  at: number;
};

export type BlockedOrigin = {
  origin: string;
  created_at: number;
};

export type Favicon = {
  origin: string;
  data: string;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

/** A saved clip: a whole page, or a selection from one. */
export type Artifact = {
  id: number;
  kind: string;
  title: string;
  source_url: string;
  source_title: string | null;
  markdown: string;
  model: string;
  created_at: number;
  /** Path to the markdown mirror in the user's notes directory. */
  file_path: string | null;
};

export const ipc = {
  getAppVersion: () => invoke<string>("get_app_version"),

  openTab: (id: string, url: string, rect: ContentRect) =>
    invoke<void>("open_tab", { id, url, rect }),
  closeTab: (id: string) => invoke<void>("close_tab", { id }),
  activateTab: (id: string) => invoke<void>("activate_tab", { id }),
  /** Split view: show exactly these tabs, keyboard to `focus`. */
  activateTabs: (ids: string[], focus: string) =>
    invoke<void>("activate_tabs", { ids, focus }),
  hideAllTabs: () => invoke<void>("hide_all_tabs"),
  navigateTab: (id: string, url: string) =>
    invoke<void>("navigate_tab", { id, url }),

  resizeContent: (rect: ContentRect, only?: string | null) =>
    invoke<void>("resize_content", { rect, only: only ?? null }),
  focusShell: () => invoke<void>("focus_shell"),

  goBack: (id: string) => invoke<void>("go_back", { id }),
  goForward: (id: string) => invoke<void>("go_forward", { id }),
  reload: (id: string) => invoke<void>("reload", { id }),
  clearTabStorage: () => invoke<void>("clear_tab_storage"),

  listBookmarks: () => invoke<Bookmark[]>("list_bookmarks"),
  addBookmark: (url: string, title: string) =>
    invoke<Bookmark>("add_bookmark", { url, title }),
  findInPage: (id: string, query: string, forward: boolean, restart: boolean) =>
    invoke<void>("find_in_page", { id, query, forward, restart }),
  removeBookmark: (id: number) => invoke<void>("remove_bookmark", { id }),
  updateBookmark: (id: number, url: string, title: string) =>
    invoke<void>("update_bookmark", { id, url, title }),
  reorderBookmarks: (orderedIds: number[]) =>
    invoke<void>("reorder_bookmarks", { orderedIds }),
  showBookmarkMenu: (id: number) =>
    invoke<void>("show_bookmark_menu", { id }),

  listHistory: (limit?: number) =>
    invoke<HistoryEntry[]>("list_history", { limit }),
  addHistory: (url: string, title: string) =>
    invoke<void>("add_history", { url, title }),
  removeHistory: (id: number) => invoke<void>("remove_history", { id }),
  clearHistory: () => invoke<void>("clear_history"),

  listNetworkEvents: () => invoke<NetworkEvent[]>("list_network_events"),
  clearNetworkEvents: () => invoke<void>("clear_network_events"),
  setNetworkPaused: (paused: boolean) =>
    invoke<void>("set_network_paused", { paused }),
  networkIsPaused: () => invoke<boolean>("network_is_paused"),

  blockOrigin: (origin: string) =>
    invoke<BlockedOrigin>("block_origin", { origin }),
  unblockOrigin: (origin: string) =>
    invoke<void>("unblock_origin", { origin }),
  listBlockedOrigins: () =>
    invoke<BlockedOrigin[]>("list_blocked_origins"),
  adBlockingEnabled: () => invoke<boolean>("ad_blocking_enabled"),
  setAdBlocking: (enabled: boolean) =>
    invoke<void>("set_ad_blocking", { enabled }),

  listArtifacts: () => invoke<Artifact[]>("list_artifacts"),
  getArtifact: (id: number) => invoke<Artifact>("get_artifact", { id }),
  deleteArtifact: (id: number) => invoke<void>("delete_artifact", { id }),
  saveCurrentTab: (tabId: string) =>
    invoke<number>("save_current_tab", { tabId }),
  clipSelection: (tabId: string) =>
    invoke<number>("clip_selection", { tabId }),
  getNotesDir: () => invoke<string | null>("get_notes_dir"),
  createNote: (title: string, sourceUrl: string) =>
    invoke<Artifact>("create_note", { title, sourceUrl }),
  updateNote: (id: number, title: string, markdown: string) =>
    invoke<Artifact | null>("update_note", { id, title, markdown }),
  listFavicons: () => invoke<Favicon[]>("get_favicons"),
  groupBookmarks: (target: number, dragged: number) =>
    invoke<void>("group_bookmarks", { target, dragged }),
  moveBookmark: (id: number, parent: number | null) =>
    invoke<void>("move_bookmark", { id, parent }),
  setTabCornerRadius: (radius: number) =>
    invoke<void>("set_tab_corner_radius", { radius }),
  setTabZoom: (id: string, factor: number) =>
    invoke<void>("set_tab_zoom", { id, factor }),
  setWindowTheme: (mode: "light" | "dark") =>
    invoke<void>("set_window_theme", { mode }),
  openTabDevtools: (id: string) =>
    invoke<void>("open_tab_devtools", { id }),
  setGlassMaterial: (appearance: "light" | "dark", level: string) =>
    invoke<void>("set_glass_material", { appearance, level }),

  searchGetInstance: () => invoke<string | null>("search_get_instance"),
  searchSetInstance: (url: string) =>
    invoke<void>("search_set_instance", { url }),
  searchClearInstance: () => invoke<void>("search_clear_instance"),
  searchWeb: (query: string) =>
    invoke<SearchResult[]>("search_web", { query }),
};
