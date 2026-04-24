import { invoke } from "@tauri-apps/api/core";

export type Bookmark = {
  id: number;
  url: string;
  title: string;
  created_at: number;
};

export type HistoryEntry = {
  id: number;
  url: string;
  title: string;
  visited_at: number;
};

export const ipc = {
  getAppVersion: () => invoke<string>("get_app_version"),

  openTab: (id: string, url: string, top: number) =>
    invoke<void>("open_tab", { id, url, top }),
  closeTab: (id: string) => invoke<void>("close_tab", { id }),
  activateTab: (id: string) => invoke<void>("activate_tab", { id }),
  hideAllTabs: () => invoke<void>("hide_all_tabs"),
  navigateTab: (id: string, url: string) =>
    invoke<void>("navigate_tab", { id, url }),

  resizeContent: (top: number, width: number, height: number) =>
    invoke<void>("resize_content", { top, width, height }),

  goBack: (id: string) => invoke<void>("go_back", { id }),
  goForward: (id: string) => invoke<void>("go_forward", { id }),
  reload: (id: string) => invoke<void>("reload", { id }),

  listBookmarks: () => invoke<Bookmark[]>("list_bookmarks"),
  addBookmark: (url: string, title: string) =>
    invoke<Bookmark>("add_bookmark", { url, title }),
  removeBookmark: (id: number) => invoke<void>("remove_bookmark", { id }),
  removeBookmarkByUrl: (url: string) =>
    invoke<void>("remove_bookmark_by_url", { url }),
  reorderBookmarks: (orderedIds: number[]) =>
    invoke<void>("reorder_bookmarks", { orderedIds }),

  listHistory: (limit?: number) =>
    invoke<HistoryEntry[]>("list_history", { limit }),
  addHistory: (url: string, title: string) =>
    invoke<void>("add_history", { url, title }),
  removeHistory: (id: number) => invoke<void>("remove_history", { id }),
  clearHistory: () => invoke<void>("clear_history"),
};
