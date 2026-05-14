'use client';

// PR Sprint 7.19 — Helm Chat System widget.
//
// Replaces the Sprint 7.15 stateless chat widget with a
// conversation-backed widget that:
//   - Loads (or creates) the user's active conversation on mount.
//   - Renders persistent history across page loads.
//   - Supports two modes: AI (Claude Haiku) and Agent (founder).
//   - Subscribes to Supabase Realtime so agent replies stream in
//     live without a refetch.
//
// Surface:
//   - 52px terracotta launcher button bottom-right.
//   - 340×480 Editorial Glass panel with:
//       Header: dot (green = AI, orange = Agent) + name ("Helm AI"
//       / "Helm Team") + subtitle + 2-option mode pill + close.
//       Body:   scrollable message list with user (terracotta),
//       assistant (glass), agent (glass + "Founder" tag) bubbles.
//       Footer: textarea + send button. Enter sends, Shift+Enter
//       newlines. Disabled while sending.
//   - Unread badge on the launcher when the panel is closed and
//     a new agent/assistant message arrives via Realtime.
//
// UX hotfix layer (post-Sprint-7.19):
//   1. Optimistic user bubble on every send so the message
//      appears immediately, before the API responds.
//   2. In Agent mode, every user send is followed by a local-
//      only system bubble ("We've received your message…") so
//      the user knows the message is queued for the founder.
//      The system bubble is purely client-side (never written
//      to chat_messages) and stays in place once shown.
//   3. Header re-skin: replaced the single "AI" / "Agent" toggle
//      button with a 2-option pill toggle that's always visible,
//      so the mode switch is discoverable. Adds dynamic name +
//      dot color + subtitle for the current mode.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Role = 'user' | 'assistant' | 'agent';
type Mode = 'ai' | 'agent';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /**
   * True for local-only system bubbles (e.g. the "We've received
   * your message" confirmation in Agent mode). MessageBubble
   * renders these with muted styling and never persists them.
   */
  system?: boolean;
}

interface Props {
  projectId: string | null;
}

const LS_OPEN_KEY = 'helm-chat-open';

const AGENT_CONFIRMATION =
  "We've received your message. We'll get back to you as soon as possible.";

