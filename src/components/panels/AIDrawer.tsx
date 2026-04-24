import { ArrowUp, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AI_DRAWER_WIDTH } from "@/lib/layout";
import { ipc, type ProviderStatus } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export { AI_DRAWER_WIDTH };

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type Message = { role: "user" | "assistant" | "error"; content: string };

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export function AIDrawer({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    ipc.aiProviderStatus().then(setStatus).catch(() => setStatus({ anthropic: false, openai: false }));
  }, []);

  const hasKey = !!status && (status.anthropic || status.openai);
  const connStatus: ConnectionStatus = pending
    ? "connecting"
    : hasKey
      ? "connected"
      : "disconnected";

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || pending || !hasKey) return;
    setMessages((m) => [...m, { role: "user", content: prompt }]);
    setDraft("");
    setPending(true);
    try {
      const reply = await ipc.aiSend(DEFAULT_PROVIDER, DEFAULT_MODEL, prompt);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", content: String(e) }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside
      className="z-30 flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width: AI_DRAWER_WIDTH }}
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Chat</span>
          <StatusDot status={connStatus} />
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
        {!hasKey ? (
          <EmptyState onKeySaved={() => ipc.aiProviderStatus().then(setStatus)} />
        ) : (
          <ChatLog messages={messages} pending={pending} />
        )}
      </div>

      <div className="shrink-0 p-3">
        {hasKey && (
          <div className="mb-1.5 px-1 text-[11px] text-subtle">
            {DEFAULT_PROVIDER} · {DEFAULT_MODEL}
          </div>
        )}
        <div className="rounded-2xl border border-border bg-muted/20 px-3 py-2.5 transition-colors focus-within:border-ring focus-within:bg-muted/40">
          <textarea
            disabled={!hasKey || pending}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={hasKey ? "Ask anything" : "Add a provider key to start"}
            rows={1}
            className="block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-1.5 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasKey || pending || !draft.trim()}
              onClick={() => void send()}
              aria-label="Send"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
            >
              <ArrowUp size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting"
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

function ChatLog({ messages, pending }: { messages: Message[]; pending: boolean }) {
  if (messages.length === 0 && !pending) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
        Ask anything.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-3 py-4 text-sm">
      {messages.map((m, i) => (
        <div
          key={i}
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2",
            m.role === "user" && "self-end bg-muted text-foreground",
            m.role === "assistant" && "self-start text-foreground",
            m.role === "error" && "self-start text-red-500",
          )}
        >
          {m.content}
        </div>
      ))}
      {pending && <div className="self-start text-muted-foreground">…</div>}
    </div>
  );
}

function EmptyState({ onKeySaved }: { onKeySaved: () => void }) {
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

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="text-[11px] uppercase tracking-[0.2em] text-subtle">
        local first
      </div>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Run Ollama models or add provider keys.
      </div>
      <div className="mt-5 flex items-center gap-4 text-xs">
        <a
          href="https://ollama.com"
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
          {showForm ? "Cancel" : "Add provider key"}
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
            Stored in your OS keychain. Never written to disk or sent anywhere
            except api.anthropic.com when you send a message.
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
      )}
    </div>
  );
}
