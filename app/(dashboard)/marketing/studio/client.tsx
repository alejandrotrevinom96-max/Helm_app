'use client';

// PR Sprint D-2 — Studio chat-mode client.
//
// Three-panel layout:
//   ┌─ sessions sidebar ─┬─ chat ──────────┬─ preview ──┐
//   │ Recent prompts     │ Founder ↔ agent │ Storyboard │
//   │ + "New session"    │ messages        │ Video URL  │
//   └────────────────────┴─────────────────┴────────────┘
//
// The chat panel hits POST /api/heygen/studio/sessions to
// create a session and POST /api/heygen/studio/sessions/{id} to
// follow up. While the session is live (not in a terminal state)
// the client polls GET /api/heygen/studio/sessions/{id} every 5s
// so the agent's storyboard + final video appear without a
// manual refresh.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';

interface AgentMessage {
  role: 'user' | 'model';
  content: string;
  type: 'text' | 'resource' | 'error';
  created_at: number | null;
  resource_ids: string[] | null;
}

interface Session {
  id: string;
  heygenSessionId: string;
  status:
    | 'thinking'
    | 'waiting_for_input'
    | 'reviewing'
    | 'generating'
    | 'completed'
    | 'failed';
  prompt: string;
  title: string | null;
  styleId: string | null;
  orientation: 'landscape' | 'portrait' | null;
  messages: AgentMessage[];
  lastResources: unknown[];
  finalVideoUrl: string | null;
  finalVideoThumbnailUrl: string | null;
  finalVideoCaptionedUrl: string | null;
  finalVideoSubtitleUrl: string | null;
  finalVideoDurationSec: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface StyleOption {
  style_id: string;
  name: string;
  thumbnail_url: string | null;
  preview_video_url: string | null;
  tags: string[];
  aspect_ratio: string | null;
}

const STATUS_LABEL: Record<Session['status'], string> = {
  thinking: 'Thinking…',
  waiting_for_input: 'Waiting for your input',
  reviewing: 'Reviewing storyboard',
  generating: 'Rendering video',
  completed: 'Ready',
  failed: 'Failed',
};

const STATUS_COLOR: Record<Session['status'], string> = {
  thinking: 'var(--text-3)',
  waiting_for_input: 'var(--accent)',
  reviewing: 'var(--accent)',
  generating: 'var(--accent)',
  completed: 'var(--d-green-2)',
  failed: 'var(--d-red-2)',
};

function isTerminal(s: Session['status']): boolean {
  return s === 'completed' || s === 'failed';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  projectId: string;
}

export function StudioClient({ projectId }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-session draft state.
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftStyleId, setDraftStyleId] = useState<string | null>(null);
  const [draftOrientation, setDraftOrientation] =
    useState<'portrait' | 'landscape'>('portrait');

  // Follow-up message draft.
  const [followUp, setFollowUp] = useState('');

  // Styles catalog.
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [stylesOpen, setStylesOpen] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // ─── Load initial session list ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/heygen/studio/sessions?projectId=${encodeURIComponent(projectId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as { sessions?: Session[] };
        if (cancelled) return;
        setSessions(data.sessions ?? []);
        // Open the most recent non-terminal session by default;
        // otherwise leave nothing selected so the founder sees
        // the "Start a new session" prompt.
        const live = (data.sessions ?? []).find((s) => !isTerminal(s.status));
        if (live) setActiveSessionId(live.id);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Network error');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ─── Lazy-load styles on first picker open ─────────────────
  const ensureStylesLoaded = useCallback(async () => {
    if (styles.length > 0) return;
    try {
      const res = await fetch('/api/heygen/styles');
      if (!res.ok) return;
      const data = (await res.json()) as { styles?: StyleOption[] };
      setStyles(data.styles ?? []);
    } catch {
      /* non-fatal */
    }
  }, [styles.length]);

