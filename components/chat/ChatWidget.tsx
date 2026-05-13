'use client';

// PR Sprint 7.15 — native Helm AI chat widget.
//
// Floating bottom-right launcher that opens an Editorial Glass
// panel. The whole thing renders as `position: fixed` so it
// floats over every page in the dashboard without claiming any
// flow space.
//
// State lives in component memory only for the active session
// — the DB ledger (chat_messages) is the persistent record but
// not the read source. Refreshing the page = fresh conversation.
// That matches the brief and keeps the UX expectation simple
// (it's a quick-question tool, not Slack).
//
// Design system notes:
//   - Glass surface via .glass / .glass-elevated (the same
//     classes the dashboard cards use).
//   - Accent terracotta (var(--accent)) for the user-message
//     bubbles + the launcher button.
//   - Compact: 320px × 460px on desktop, full-width minus
//     16px on mobile so it sits flush with the screen edges.
//   - No external chat-UI lib — keeps the bundle small.

import { useCallback, useEffect, useRef, useState } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  projectId: string | null;
}

const LS_OPEN_KEY = 'helm-chat-open';

export function ChatWidget({ projectId }: Props) {
  // Initial open state from localStorage so the panel survives
  // route changes inside the dashboard (Next.js layout keeps the
  // component mounted, but a hard refresh resets state — this
  // preserves the open/closed bit at least).
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate openness from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(window.localStorage.getItem(LS_OPEN_KEY) === '1');
  }, []);

  // Persist openness on every toggle so route changes don't
  // collapse the widget mid-conversation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LS_OPEN_KEY, open ? '1' : '0');
  }, [open]);

  // Auto-scroll to the newest message on every change.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // Focus the input when the panel opens so the founder can
  // start typing immediately.
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    // Optimistic append — the user's message renders immediately
    // and the textarea clears. We append the assistant reply when
    // the API responds.
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          projectId,
          // Send everything BEFORE the new message — Anthropic
          // wants the assistant to see prior turns, not a
          // duplicate of the prompt it's about to answer.
          history: messages,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.reply) {
        setError(data.error ?? data.hint ?? 'Chat service unavailable');
        // Roll the user message off the visible thread on error so
        // they don't think the assistant ignored it — they can
        // retry by typing again.
        setMessages((prev) => prev.slice(0, -1));
        // Restore the input so retyping is one keystroke away.
        setInput(trimmed);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply! },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, projectId]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline. Matches the
    // muscle memory the founder already has from every other
    // chat surface (Slack / Linear comments / ChatGPT).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      {/* Floating launcher button — fixed bottom-right. z-40 so
          it floats above page content but below the onboarding
          wrapper (z-50). */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Helm AI chat"
          className="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-accent text-white shadow-lg hover:bg-accent-hover transition-all hover:scale-105 flex items-center justify-center"
          style={{ boxShadow: '0 6px 24px rgba(196, 69, 32, 0.35)' }}
        >
          {/* Inline SVG keeps the bundle dependency-free.
              22×22 stroke icon, mirrors the chat-bubble shape
              founders recognize from every other widget. */}
          <svg
            width="22"
            height="22"
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
        </button>
      )}

      {/* Panel — Editorial Glass surface, mounts when open.
          Width: 320px on >=sm, full-screen-minus-2rem on
          mobile. Height: 460px capped, but uses a flex column
          so the input bar sticks to the bottom regardless. */}
      {open && (
        <div
          className="fixed z-40 glass-elevated rounded-2xl flex flex-col overflow-hidden border border-border-bright"
          style={{
            bottom: '1rem',
            right: '1rem',
            width: 'min(calc(100vw - 2rem), 360px)',
            height: 'min(calc(100vh - 2rem), 460px)',
          }}
          role="dialog"
          aria-label="Helm AI chat"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent" />
              <span className="font-display text-sm font-medium">
                Helm AI
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="text-text-3 hover:text-text-1 text-lg leading-none p-1"
            >
              ✕
            </button>
          </div>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
          >
            {messages.length === 0 && (
              <div className="text-xs text-text-3 text-center py-6 px-2">
                Ask anything about your marketing strategy, content
                ideas, or how to get more out of Helm.
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble
                key={`${i}-${m.role}`}
                role={m.role}
                content={m.content}
              />
            ))}
            {sending && <TypingIndicator />}
          </div>

          {/* Error banner (non-blocking — input stays active so
              founder can retry) */}
          {error && (
            <div className="px-3 py-2 border-t border-danger/30 bg-danger/10 text-[11px] text-danger shrink-0">
              {error}
            </div>
          )}

          {/* Input row */}
          <div className="border-t border-border p-2 shrink-0 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask Helm…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none bg-bg border border-border rounded-lg px-3 py-2 text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright disabled:opacity-50"
              style={{ maxHeight: 100 }}
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="shrink-0 w-9 h-9 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {/* Send arrow */}
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

function MessageBubble({
  role,
  content,
}: {
  role: 'user' | 'assistant';
  content: string;
}) {
  const isUser = role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-surface-2 text-text-1 border border-border rounded-bl-md'
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  // Three dots fading in/out, ~1.2s loop. CSS-only; no JS timer.
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
