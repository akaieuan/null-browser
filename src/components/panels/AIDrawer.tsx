import {
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  FileText,
  MessageSquare,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { AI_DRAWER_WIDTH } from "@/lib/layout";
import {
  Channel,
  ipc,
  type Artifact,
  type ArtifactEvent,
  type ChatEvent,
  type OllamaStatus,
  type ProviderStatus,
  type SearchResult,
} from "@/lib/ipc";
import { cn } from "@/lib/utils";

export { AI_DRAWER_WIDTH };

type ConnectionStatus = "disconnected" | "connecting" | "connected";

type Mode = "chat" | "summarize" | "search" | "save";

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "error"; content: string }
  | { role: "saved"; artifactId: number; title: string }
  | { role: "status"; content: string }
  | { role: "search_query"; content: string }
  | { role: "search_results"; query: string; results: SearchResult[] };

type View = "chat" | "artifacts";

type ActiveTab = { id: string; url: string; title: string } | null;

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

// Ollama is the local default. Anthropic is the cloud fallback when no
// daemon is running and a key is set. Order matters — `pickDefault`
// walks providers and picks the first one that's actually usable.
type ProviderId = "ollama" | "anthropic";

const PROVIDER_PREF_KEY = "null:ai:provider";
const MODEL_PREF_KEY = "null:ai:model";

function readSavedProvider(): ProviderId | null {
  try {
    const v = localStorage.getItem(PROVIDER_PREF_KEY);
    return v === "ollama" || v === "anthropic" ? v : null;
  } catch {
    return null;
  }
}

function readSavedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_PREF_KEY);
  } catch {
    return null;
  }
}

function persistChoice(provider: ProviderId, model: string) {
  try {
    localStorage.setItem(PROVIDER_PREF_KEY, provider);
    localStorage.setItem(MODEL_PREF_KEY, model);
  } catch {
    /* swallow — choices fall back to detection on next launch */
  }
}

function pickDefault(
  ollama: OllamaStatus | null,
  status: ProviderStatus | null,
): { provider: ProviderId; model: string } | null {
  const savedProvider = readSavedProvider();
  const savedModel = readSavedModel();

  // Honor a saved choice if it's still usable.
  if (savedProvider === "ollama" && ollama?.running && ollama.models.length) {
    const stillThere = ollama.models.find((m) => m.name === savedModel);
    return {
      provider: "ollama",
      model: stillThere?.name ?? ollama.models[0].name,
    };
  }
  if (savedProvider === "anthropic" && status?.anthropic) {
    return {
      provider: "anthropic",
      model: savedModel || ANTHROPIC_DEFAULT_MODEL,
    };
  }

  // No usable saved choice — default to local if available.
  if (ollama?.running && ollama.models.length > 0) {
    return { provider: "ollama", model: ollama.models[0].name };
  }
  if (status?.anthropic) {
    return { provider: "anthropic", model: ANTHROPIC_DEFAULT_MODEL };
  }
  return null;
}

const MODE_META: Record<
  Mode,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string }
> = {
  chat: { icon: MessageSquare, label: "Chat" },
  summarize: { icon: Sparkles, label: "Summarize" },
  search: { icon: SearchIcon, label: "Search" },
  save: { icon: BookmarkPlus, label: "Save" },
};

const MODES: Mode[] = ["chat", "summarize", "search", "save"];