  // ─── Poll active session while live ────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!activeSession || isTerminal(activeSession.status)) return;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/heygen/studio/sessions/${activeSession.id}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { session?: Session };
        if (!data.session) return;
        setSessions((prev) =>
          prev.map((s) => (s.id === data.session!.id ? data.session! : s)),
        );
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeSession?.id, activeSession?.status]);

  // ─── Create new session ────────────────────────────────────
  const createSession = async () => {
    if (creating) return;
    if (draftPrompt.trim().length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/heygen/studio/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt: draftPrompt.trim(),
          styleId: draftStyleId,
          orientation: draftOrientation,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: Session;
        error?: string;
      };
      if (!res.ok || !data.session) {
        setError(data.error ?? `Create failed (${res.status})`);
        return;
      }
      setSessions((prev) => [data.session!, ...prev]);
      setActiveSessionId(data.session.id);
      setDraftPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  };

  // ─── Send follow-up ────────────────────────────────────────
  const sendFollowUp = async ({ autoProceed }: { autoProceed: boolean }) => {
    if (!activeSession || sending) return;
    if (followUp.trim().length === 0 && !autoProceed) return;
    setSending(true);
    setError(null);
    try {
      const message =
        followUp.trim().length > 0
          ? followUp.trim()
          : 'Looks good — approve and render the video.';
      const res = await fetch(
        `/api/heygen/studio/sessions/${activeSession.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, autoProceed }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        session?: Session;
        error?: string;
      };
      if (!res.ok || !data.session) {
        setError(data.error ?? `Send failed (${res.status})`);
        return;
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === data.session!.id ? data.session! : s)),
      );
      setFollowUp('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSending(false);
    }
  };

  // ─── Stop session ──────────────────────────────────────────
  const stopSession = async () => {
    if (!activeSession) return;
    if (!confirm('Stop this session? Partial results are preserved.')) return;
    try {
      const res = await fetch(
        `/api/heygen/studio/sessions/${activeSession.id}/stop`,
        { method: 'POST' },
      );
      if (!res.ok) return;
      // Reload by setting status locally; next poll cycle
      // confirms with the server.
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id ? { ...s, status: 'failed' as const } : s,
        ),
      );
    } catch {
      /* non-fatal */
    }
  };

  // ─── Render ────────────────────────────────────────────────

  if (loading) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-text-3">Loading Studio…</p>
      </GlassCard>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(240px, 280px) minmax(360px, 1fr) minmax(320px, 400px)',
        gap: '16px',
        minHeight: '70vh',
      }}
    >
      {/* ─── Sessions sidebar ───────────────────────────────── */}
      <aside>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2"
          style={{ marginBottom: '8px' }}
        >
          Recent sessions ({sessions.length})
        </div>
        <button
          type="button"
          onClick={() => setActiveSessionId(null)}
          className="platform-btn platform-btn-ghost"
          style={{ width: '100%', marginBottom: '12px' }}
        >
          + New session
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSessionId(s.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: active ? 'rgba(249,115,22,0.08)' : 'var(--bg)',
                  borderColor: active ? 'var(--d-orange)' : 'var(--border)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--text-1)',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    marginBottom: '2px',
                  }}
                >
                  {(s.title ?? s.prompt).slice(0, 60)}
                  {(s.title ?? s.prompt).length > 60 ? '…' : ''}
                </div>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px',
                    color: STATUS_COLOR[s.status],
                  }}
                >
                  {STATUS_LABEL[s.status]} · {relativeTime(s.updatedAt)}
                </div>
              </button>
            );
          })}
          {sessions.length === 0 && (
            <p className="text-xs text-text-3">
              No sessions yet. Start one →
            </p>
          )}
        </div>
      </aside>

      {/* ─── Chat panel ─────────────────────────────────────── */}
      <main>
        {!activeSession ? (
          <GlassCard className="p-5">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2"
            >
              Start a new session
            </div>
            <h2 className="font-display text-2xl font-light mb-3">
              Describe the video you want
            </h2>
            <p className="text-sm text-text-3 mb-4 max-w-prose">
              Helm hands the prompt off to HeyGen&apos;s Video Agent, which
              drafts a storyboard. You review, iterate by chat, then
              approve to render — Helm absorbs the script, scene
              composition, and voice picking for you.
            </p>

            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              placeholder="e.g. 30-second UGC where I explain how our automated marketing system saves 7 hours per week for solo founders. Friendly, energetic tone."
              rows={5}
              maxLength={10_000}
              className="platform-field-input"
              style={{ resize: 'vertical', minHeight: '120px' }}
            />

            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginTop: '12px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setDraftOrientation((prev) =>
                    prev === 'portrait' ? 'landscape' : 'portrait',
                  )
                }
                className="platform-btn platform-btn-ghost"
                style={{ fontSize: '12px' }}
              >
                {draftOrientation === 'portrait'
                  ? '📱 Portrait (9:16)'
                  : '🖥️ Landscape (16:9)'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await ensureStylesLoaded();
                  setStylesOpen((v) => !v);
                }}
                className="platform-btn platform-btn-ghost"
                style={{ fontSize: '12px' }}
              >
                🎨{' '}
                {draftStyleId
                  ? (
                      styles.find((s) => s.style_id === draftStyleId)?.name ??
                      'Style picked'
                    )
                  : 'Pick style'}
              </button>
              <div style={{ flex: 1 }} />
              <Button
                onClick={createSession}
                disabled={creating || draftPrompt.trim().length === 0}
              >
                {creating ? 'Creating…' : 'Start session'}
              </Button>
            </div>

            {stylesOpen && (
              <div
                style={{
                  marginTop: '14px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: '10px',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  paddingRight: '4px',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDraftStyleId(null);
                    setStylesOpen(false);
                  }}
                  style={{
                    padding: '14px 8px',
                    border: '1px solid',
                    borderColor:
                      draftStyleId === null
                        ? 'var(--d-orange)'
                        : 'var(--border)',
                    borderRadius: '8px',
                    background:
                      draftStyleId === null
                        ? 'rgba(249,115,22,0.08)'
                        : 'var(--bg)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--text-1)',
                    fontSize: '11px',
                  }}
                >
                  No style
                  <br />
                  <span style={{ color: 'var(--text-3)', fontSize: '10px' }}>
                    (agent picks)
                  </span>
                </button>
                {styles.map((s) => {
                  const active = draftStyleId === s.style_id;
                  return (
                    <button
                      key={s.style_id}
                      type="button"
                      onClick={() => {
                        setDraftStyleId(s.style_id);
                        setStylesOpen(false);
                      }}
                      style={{
                        padding: 0,
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: active
                          ? 'var(--d-orange)'
                          : 'var(--border)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: 'var(--bg)',
                        textAlign: 'left',
                      }}
                    >
                      {s.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.thumbnail_url}
                          alt={s.name}
                          style={{
                            width: '100%',
                            aspectRatio: '16/9',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                      )}
                      <div
                        style={{
                          padding: '6px 8px',
                          fontSize: '11px',
                          color: 'var(--text-1)',
                        }}
                      >
                        {s.name}
                        {s.tags.length > 0 && (
                          <div
                            style={{
                              color: 'var(--text-3)',
                              fontSize: '10px',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {s.tags[0]}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(220,38,38,0.08)',
                  border: '1px solid rgba(220,38,38,0.3)',
                  color: 'var(--d-red-2)',
                  fontSize: '12px',
                }}
              >
                {error}
              </div>
            )}
          </GlassCard>
        ) : (
          <GlassCard className="p-5" style={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '12px',
                marginBottom: '8px',
              }}
            >
              <h2 className="font-display text-xl font-light" style={{ flex: 1, minWidth: 0 }}>
                {activeSession.title ?? activeSession.prompt.slice(0, 80)}
              </h2>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: STATUS_COLOR[activeSession.status],
                }}
              >
                {STATUS_LABEL[activeSession.status]}
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '8px 0',
                minHeight: '300px',
              }}
            >
              {[...activeSession.messages]
                .reverse()
                .map((m, i) => (
                  <div
                    key={`${m.created_at ?? i}-${m.role}`}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      padding: '10px 14px',
                      borderRadius: '12px',
                      background:
                        m.role === 'user'
                          ? 'rgba(249,115,22,0.10)'
                          : 'var(--bg-elev)',
                      border: '1px solid var(--border)',
                      fontSize: '13px',
                      color: 'var(--text-1)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '9px',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--text-3)',
                        marginBottom: '4px',
                      }}
                    >
                      {m.role === 'user' ? 'You' : '🎬 Agent'}
                    </div>
                    {m.content}
                  </div>
                ))}
              {activeSession.errorMessage && (
                <div
                  style={{
                    alignSelf: 'flex-start',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: 'rgba(220,38,38,0.08)',
                    border: '1px solid rgba(220,38,38,0.3)',
                    color: 'var(--d-red-2)',
                    fontSize: '12px',
                  }}
                >
                  ⚠ {activeSession.errorMessage}
                </div>
              )}
            </div>

            {!isTerminal(activeSession.status) && (
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="Send feedback or hit Approve to render…"
                  rows={2}
                  className="platform-field-input"
                  style={{ resize: 'vertical', minHeight: '52px' }}
                />
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'space-between',
                  }}
                >
                  <button
                    type="button"
                    onClick={stopSession}
                    className="platform-ghost-link"
                    style={{ fontSize: '11px', color: 'var(--text-3)' }}
                  >
                    Stop session
                  </button>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => void sendFollowUp({ autoProceed: false })}
                      disabled={sending || followUp.trim().length === 0}
                      className="platform-btn platform-btn-ghost"
                    >
                      {sending ? 'Sending…' : 'Send feedback'}
                    </button>
                    <Button
                      onClick={() => void sendFollowUp({ autoProceed: true })}
                      disabled={sending}
                    >
                      Approve & render
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'rgba(220,38,38,0.08)',
                  border: '1px solid rgba(220,38,38,0.3)',
                  color: 'var(--d-red-2)',
                  fontSize: '12px',
                }}
              >
                {error}
              </div>
            )}
          </GlassCard>
        )}
      </main>

      {/* ─── Preview panel ──────────────────────────────────── */}
      <aside>
        {activeSession ? (
          <GlassCard className="p-4">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3"
              style={{ marginBottom: '8px' }}
            >
              Preview
            </div>

            {activeSession.finalVideoUrl ? (
              <>
                <video
                  src={
                    activeSession.finalVideoCaptionedUrl ??
                    activeSession.finalVideoUrl
                  }
                  controls
                  playsInline
                  poster={activeSession.finalVideoThumbnailUrl ?? undefined}
                  style={{
                    width: '100%',
                    borderRadius: '10px',
                    background: 'var(--bg-elev)',
                    aspectRatio:
                      activeSession.orientation === 'landscape'
                        ? '16/9'
                        : '9/16',
                    objectFit: 'cover',
                  }}
                />
                {activeSession.finalVideoDurationSec && (
                  <p
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '10px',
                      color: 'var(--text-3)',
                      marginTop: '6px',
                    }}
                  >
                    Duration: {activeSession.finalVideoDurationSec}s
                  </p>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    marginTop: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <a
                    href={activeSession.finalVideoUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="platform-btn platform-btn-ghost"
                    style={{ fontSize: '11px' }}
                  >
                    ⬇ Download
                  </a>
                  {activeSession.finalVideoSubtitleUrl && (
                    <a
                      href={activeSession.finalVideoSubtitleUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="platform-btn platform-btn-ghost"
                      style={{ fontSize: '11px' }}
                    >
                      ⬇ SRT
                    </a>
                  )}
                </div>
              </>
            ) : isTerminal(activeSession.status) ? (
              <p className="text-sm text-text-3">
                {activeSession.status === 'failed'
                  ? activeSession.errorMessage ?? 'Render failed.'
                  : 'No video produced.'}
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '40px 0',
                  color: 'var(--text-3)',
                  fontSize: '12px',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span>
                  {activeSession.status === 'thinking'
                    ? 'Agent is drafting your storyboard…'
                    : activeSession.status === 'reviewing'
                      ? 'Storyboard ready for review.'
                      : activeSession.status === 'generating'
                        ? 'Rendering — typically 2-5 min.'
                        : 'Waiting for input.'}
                </span>
              </div>
            )}
          </GlassCard>
        ) : (
          <GlassCard className="p-4">
            <p className="text-sm text-text-3">
              Pick or start a session to see the preview here.
            </p>
          </GlassCard>
        )}
      </aside>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
