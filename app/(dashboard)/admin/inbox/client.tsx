'use client';

// PR Sprint 7.19 — admin inbox client.
//
// Renders the two-column inbox:
//   - Conversation list (left) sorted by updatedAt desc.
//   - Active conversation transcript + reply composer (right).
//
// Realtime: one channel for the conversations table (so the
// list re-orders / shows new conversations live) and one channel
// per active conversation (so its message pane streams).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/skeleton';

type Mode = 'ai' | 'agent';
type Role = 'user' | 'assistant' | 'agent';

interface ConversationSummary {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  projectId: string | null;
  projectName: string | null;
  mode: Mode;
  status: string;
  updatedAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

interface ConversationDetail {
  conversationId: string;
  userId: string;
  projectId: string | null;
  mode: Mode;
  status: string;
  messages: ChatMessage[];
}

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const detailChannelRef = useRef<RealtimeChannel | null>(null);

  // Load the conversation list on mount.
  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/chat/admin/conversations');
      if (!res.ok) {
        setError('Could not load inbox');
        return;
      }
      const data = (await res.json()) as {
        conversations: ConversationSummary[];
      };
      setConversations(data.conversations);
      // Auto-select the first conversation on first load.
      setActiveId((prev) => prev ?? data.conversations[0]?.id ?? null);
    } catch {
      setError('Could not load inbox');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // List-level Realtime: bump the conversation we hear about up
  // to the top and refetch its summary so previews update. We
  // could patch the row in place, but a refetch is simpler and
  // the volume is low.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('inbox:conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
        },
        () => {
          void loadList();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        () => {
          void loadList();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadList]);

  // Load the active conversation detail when selection changes.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      setError(null);
      try {
        const res = await fetch(`/api/chat/conversation/${activeId}`);
        if (!res.ok) {
          if (!cancelled) setError('Could not load conversation');
          return;
        }
        const data = (await res.json()) as ConversationDetail;
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setError('Could not load conversation');
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Per-conversation Realtime: stream incoming messages into the
  // open transcript.
  useEffect(() => {
    if (!activeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox:${activeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            role: Role;
            content: string;
            created_at: string;
          };
          setDetail((prev) => {
            if (!prev || prev.conversationId !== activeId) return prev;
            if (prev.messages.some((m) => m.id === row.id)) return prev;
            return {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: row.id,
                  role: row.role,
                  content: row.content,
                  createdAt: row.created_at,
                },
              ],
            };
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_conversations',
          filter: `id=eq.${activeId}`,
        },
        (payload) => {
          const row = payload.new as { mode: Mode; status: string };
          setDetail((prev) =>
            prev && prev.conversationId === activeId
              ? { ...prev, mode: row.mode, status: row.status }
              : prev,
          );
        },
      )
      .subscribe();
    detailChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      detailChannelRef.current = null;
    };
  }, [activeId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.messages, sending]);

  const sendReply = useCallback(async () => {
    if (!detail) return;
    const trimmed = reply.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/admin/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: detail.conversationId,
          content: trimmed,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? 'Could not send reply');
        return;
      }
      setReply('');
      // Realtime will stream the message in. Refresh the list so
      // the active conversation surfaces to the top.
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSending(false);
    }
  }, [detail, reply, sending, loadList]);

  const toggleMode = useCallback(async () => {
    if (!detail || switchingMode) return;
    const next: Mode = detail.mode === 'ai' ? 'agent' : 'ai';
    setSwitchingMode(true);
    try {
      const res = await fetch(
        `/api/chat/conversation/${detail.conversationId}/mode`,
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
      setDetail((prev) => (prev ? { ...prev, mode: next } : prev));
    } catch {
      setError('Could not switch mode');
    } finally {
      setSwitchingMode(false);
    }
  }, [detail, switchingMode]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendReply();
    }
  };

  const activeSummary = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  return (
    <div className="h-[calc(100vh-1rem)] md:h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="font-display text-2xl">Inbox</h1>
        <p className="text-xs text-text-3 mt-1">
          All chat conversations across Helm. Reply here as the
          founder; users see your message in the widget in real
          time.
        </p>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[340px_1fr] overflow-hidden">
        {/* List */}
        <aside className="border-r border-border overflow-y-auto">
          {loadingList && (
            <div className="p-3">
              <ListSkeleton rows={5} />
            </div>
          )}
          {!loadingList && error && conversations.length === 0 && (
            <div className="p-3">
              <ErrorState
                compact
                title="Couldn't load inbox"
                description={error}
                onRetry={loadList}
              />
            </div>
          )}
          {!loadingList && !error && conversations.length === 0 && (
            <EmptyState
              compact
              title="No conversations yet"
              description="When users open the chat widget, their threads show up here. You can reply as the founder or hand off to AI."
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              }
            />
          )}
          {conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                  active
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface-1'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-sm font-medium truncate">
                    {c.userName || c.userEmail || c.userId.slice(0, 8)}
                  </div>
                  <ModePill mode={c.mode} />
                </div>
                <div className="text-[11px] text-text-3 truncate mb-1 font-mono">
                  {c.userEmail ?? ''}
                  {c.projectName ? ` · ${c.projectName}` : ''}
                </div>
                <div className="text-xs text-text-2 truncate">
                  {c.lastMessage ?? '(no messages yet)'}
                </div>
                <div className="text-[10px] text-text-3 mt-1">
                  {formatRelative(c.lastMessageAt ?? c.updatedAt)}
                </div>
              </button>
            );
          })}
        </aside>

        {/* Active conversation */}
        <section className="flex flex-col overflow-hidden">
          {!activeId && (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                title="Select a conversation"
                description="Pick a thread from the left to see the full transcript and reply as the founder."
              />
            </div>
          )}
          {activeId && (
            <>
              <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {activeSummary?.userName ||
                      activeSummary?.userEmail ||
                      'Conversation'}
                  </div>
                  <div className="text-[11px] text-text-3 font-mono truncate">
                    {activeSummary?.userEmail ?? ''}
                    {activeSummary?.projectName
                      ? ` · ${activeSummary.projectName}`
                      : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {detail && (
                    <>
                      <ModePill mode={detail.mode} />
                      <button
                        type="button"
                        onClick={toggleMode}
                        disabled={switchingMode}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-md border border-border hover:border-border-bright text-text-2 hover:text-text-1 disabled:opacity-50 transition-colors"
                      >
                        Switch to {detail.mode === 'ai' ? 'Agent' : 'AI'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-6 py-4 space-y-3"
              >
                {loadingDetail && (
                  <div className="space-y-2 py-2">
                    <div className="h-10 w-2/3 rounded-2xl bg-surface-1 animate-pulse" />
                    <div className="h-10 w-1/2 rounded-2xl bg-surface-1 animate-pulse ml-auto" />
                    <div className="h-10 w-3/4 rounded-2xl bg-surface-1 animate-pulse" />
                  </div>
                )}
                {detail?.messages.map((m) => (
                  <AdminBubble key={m.id} message={m} />
                ))}
                {detail?.messages.length === 0 && !loadingDetail && (
                  <EmptyState
                    compact
                    title="Empty conversation"
                    description="This thread exists but no one has sent a message yet."
                  />
                )}
              </div>

              {error && (
                <div className="px-6 py-2 border-t border-danger/30 bg-danger/10 text-[11px] text-danger shrink-0">
                  {error}
                </div>
              )}

              <div className="border-t border-border p-3 shrink-0 flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Reply as Alejandro… (⌘+Enter to send)"
                  rows={2}
                  disabled={sending}
                  className="flex-1 resize-none bg-bg border border-border rounded-lg px-3 py-2 text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright disabled:opacity-50"
                  style={{ maxHeight: 140 }}
                />
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="shrink-0 px-4 h-10 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ModePill({ mode }: { mode: Mode }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${
        mode === 'agent'
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-border text-text-3'
      }`}
    >
      {mode}
    </span>
  );
}

function AdminBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isAgent = message.role === 'agent';
  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[75%]">
        <div className="text-[10px] uppercase tracking-wider text-text-3 mb-1 px-1">
          {message.role === 'user'
            ? 'User'
            : message.role === 'agent'
              ? 'Founder'
              : 'AI'}
          {' · '}
          {formatTime(message.createdAt)}
        </div>
        <div
          className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-surface-2 text-text-1 border border-border rounded-bl-md'
              : isAgent
                ? 'bg-accent text-white rounded-br-md'
                : 'bg-surface-2 text-text-1 border border-border rounded-br-md'
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}