export function ChatWidget({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('ai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Perf fix (Sprint 7.20) — lazy conversation load. The widget
  // pre-fix fetched /api/chat/conversation on mount (~6.8s
  // background blocking on every dashboard render). Now we defer
  // the fetch until the user actually opens the widget. `loading`
  // starts false because we have nothing to load yet; flips to
  // true the first time the panel opens and resets to false once
  // the conversation hydrates.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [switchingMode, setSwitchingMode] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Hydrate openness from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(window.localStorage.getItem(LS_OPEN_KEY) === '1');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LS_OPEN_KEY, open ? '1' : '0');
    if (open) setUnread(0);
  }, [open]);

  // Bootstrap: load or create the active conversation — but
  // ONLY after the user opens the widget for the first time.
  //
  // Perf fix (Sprint 7.20): pre-fix this effect ran on mount and
  // burned a ~6.8s network call in the background even when the
  // founder never clicked the launcher. Gating on `open` means
  // closed-widget renders cost nothing.
  //
  // The deps include `open` so the effect re-evaluates when it
  // flips true. The `conversationId === null` check is what
  // makes the body idempotent — we only fetch the first time
  // open turns true (subsequent opens just show the cached
  // history we already have in state).
  useEffect(() => {
    if (!open || conversationId !== null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/chat/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) {
          // Silently skip — most likely the user is not logged in
          // (widget is mounted in the dashboard layout, so this
          // shouldn't happen in practice, but be defensive).
          if (!cancelled) setError(null);
          return;
        }
        const data = (await res.json()) as {
          conversationId: string;
          mode: Mode;
          status: string;
          messages: ChatMessage[];
        };
        if (cancelled) return;
        setConversationId(data.conversationId);
        setMode(data.mode);
        setMessages(data.messages);
      } catch {
        if (!cancelled) setError('Could not load chat');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, projectId]);

  // Realtime subscription on the active conversation. Listens
  // for INSERTs on chat_messages filtered by conversation_id and
  // appends anything we don't already have locally.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            role: Role;
            content: string;
            created_at: string;
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                role: row.role,
                content: row.content,
                createdAt: row.created_at,
              },
            ];
          });
          // Bump unread when panel is closed and the incoming
          // message isn't the user's own.
          if (!openRef.current && row.role !== 'user') {
            setUnread((u) => u + 1);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { mode: Mode };
          setMode(row.mode);
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // Focus textarea when the panel opens.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || !conversationId) return;
    setInput('');
    setSending(true);
    setError(null);

    // Optimistic user bubble (renders immediately, before the
    // POST resolves). Realtime will deliver the persisted row in
    // a moment with a real id — we dedupe by id when it arrives.
    const tempId = `temp-user-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    // In Agent mode, immediately append a local-only confirmation
    // so the user knows their message is queued for the founder.
    // Purely client-side — never written to chat_messages.
    const isAgent = mode === 'agent';
    const systemId = `sys-${Date.now()}`;
    const systemBubble: ChatMessage | null = isAgent
      ? {
          id: systemId,
          role: 'assistant',
          content: AGENT_CONFIRMATION,
          createdAt: new Date().toISOString(),
          system: true,
        }
      : null;

    setMessages((prev) => [
      ...prev,
      optimistic,
      ...(systemBubble ? [systemBubble] : []),
    ]);

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, content: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        userMessage?: ChatMessage;
        assistantMessage?: ChatMessage | null;
        mode?: Mode;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Could not send message');
        // Roll back optimistic bubble + system confirmation.
        setMessages((prev) =>
          prev.filter((m) => m.id !== tempId && m.id !== systemId),
        );
        setInput(trimmed);
        return;
      }

      // Replace the temp user bubble with the real persisted row.
      // Keep the system confirmation in place (it's local-only).
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== tempId);
        const seen = new Set(next.map((m) => m.id));
        if (data.userMessage && !seen.has(data.userMessage.id)) {
          // Insert the real user message BEFORE the system
          // confirmation so the order reads:
          //   user → system → (assistant or agent reply)
          // instead of system → user.
          const sysIdx = next.findIndex((m) => m.id === systemId);
          if (sysIdx >= 0) {
            next.splice(sysIdx, 0, data.userMessage);
          } else {
            next.push(data.userMessage);
          }
        }
        if (
          data.assistantMessage &&
          !seen.has(data.assistantMessage.id)
        ) {
          next.push(data.assistantMessage);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setMessages((prev) =>
        prev.filter((m) => m.id !== tempId && m.id !== systemId),
      );
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, mode]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  /**
   * Switch to a specific mode (called by the pill toggle's two
   * buttons). Idempotent — clicking the current mode is a no-op.
   * Persists via PATCH /api/chat/conversation/[id]/mode; Realtime
   * also picks up the mode change so the admin inbox stays in
   * sync.
   */
  const setModeAndPersist = useCallback(
    async (next: Mode) => {
      if (!conversationId || switchingMode || next === mode) return;
      setSwitchingMode(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/chat/conversation/${conversationId}/mode`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: next }),
          },
        );
        if (!res.ok) {
          setError('Could not switch mode');
          return;
        }
        setMode(next);
      } catch {
        setError('Could not switch mode');
      } finally {
        setSwitchingMode(false);
      }
    },
    [conversationId, mode, switchingMode],
  );

  return (
    <>
      {/* Launcher — fixed bottom-right, 52px circle */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Helm chat"
          className="fixed bottom-4 right-4 z-40 w-[52px] h-[52px] rounded-full bg-accent text-white shadow-lg hover:bg-accent-hover transition-all hover:scale-105 flex items-center justify-center"
          style={{ boxShadow: '0 6px 24px rgba(196, 69, 32, 0.35)' }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 rounded-full bg-success text-white text-[11px] font-medium flex items-center justify-center px-1 border-2 border-bg">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          className="fixed z-40 glass-elevated rounded-2xl flex flex-col overflow-hidden border border-border-bright"
          style={{
            bottom: '1rem',
            right: '1rem',
            width: 'min(calc(100vw - 2rem), 340px)',
            height: 'min(calc(100vh - 2rem), 480px)',
          }}
          role="dialog"
          aria-label="Helm chat"
        >
          {/* Header: dot + name + subtitle + mode pill + close */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0 gap-3">
            <ModeIdentity mode={mode} />

            <div className="flex items-center gap-2 shrink-0">
              <ModePillToggle
                mode={mode}
                onSelect={setModeAndPersist}
                disabled={switchingMode || !conversationId}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-text-3 hover:text-text-1 text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
          >
            {loading && (
              <div className="text-xs text-text-3 text-center py-6">
                Loading…
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="text-xs text-text-3 text-center py-6 px-2">
                {mode === 'ai'
                  ? 'Ask anything about Helm, your brand, or content strategy.'
                  : "Send a message — we'll reply as soon as we can."}
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                system={m.system}
              />
            ))}
            {/* Typing indicator only meaningful in AI mode —
                Claude is "thinking" between send and response.
                Agent mode never shows it because the human-reply
                latency is hours, not seconds, and the local
                system bubble already conveyed the wait. */}
            {sending && mode === 'ai' && <TypingIndicator />}
          </div>

          {error && (
            <div className="px-3 py-2 border-t border-danger/30 bg-danger/10 text-[11px] text-danger shrink-0">
              {error}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border p-2 shrink-0 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                mode === 'ai' ? 'Ask Helm AI…' : 'Message the Helm team…'
              }
              rows={1}
              disabled={sending || loading || !conversationId}
              className="flex-1 resize-none bg-bg border border-border rounded-lg px-3 py-2 text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright disabled:opacity-50"
              style={{ maxHeight: 100 }}
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || loading || !input.trim() || !conversationId}
              aria-label="Send message"
              className="shrink-0 w-9 h-9 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12l14-7-5 14-2.5-6L5 12z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// Header subcomponents
// ============================================================

/**
 * Dot + name + subtitle. The dot color, name, and subtitle all
 * shift with mode:
 *   AI    → green dot · "Helm AI"   · "Instant AI replies"
 *   Agent → orange dot · "Helm Team" · "We'll reply as soon as possible"
 */
function ModeIdentity({ mode }: { mode: Mode }) {
  const isAi = mode === 'ai';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          background: isAi ? 'var(--success)' : '#F59E0B',
          boxShadow: isAi
            ? '0 0 8px rgba(52, 211, 153, 0.6)'
            : '0 0 8px rgba(245, 158, 11, 0.6)',
        }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="font-display text-sm font-medium leading-tight truncate">
          {isAi ? 'Helm AI' : 'Helm Team'}
        </div>
        <div className="text-[10px] text-text-3 leading-tight truncate">
          {isAi
            ? 'Instant AI replies'
            : "We'll reply as soon as possible"}
        </div>
      </div>
    </div>
  );
}

/**
 * Two-option pill toggle: both labels visible at all times.
 * Active = terracotta-filled, inactive = muted text. Click on
 * the inactive option triggers PATCH /mode via onSelect.
 */
function ModePillToggle({
  mode,
  onSelect,
  disabled,
}: {
  mode: Mode;
  onSelect: (next: Mode) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Conversation mode"
      className="flex items-center rounded-md border border-border bg-bg p-0.5"
    >
      <PillOption
        active={mode === 'ai'}
        onClick={() => onSelect('ai')}
        disabled={disabled}
        label="AI"
      />
      <PillOption
        active={mode === 'agent'}
        onClick={() => onSelect('agent')}
        disabled={disabled}
        label="AGENT"
      />
    </div>
  );
}

function PillOption({
  active,
  onClick,
  disabled,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'bg-accent text-white'
          : 'text-text-3 hover:text-text-1'
      }`}
    >
      {label}
    </button>
  );
}

// ============================================================
// Body subcomponents
// ============================================================

function MessageBubble({
  role,
  content,
  system,
}: {
  role: Role;
  content: string;
  system?: boolean;
}) {
  const isUser = role === 'user';
  const isAgent = role === 'agent';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {isAgent && !system && (
          <div className="text-[10px] uppercase tracking-wider text-text-3 mb-1 px-1">
            Founder
          </div>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : system
                ? 'bg-surface-1 text-text-3 border border-border italic rounded-bl-md'
                : isAgent
                  ? 'bg-surface-2 text-text-1 border border-accent/30 rounded-bl-md'
                  : 'bg-surface-2 text-text-1 border border-border rounded-bl-md'
          }`}
        >
          {content}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-2 border border-border rounded-2xl rounded-bl-md px-3 py-2 flex items-center gap-1">
        <span className="typing-dot" />
        <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
        <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
        <style jsx>{`
          .typing-dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--text-3);
            animation: helm-chat-dot 1.2s infinite ease-in-out;
          }
          @keyframes helm-chat-dot {
            0%,
            60%,
            100% {
              opacity: 0.3;
              transform: scale(0.85);
            }
            30% {
              opacity: 1;
              transform: scale(1.15);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
