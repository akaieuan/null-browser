import { Channel, invoke } from "@tauri-apps/api/core";

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

export type ProviderStatus = {
  anthropic: boolean;
  openai: boolean;
  ollama: boolean;
};

export type OllamaModel = {
  name: string;
};

export type OllamaStatus = {
  running: boolean;
  models: OllamaModel[];
};

export type Artifact = {
  id: number;
  kind: string;
  title: string;
  source_url: string;
  source_title: string | null;
  markdown: string;
  model: string;
  created_at: number;
};

export type ArtifactEvent =
  | { kind: "extracted"; title: string; url: string }
  | { kind: "chunk"; text: string }
  | { kind: "saved"; id: number }
  | { kind: "error"; message: string };

export type ChatEvent =
  | { kind: "grounded"; title: string; url: string }
  | { kind: "chunk"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type Conversation = {
  id: number;
  title: string;
  page_url: string | null;
  page_title: string | null;
  created_at: number;
  updated_at: number;
};

export type ChatMessageRow = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model: string | null;
  created_at: number;
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
  clearTabStorage: () => invoke<void>("clear_tab_storage"),

  listBookmarks: () => invoke<Bookmark[]>("list_bookmarks"),
  addBookmark: (url: string, title: string) =>
    invoke<Bookmark>("add_bookmark", { url, title }),
  removeBookmark: (id: number) => invoke<void>("remove_bookmark", { id }),
  updateBookmark: (id: number, url: string, title: string) =>
    invoke<void>("update_bookmark", { id, url, title }),
  removeBookmarkByUrl: (url: string) =>
    invoke<void>("remove_bookmark_by_url", { url }),
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

  aiSetKey: (provider: string, key: string) =>
    invoke<void>("ai_set_key", { provider, key }),
  aiProviderStatus: () => invoke<ProviderStatus>("ai_provider_status"),
  aiOllamaStatus: () => invoke<OllamaStatus>("ai_ollama_status"),
  aiSend: (
    provider: string,
    model: string,
    prompt: string,
    conversationId: number | null,
    onChunk: Channel<string>,
  ) =>
    invoke<string>("ai_send", {
      provider,
      model,
      prompt,
      conversationId,
      onChunk,
    }),

  chatCreateConversation: (
    title: string,
    pageUrl: string | null,
    pageTitle: string | null,
  ) =>
    invoke<Conversation>("chat_create_conversation", {
      title,
      pageUrl,
      pageTitle,
    }),
  chatListConversations: () =>
    invoke<Conversation[]>("chat_list_conversations"),
  chatGetMessages: (conversationId: number) =>
    invoke<ChatMessageRow[]>("chat_get_messages", { conversationId }),
  chatRenameConversation: (id: number, title: string) =>
    invoke<void>("chat_rename_conversation", { id, title }),
  chatDeleteConversation: (id: number) =>
    invoke<void>("chat_delete_conversation", { id }),

  listArtifacts: () => invoke<Artifact[]>("list_artifacts"),
  getArtifact: (id: number) => invoke<Artifact>("get_artifact", { id }),
  deleteArtifact: (id: number) => invoke<void>("delete_artifact", { id }),
  summarizeCurrentTab: (
    tabId: string,
    provider: string,
    model: string,
    focus: string | null,
    onEvent: Channel<ArtifactEvent>,
  ) =>
    invoke<number>("summarize_current_tab", {
      tabId,
      provider,
      model,
      focus,
      onEvent,
    }),
  saveCurrentTab: (tabId: string) =>
    invoke<number>("save_current_tab", { tabId }),
  chatWithPage: (
    tabId: string,
    provider: string,
    model: string,
    prompt: string,
    conversationId: number | null,
    onEvent: Channel<ChatEvent>,
  ) =>
    invoke<string>("chat_with_page", {
      tabId,
      provider,
      model,
      prompt,
      conversationId,
      onEvent,
    }),

  searchGetInstance: () => invoke<string | null>("search_get_instance"),
  searchSetInstance: (url: string) =>
    invoke<void>("search_set_instance", { url }),
  searchClearInstance: () => invoke<void>("search_clear_instance"),
  searchWeb: (query: string) =>
    invoke<SearchResult[]>("search_web", { query }),
};

export { Channel };