export function AIDrawer({
  onClose,
  activeTab,
}: {
  onClose: () => void;
  activeTab: ActiveTab;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [model, setModel] = useState<string>("");
  const [view, setView] = useState<View>("chat");
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [openArtifact, setOpenArtifact] = useState<Artifact | null>(null);
  const [searchInstance, setSearchInstance] = useState<string | null>(null);

  const refreshProviders = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([
        ipc.aiProviderStatus(),
        ipc
          .aiOllamaStatus()
          .catch(() => ({ running: false, models: [] }) as OllamaStatus),
      ]);
      setStatus(s);
      setOllama(o);
      const picked = pickDefault(o, s);
      if (picked) {
        // Only auto-pick if user hasn't already chosen — never silently
        // change provider/model out from under an in-flight conversation.
        setProvider((cur) => cur ?? picked.provider);
        setModel((cur) => cur || picked.model);
      }
    } catch {
      setStatus({ anthropic: false, openai: false, ollama: false });
      setOllama({ running: false, models: [] });
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
    ipc
      .searchGetInstance()
      .then(setSearchInstance)
      .catch(() => setSearchInstance(null));
  }, [refreshProviders]);

  // Persist any user-driven change so it survives a relaunch.
  useEffect(() => {
    if (provider && model) persistChoice(provider, model);
  }, [provider, model]);

  const refreshArtifacts = useCallback(() => {
    ipc.listArtifacts().then(setArtifacts).catch(() => {});
  }, []);

  useEffect(() => {
    refreshArtifacts();
  }, [refreshArtifacts]);

  // "Ready" means we have a usable provider+model for AI modes. Ollama
  // running without any installed models still counts as not-ready —
  // the daemon can't answer with no model loaded.
  const hasOllama =
    !!ollama?.running && ollama.models.length > 0;
  const hasAnyKey =
    !!status && (status.anthropic || status.openai);
  const aiReady = hasOllama || hasAnyKey;
  const providerReady =
    !!provider && !!model && (provider !== "anthropic" || !!status?.anthropic);
  const needsAi = mode === "chat" || mode === "summarize";
  const needsSearchInstance = mode === "search";
  const needsTab =
    mode === "summarize" || mode === "save" || (mode === "chat" && false);
  const connStatus: ConnectionStatus = busy
    ? "connecting"
    : providerReady
      ? "connected"
      : "disconnected";

  const openArtifactById = useCallback(async (id: number) => {
    try {
      const a = await ipc.getArtifact(id);
      setOpenArtifact(a);
      setView("artifacts");
    } catch {
      /* swallow */
    }
  }, []);

  const removeArtifact = async (id: number) => {
    try {
      await ipc.deleteArtifact(id);
      setArtifacts((xs) => xs.filter((a) => a.id !== id));
      if (openArtifact?.id === id) setOpenArtifact(null);
    } catch {
      /* swallow */
    }
  };

  const doChat = async (prompt: string) => {
    if (!provider || !model) return;
    setMessages((m) => [
      ...m,
      { role: "user", content: prompt },
      { role: "assistant", content: "" },
    ]);
    setDraft("");
    setBusy(true);

    try {
      if (activeTab) {
        const onEvent = new Channel<ChatEvent>();
        onEvent.onmessage = (evt) => {
          if (evt.kind === "grounded") {
            /* context chip already reflects the live tab */
          } else if (evt.kind === "chunk") {
            setMessages((m) => appendAssistantText(m, evt.text));
          } else if (evt.kind === "done") {
            /* stream finished */
          } else if (evt.kind === "error") {
            setMessages((m) => {
              const without = dropTrailingEmptyAssistant(m);
              return [...without, { role: "error", content: evt.message }];
            });
          }
        };
        await ipc.chatWithPage(activeTab.id, provider, model, prompt, onEvent);
      } else {
        const onChunk = new Channel<string>();
        onChunk.onmessage = (text) => {
          setMessages((m) => appendAssistantText(m, text));
        };
        await ipc.aiSend(provider, model, prompt, onChunk);
      }
    } catch (e) {
      setMessages((m) => {
        const without = dropTrailingEmptyAssistant(m);
        return [...without, { role: "error", content: String(e) }];
      });
    } finally {
      setBusy(false);
    }
  };

  const doSummarize = async (focus: string) => {
    if (!activeTab) return;
    setBusy(true);
    const preview = focus.trim()
      ? `Summarizing "${activeTab.title}" with focus on: ${focus.trim()}`
      : `Summarizing "${activeTab.title}"…`;
    setMessages((m) => [
      ...m,
      { role: "status", content: preview },
      { role: "assistant", content: "" },
    ]);
    setDraft("");

    const onEvent = new Channel<ArtifactEvent>();
    onEvent.onmessage = (evt) => {
      if (evt.kind === "extracted") {
        /* status already shown */
      } else if (evt.kind === "chunk") {
        setMessages((m) => appendAssistantText(m, evt.text));
      } else if (evt.kind === "saved") {
        ipc
          .getArtifact(evt.id)
          .then((a) => {
            setMessages((m) => [
              ...m,
              { role: "saved", artifactId: a.id, title: a.title },
            ]);
            refreshArtifacts();
          })
          .catch(() => {});
      } else if (evt.kind === "error") {
        setMessages((m) => {
          const without = dropTrailingEmptyAssistant(m);
          return [...without, { role: "error", content: evt.message }];
        });
      }
    };

    try {
      if (!provider || !model) return;
      await ipc.summarizeCurrentTab(
        activeTab.id,
        provider,
        model,
        focus.trim() || null,
        onEvent,
      );
    } catch {
      /* error event already pushed */
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (!activeTab) return;
    setBusy(true);
    try {
      const id = await ipc.saveCurrentTab(activeTab.id);
      const a = await ipc.getArtifact(id);
      refreshArtifacts();
      setOpenArtifact(a);
      setView("artifacts");
    } catch (e) {
      setMessages((m) => [...m, { role: "error", content: String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const doSearch = async (query: string) => {
    setMessages((m) => [
      ...m,
      { role: "search_query", content: query },
      { role: "status", content: `Searching the web…` },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const results = await ipc.searchWeb(query);
      setMessages((m) => {
        const without = dropTrailingStatus(m);
        return [...without, { role: "search_results", query, results }];
      });
    } catch (e) {
      setMessages((m) => {
        const without = dropTrailingStatus(m);
        return [...without, { role: "error", content: String(e) }];
      });
    } finally {
      setBusy(false);
    }
  };

  const onSend = () => {
    const text = draft.trim();
    if (busy) return;
    if (mode === "chat") {
      if (!text || !providerReady) return;
      void doChat(text);
    } else if (mode === "summarize") {
      if (!activeTab || !providerReady) return;
      void doSummarize(draft);
    } else if (mode === "search") {
      if (!text || !searchInstance) return;
      void doSearch(text);
    } else if (mode === "save") {
      if (!activeTab) return;
      void doSave();
    }
  };

  const canSend = useMemo(() => {
    if (busy) return false;
    if (mode === "chat") return !!draft.trim() && providerReady;
    if (mode === "summarize") return !!activeTab && providerReady;
    if (mode === "search") return !!draft.trim() && !!searchInstance;
    if (mode === "save") return !!activeTab;
    return false;
  }, [busy, mode, draft, providerReady, activeTab, searchInstance]);

  const modeBlockedReason = useMemo(() => {
    if (needsAi && !providerReady) {
      return aiReady
        ? "Pick a provider and model to use this mode."
        : "Run Ollama or add a provider key to use this mode.";
    }
    if (needsSearchInstance && !searchInstance) return null; // handled inline
    if (needsTab && !activeTab) return "Open a page first.";
    return null;
  }, [needsAi, providerReady, aiReady, needsSearchInstance, searchInstance, needsTab, activeTab]);

  return (
    <aside
      className="z-30 flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width: AI_DRAWER_WIDTH }}
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <StatusDot status={connStatus} />
          <ViewToggle
            value={view}
            onChange={(v) => {
              setView(v);
              setOpenArtifact(null);
            }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Chat"
          onClick={onClose}
          className="h-7 w-7"
        >
          <X size={14} strokeWidth={1.5} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === "chat" ? (
          needsAi && !aiReady ? (
            <EmptyState
              ollama={ollama}
              onKeySaved={() => void refreshProviders()}
            />
          ) : (
            <ChatLog
              messages={messages}
              pending={busy}
              onOpenArtifact={openArtifactById}
            />
          )
        ) : openArtifact ? (
          <ArtifactViewer
            artifact={openArtifact}
            onBack={() => setOpenArtifact(null)}
            onDelete={() => removeArtifact(openArtifact.id)}
          />
        ) : (
          <ArtifactList
            artifacts={artifacts}
            onOpen={setOpenArtifact}
            onDelete={removeArtifact}
          />
        )}
      </div>

      {view === "chat" && (
        <div className="shrink-0 p-3">
          <ModePicker value={mode} onChange={setMode} />
          <div className="mt-2">
            <InputArea
              mode={mode}
              draft={draft}
              setDraft={setDraft}
              onSend={onSend}
              canSend={canSend}
              busy={busy}
              activeTab={activeTab}
              providerReady={providerReady}
              provider={provider}
              model={model}
              ollama={ollama}
              status={status}
              onProviderModelChange={(p, m) => {
                setProvider(p);
                setModel(m);
              }}
              searchInstance={searchInstance}
              onSearchInstanceChange={setSearchInstance}
              blockedReason={modeBlockedReason}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

function appendAssistantText(m: Message[], text: string): Message[] {
  const copy = [...m];
  const last = copy[copy.length - 1];
  if (last && last.role === "assistant") {
    copy[copy.length - 1] = { ...last, content: last.content + text };
  }
  return copy;
}

function dropTrailingEmptyAssistant(m: Message[]): Message[] {
  const copy = [...m];
  while (copy.length > 0) {
    const last = copy[copy.length - 1];
    if (
      (last.role === "assistant" && last.content === "") ||
      last.role === "status"
    ) {
      copy.pop();
      continue;
    }
    break;
  }
  return copy;
}

function dropTrailingStatus(m: Message[]): Message[] {
  const copy = [...m];
  while (copy.length > 0 && copy[copy.length - 1].role === "status") {
    copy.pop();
  }
  return copy;
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Working"
        : "No model connected";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "connecting" && "animate-pulse bg-amber-500",
        status === "disconnected" && "bg-red-500",
      )}
    />
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5 text-xs">
      {(["chat", "artifacts"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full px-2.5 py-0.5 capitalize transition-colors",
            value === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function ModePicker({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-muted/20 p-0.5 text-[11px]">
      {MODES.map((m) => {
        const { icon: Icon, label } = MODE_META[m];
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={11} strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function InputArea({
  mode,
  draft,
  setDraft,
  onSend,
  canSend,
  busy,
  activeTab,
  providerReady,
  provider,
  model,
  ollama,
  status,
  onProviderModelChange,
  searchInstance,
  onSearchInstanceChange,
  blockedReason,
}: {
  mode: Mode;
  draft: string;
  setDraft: (s: string) => void;
  onSend: () => void;
  canSend: boolean;
  busy: boolean;
  activeTab: ActiveTab;
  providerReady: boolean;
  provider: ProviderId | null;
  model: string;
  ollama: OllamaStatus | null;
  status: ProviderStatus | null;
  onProviderModelChange: (provider: ProviderId, model: string) => void;
  searchInstance: string | null;
  onSearchInstanceChange: (s: string | null) => void;
  blockedReason: string | null;
}) {
  if (mode === "search" && !searchInstance) {
    return (
      <SearchInstanceSetup
        onSaved={(url) => onSearchInstanceChange(url)}
      />
    );
  }

  if (mode === "save") {
    return (
      <div className="flex flex-col gap-1.5">
        <ProviderLine
          mode={mode}
          activeTab={activeTab}
          provider={provider}
          model={model}
          ollama={ollama}
          status={status}
          onProviderModelChange={onProviderModelChange}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            "flex h-9 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted/40 text-sm text-foreground transition-colors",
            canSend
              ? "hover:bg-muted"
              : "cursor-not-allowed opacity-40",
          )}
        >
          <BookmarkPlus size={14} strokeWidth={1.75} />
          {busy ? "Saving…" : "Save this page"}
        </button>
        {blockedReason && (
          <div className="px-1 text-[11px] text-muted-foreground">
            {blockedReason}
          </div>
        )}
      </div>
    );
  }

  const placeholder = placeholderFor(mode, activeTab);
  const inputDisabled =
    busy ||
    ((mode === "chat" || mode === "summarize") && !providerReady);

  return (
    <div className="flex flex-col gap-1.5">
      <ProviderLine
        mode={mode}
        activeTab={activeTab}
        searchInstance={searchInstance}
        provider={provider}
        model={model}
        ollama={ollama}
        status={status}
        onProviderModelChange={onProviderModelChange}
      />
      <div className="rounded-2xl border border-border bg-muted/20 px-3 py-2.5 transition-colors focus-within:border-ring focus-within:bg-muted/40">
        <textarea
          disabled={inputDisabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="mt-1.5 flex items-center justify-end">
          <button
            type="button"
            disabled={!canSend}
            onClick={onSend}
            aria-label="Send"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ArrowUp size={12} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {blockedReason && (
        <div className="px-1 text-[11px] text-muted-foreground">
          {blockedReason}
        </div>
      )}
    </div>
  );
}

function placeholderFor(mode: Mode, activeTab: ActiveTab): string {
  if (mode === "chat") {
    return activeTab ? "Ask about this page…" : "Ask anything…";
  }
  if (mode === "summarize") {
    return "Focus on… (optional)";
  }
  if (mode === "search") {
    return "Search the web…";
  }
  return "";
}

function ProviderLine({
  mode,
  activeTab,
  searchInstance,
  provider,
  model,
  ollama,
  status,
  onProviderModelChange,
}: {
  mode: Mode;
  activeTab: ActiveTab;
  searchInstance?: string | null;
  provider: ProviderId | null;
  model: string;
  ollama: OllamaStatus | null;
  status: ProviderStatus | null;
  onProviderModelChange: (provider: ProviderId, model: string) => void;
}) {
  if (mode === "search") {
    if (!searchInstance) return null;
    let host = searchInstance;
    try {
      host = new URL(searchInstance).hostname;
    } catch {
      /* keep raw */
    }
    return (
      <div className="flex items-center justify-between px-1 text-[11px] text-subtle">
        <span>via {host}</span>
      </div>
    );
  }
  if (mode === "save") {
    return (
      <div className="flex items-center justify-between px-1 text-[11px] text-subtle">
        <span>local only · no AI</span>
        {activeTab && <PageChip activeTab={activeTab} />}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-subtle">
      <ProviderPicker
        provider={provider}
        model={model}
        ollama={ollama}
        status={status}
        onChange={onProviderModelChange}
      />
      {(mode === "chat" || mode === "summarize") && activeTab && (
        <PageChip activeTab={activeTab} />
      )}
    </div>
  );
}

function ProviderPicker({
  provider,
  model,
  ollama,
  status,
  onChange,
}: {
  provider: ProviderId | null;
  model: string;
  ollama: OllamaStatus | null;
  status: ProviderStatus | null;
  onChange: (provider: ProviderId, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const ollamaModels = ollama?.running ? ollama.models : [];
  const anthropicAvailable = !!status?.anthropic;
  const noOptions = ollamaModels.length === 0 && !anthropicAvailable;

  const label = provider && model ? `${provider} · ${model}` : "no provider";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={noOptions}
        className={cn(
          "flex max-w-[220px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-colors",
          noOptions
            ? "cursor-not-allowed text-subtle"
            : "text-foreground hover:bg-muted/60",
        )}
        title={noOptions ? "Run Ollama or add a provider key" : "Switch provider / model"}
      >
        <span className="truncate">{label}</span>
        {!noOptions && <ChevronDown size={10} strokeWidth={1.75} />}
      </button>
      {open && !noOptions && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          {ollamaModels.length > 0 && (
            <div className="border-b border-border last:border-b-0">
              <div className="px-2.5 pt-2 text-[10px] uppercase tracking-wider text-subtle">
                Ollama · local
              </div>
              <div className="py-1">
                {ollamaModels.map((m) => {
                  const active = provider === "ollama" && model === m.name;
                  return (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => {
                        onChange("ollama", m.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between px-2.5 py-1 text-left text-xs transition-colors",
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{m.name}</span>
                      {active && <span className="text-[10px]">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {anthropicAvailable && (
            <div>
              <div className="px-2.5 pt-2 text-[10px] uppercase tracking-wider text-subtle">
                Anthropic · cloud
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    onChange("anthropic", ANTHROPIC_DEFAULT_MODEL);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-2.5 py-1 text-left text-xs transition-colors",
                    provider === "anthropic"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="truncate">{ANTHROPIC_DEFAULT_MODEL}</span>
                  {provider === "anthropic" && <span className="text-[10px]">●</span>}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageChip({ activeTab }: { activeTab: NonNullable<ActiveTab> }) {
  const host = useMemo(() => {
    try {
      return new URL(activeTab.url).hostname.replace(/^www\./, "");
    } catch {
      return activeTab.url;
    }
  }, [activeTab.url]);
  return (
    <span
      className="max-w-[55%] truncate text-foreground"
      title={`Using: ${activeTab.title}\n${activeTab.url}`}
    >
      Using: {activeTab.title || host}
    </span>
  );
}

function SearchInstanceSetup({
  onSaved,
}: {
  onSaved: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await ipc.searchSetInstance(trimmed);
      onSaved(trimmed);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/20 p-3 text-xs">
      <div className="text-foreground">Point at a SearXNG instance</div>
      <div className="text-muted-foreground">
        Self-hosted or a public one you trust. Nothing ships pre-configured.
      </div>
      <input
        type="url"
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="https://searx.example.com"
        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
      />
      <Button
        size="sm"
        onClick={() => void save()}
        disabled={saving || !url.trim()}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      {error && <div className="text-red-500">{error}</div>}
    </div>
  );
}

function ChatLog({
  messages,
  pending,
  onOpenArtifact,
}: {
  messages: Message[];
  pending: boolean;
  onOpenArtifact: (id: number) => void;
}) {
  if (messages.length === 0 && !pending) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
        Pick a mode below and go.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-3 py-4 text-sm">
      {messages.map((m, i) => {
        const isLast = i === messages.length - 1;
        if (m.role === "saved") {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpenArtifact(m.artifactId)}
              className="flex max-w-[85%] items-center gap-2 self-start rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FileText size={12} strokeWidth={1.5} />
              <span className="truncate">Saved · {m.title || "Untitled"}</span>
            </button>
          );
        }
        if (m.role === "status") {
          return (
            <div
              key={i}
              className="self-start px-1 text-xs text-muted-foreground"
            >
              {m.content}
            </div>
          );
        }
        if (m.role === "search_query") {
          return (
            <div
              key={i}
              className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2 text-foreground"
            >
              <span className="text-[11px] text-muted-foreground">Search · </span>
              {m.content}
            </div>
          );
        }
        if (m.role === "search_results") {
          return <SearchResultList key={i} results={m.results} />;
        }
        const showWaitingDot =
          isLast && pending && m.role === "assistant" && m.content === "";
        return (
          <div
            key={i}
            className={cn(
              "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2",
              m.role === "user" && "self-end bg-muted text-foreground",
              m.role === "assistant" && "self-start text-foreground",
              m.role === "error" && "self-start text-red-500",
            )}
          >
            {showWaitingDot ? (
              <span className="text-muted-foreground">…</span>
            ) : (
              m.content
            )}
          </div>
        );
      })}
    </div>
  );
}

function SearchResultList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <div className="self-start px-1 text-xs text-muted-foreground">
        No results.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {results.slice(0, 10).map((r, i) => (
        <SearchResultCard key={i} result={r} />
      ))}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const host = useMemo(() => {
    try {
      return new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      return result.url;
    }
  }, [result.url]);
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40"
    >
      <div className="text-[11px] text-muted-foreground">{host}</div>
      <div className="truncate text-sm text-foreground">{result.title || result.url}</div>
      {result.snippet && (
        <div className="line-clamp-2 text-xs text-muted-foreground">
          {result.snippet}
        </div>
      )}
    </a>
  );
}

function ArtifactList({
  artifacts,
  onOpen,
  onDelete,
}: {
  artifacts: Artifact[];
  onOpen: (a: Artifact) => void;
  onDelete: (id: number) => void;
}) {
  if (artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted-foreground">
        <div className="text-foreground">No artifacts yet.</div>
        <div className="text-xs">
          Switch to <span className="text-foreground">Summarize</span> or{" "}
          <span className="text-foreground">Save</span> below to capture a page.
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {artifacts.map((a) => (
        <ArtifactRow
          key={a.id}
          artifact={a}
          onOpen={() => onOpen(a)}
          onDelete={() => onDelete(a.id)}
        />
      ))}
    </div>
  );
}

function ArtifactRow({
  artifact,
  onOpen,
  onDelete,
}: {
  artifact: Artifact;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const host = useMemo(() => {
    try {
      return new URL(artifact.source_url).hostname.replace(/^www\./, "");
    } catch {
      return artifact.source_url;
    }
  }, [artifact.source_url]);
  const when = useMemo(() => relativeTime(artifact.created_at), [artifact.created_at]);
  const kindLabel = artifact.kind === "clip" ? "Clip" : "Summary";
  return (
    <div className="group flex items-start gap-2 border-b border-border px-3 py-2.5 hover:bg-muted/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <div className="w-full truncate text-sm text-foreground">
          {artifact.title || "Untitled"}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{kindLabel}</span>
          <span>·</span>
          <span className="truncate">{host}</span>
          <span>·</span>
          <span>{when}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete artifact"
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function ArtifactViewer({
  artifact,
  onBack,
  onDelete,
}: {
  artifact: Artifact;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={onBack}
          className="h-7 w-7"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm text-foreground">
            {artifact.title || "Untitled"}
          </div>
          <a
            href={artifact.source_url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[11px] text-muted-foreground hover:text-foreground"
          >
            {artifact.source_url}
          </a>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete"
          onClick={onDelete}
          className="h-7 w-7"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {artifact.markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const markdownComponents = {
  h1: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-4 text-lg font-semibold text-foreground" {...props} />
  ),
  h2: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-foreground" {...props} />
  ),
  h3: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold text-foreground" {...props} />
  ),
  p: (props: React.HTMLProps<HTMLParagraphElement>) => (
    <p className="mb-3 text-foreground" {...props} />
  ),
  ul: (props: React.HTMLProps<HTMLUListElement>) => (
    <ul className="mb-3 ml-5 list-disc space-y-1" {...props} />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-3 ml-5 list-decimal space-y-1" {...props} />
  ),
  li: (props: React.HTMLProps<HTMLLIElement>) => (
    <li className="text-foreground" {...props} />
  ),
  blockquote: (props: React.HTMLProps<HTMLQuoteElement>) => (
    <blockquote
      className="mb-3 border-l-2 border-border pl-3 text-muted-foreground"
      {...props}
    />
  ),
  code: ({
    inline,
    ...props
  }: React.HTMLProps<HTMLElement> & { inline?: boolean }) =>
    inline ? (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      />
    ) : (
      <code className="block font-mono text-[0.85em]" {...props} />
    ),
  pre: (props: React.HTMLProps<HTMLPreElement>) => (
    <pre
      className="mb-3 overflow-x-auto rounded-md bg-muted p-3 text-xs"
      {...props}
    />
  ),
  a: (props: React.HTMLProps<HTMLAnchorElement>) => (
    <a
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline underline-offset-2 hover:no-underline"
      {...props}
    />
  ),
};

function relativeTime(epochSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epochSec * 1000).toLocaleDateString();
}

function EmptyState({
  ollama,
  onKeySaved,
}: {
  ollama: OllamaStatus | null;
  onKeySaved: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setSaving(true);
    setError(null);
    try {
      await ipc.aiSetKey("anthropic", key);
      setKeyInput("");
      setShowForm(false);
      onKeySaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Three distinct empty states, in priority order:
  //   1. Ollama running but no models — install one with `ollama pull`
  //   2. Ollama not running — install + run it (the local-first path)
  //   3. Both unavailable — same as (2), but offer Anthropic key as fallback
  const ollamaRunningNoModels =
    !!ollama?.running && ollama.models.length === 0;

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="text-[11px] uppercase tracking-[0.2em] text-subtle">
        local first
      </div>
      {ollamaRunningNoModels ? (
        <>
          <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Ollama is running but no models are installed.
          </div>
          <div className="mt-5 rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-[11px] text-foreground">
            ollama pull llama3.2
          </div>
          <div className="mt-3 text-[11px] text-subtle">
            Reopen this drawer once a model is installed.
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Run Ollama locally — or add a cloud-provider key.
          </div>
          <div className="mt-5 flex items-center gap-4 text-xs">
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Install Ollama
            </a>
            <span className="text-subtle">·</span>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showForm ? "Cancel" : "Add Anthropic key"}
            </button>
          </div>

          {showForm && (
            <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
              <input
                type="password"
                autoFocus
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                }}
                placeholder="sk-ant-…"
                className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              />
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={saving || !keyInput.trim()}
              >
                {saving ? "Saving…" : "Save Anthropic key"}
              </Button>
              <div className="text-[11px] leading-relaxed text-subtle">
                Stored in your OS keychain. Never written to disk or sent
                anywhere except api.anthropic.com when you send a message.
              </div>
              {error && <div className="text-xs text-red-500">{error}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
