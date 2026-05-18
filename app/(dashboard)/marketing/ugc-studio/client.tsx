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
import { useSearchParams } from 'next/navigation';

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
  // PR Sprint D-bugs-2 — approval gate state. When true, the
  // surfaced status is forced to 'reviewing' and final-video
  // URLs are nulled even if HeyGen rendered in the background.
  // Clears on the next founder POST (feedback or approve).
  approvalGateActive: boolean;
  approvalGateAt: string | null;
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

// PR Sprint D-7 — input visibility states.
//
// The chat input was previously gated on !isTerminal(), which meant
// the textarea disappeared the instant the session flipped to
// 'generating' or 'completed'. When HeyGen auto-rendered (the
// auto_proceed default bug — fixed server-side in v3-client.ts),
// the user never even saw the textarea. This helper makes the
// rules explicit:
//
//   'thinking' / 'waiting_for_input' / 'reviewing' → input visible + enabled
//   'generating' → input visible but DISABLED with a "rendering" hint
//   'completed' / 'failed' → input hidden (terminal — start a new session
//                            to iterate; HeyGen V3 doesn't support
//                            follow-ups on completed agent runs)
type InputMode = 'enabled' | 'rendering' | 'hidden';
function inputModeFor(s: Session['status']): InputMode {
  if (s === 'generating') return 'rendering';
  if (s === 'completed' || s === 'failed') return 'hidden';
  return 'enabled';
}

// PR Sprint D-7 — show quick-action buttons when the agent is
// explicitly waiting on the founder. These pre-fill the textarea
// with a starter message the user can tweak before sending.
function showsApprovalActions(s: Session['status']): boolean {
  return s === 'reviewing' || s === 'waiting_for_input';
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
  // PR Sprint D-8 — seeded from URL params (?prompt= or
  // ?painPointId=) so deep-links from Research land with the
  // composer pre-filled. The seeding logic lives in the useEffect
  // below — initial state is an empty string so React doesn't
  // render the textarea with a stale snapshot before the param
  // resolves.
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftStyleId, setDraftStyleId] = useState<string | null>(null);
  const [draftOrientation, setDraftOrientation] =
    useState<'portrait' | 'landscape'>('portrait');
  // PR Sprint D-8 — surface "loaded from pain point" hint so the
  // founder knows the textarea isn't their own typing. Cleared
  // once they edit.
  const [seededFromPainPoint, setSeededFromPainPoint] = useState<
    string | null
  >(null);

  // Follow-up message draft.
  const [followUp, setFollowUp] = useState('');

  // Styles catalog.
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [stylesOpen, setStylesOpen] = useState(false);

  // PR Sprint D-finish — pain-points chip rail. Same fetch +
  // shape as the Photo Studio sibling, so the founder gets a
  // consistent "pick from research" affordance across both studios
  // without leaving the new-session flow.
  //
  // UGC Studio doesn't propagate a painPointId to its session API
  // (HeyGen V3's chat agent has no concept of painPoints) — the
  // chip click pre-fills the textarea verbatim, same way the URL
  // ?painPointId= handoff already does. Less intrusive: zero
  // backend changes to the existing UGC chat flow.
  const [painPointOptions, setPainPointOptions] = useState<
    Array<{
      id: string;
      theme: string;
      frequency: number;
      sampleQuote: string;
      actionableAngle: string;
    }>
  >([]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // ─── Seed draft prompt from URL params (Sprint D-8) ────────
  //
  // Two entry vectors from Research:
  //   ?prompt=…         — legacy fallback (used when a pain point
  //                       predates the D-8 id backfill). Set the
  //                       textarea verbatim.
  //   ?painPointId=…    — preferred. Fetch the full pain-point
  //                       row server-side, compose a richer
  //                       starter that quotes the theme + sample
  //                       so the founder can shape the video
  //                       brief around real audience words.
  //
  // Effect runs once on mount + whenever the params change. Guard
  // against overwriting in-progress typing: only seed if
  // draftPrompt is still empty.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (draftPrompt.length > 0) return;
    const prompt = searchParams.get('prompt');
    const painPointId = searchParams.get('painPointId');
    if (prompt) {
      setDraftPrompt(prompt);
      return;
    }
    if (!painPointId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/research/pain-points/${encodeURIComponent(painPointId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          painPoint?: {
            theme: string;
            sampleQuote: string;
            actionableAngle: string;
          };
        };
        if (cancelled || !data.painPoint) return;
        const { theme, sampleQuote, actionableAngle } = data.painPoint;
        // Compose a UGC-ready brief. The video agent reads this
        // verbatim as the founder's initial prompt — keep it
        // narrative, not a checklist.
        const seed = [
          `Address this audience pain: "${theme}"`,
          actionableAngle ? `Angle: ${actionableAngle}` : null,
          sampleQuote ? `Real quote from community: "${sampleQuote}"` : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        setDraftPrompt(seed);
        setSeededFromPainPoint(theme);
      } catch {
        /* non-fatal — founder can still type their own brief */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, draftPrompt.length]);

  // PR Sprint D-finish — fetch pain points for the chip rail.
  // Same endpoint + shape as Photo Studio. One fire on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/research/pain-points?projectId=${encodeURIComponent(projectId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          painPoints?: Array<{
            id: string;
            theme: string;
            frequency: number;
            sampleQuote: string;
            actionableAngle: string;
          }>;
        };
        if (cancelled) return;
        setPainPointOptions(data.painPoints ?? []);
      } catch {
        /* non-fatal — picker just won't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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

  // ─── Chat thread auto-scroll ───────────────────────────────
  //
  // PR Sprint UGC+Photo paridad — fixed-height container + auto-
  // scroll keeps the newest message visible without forcing the
  // page to scroll. Triggered whenever the visible message count
  // changes (new agent reply or new user send).
  const threadRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [activeSession?.messages.length, activeSession?.id]);

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
  //
  // PR Sprint D-final — discriminated kind:'approve'|'feedback'
  // contract replaces the legacy autoProceed boolean. HeyGen V3
  // splits the two intents onto separate endpoints (POST
  // /v3/video-agents/{id} for chat, POST .../approve for the
  // explicit draft confirmation). The backend route dispatches
  // to the right one based on kind.
  const sendFollowUp = async (
    args: { kind: 'feedback'; message: string } | { kind: 'approve' },
  ) => {
    if (!activeSession || sending) return;
    if (args.kind === 'feedback' && args.message.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      const requestBody =
        args.kind === 'approve'
          ? { kind: 'approve' as const }
          : { kind: 'feedback' as const, message: args.message.trim() };
      const res = await fetch(
        `/api/heygen/studio/sessions/${activeSession.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
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
    // PR Sprint UGC+Photo final-fix — moved the bounding +
    // overflow + per-aside/main rules into the shared
    // .studio-shell-grid class in globals.css. Both studios use
    // it so they can't drift apart. CSS class also carries a
    // 100vh fallback for browsers without 100dvh support — which
    // was the suspected root cause of "Photo still scrolls" on
    // some sessions even though my code looked identical to UGC.
    <div
      className="studio-shell-grid"
      style={{
        gridTemplateColumns:
          'minmax(240px, 280px) minmax(360px, 1fr) minmax(320px, 400px)',
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
      {/* main styling (flex column + overflow:hidden + minHeight:0)
          comes from .studio-shell-grid > main in globals.css */}
      <main>
        {!activeSession ? (
          <GlassCard
            className="p-5"
            style={{
              // PR Sprint UGC+Photo final — new-session panel
              // also bounded so the form (chip rail + textarea +
              // style picker grid) scrolls internally within the
              // chat-panel grid cell instead of pushing the page.
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div
              className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2"
            >
              Start a new session
            </div>
            <h2 className="font-display text-2xl font-light mb-3">
              Describe the video you want
            </h2>
            <p className="text-sm text-text-3 mb-4 max-w-prose">
              Helm drafts a storyboard from your prompt. You review,
              iterate by chat, then approve to render — Helm absorbs
              the script, scene composition, and voice picking for
              you.
            </p>

            {/* PR Sprint D-finish — pain-points chip rail.
                Identical UX to the Photo Studio sibling. Click on
                a chip pre-fills the textarea with the same seed
                text the URL handoff uses, and surfaces the
                "Loaded from" badge below. The UGC chat agent
                doesn't need a painPointId — it reads context from
                the textarea like any other free-form brief. */}
            {painPointOptions.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-3 mb-2">
                  Or pick a pain point from your research
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    maxHeight: '110px',
                    overflowY: 'auto',
                    paddingRight: '4px',
                  }}
                >
                  {painPointOptions.map((p) => {
                    const picked = seededFromPainPoint === p.theme;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          const seed = [
                            `Address this audience pain: "${p.theme}"`,
                            p.actionableAngle
                              ? `Angle: ${p.actionableAngle}`
                              : null,
                            p.sampleQuote
                              ? `Real quote from community: "${p.sampleQuote}"`
                              : null,
                          ]
                            .filter(Boolean)
                            .join('\n\n');
                          setDraftPrompt(seed);
                          setSeededFromPainPoint(p.theme);
                        }}
                        title={p.sampleQuote ? `"${p.sampleQuote}"` : p.theme}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          borderRadius: '999px',
                          border: '1px solid',
                          borderColor: picked
                            ? 'var(--d-orange)'
                            : 'var(--border)',
                          background: picked
                            ? 'rgba(249,115,22,0.10)'
                            : 'var(--bg)',
                          color: picked ? 'var(--text-1)' : 'var(--text-2)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          textAlign: 'left',
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.theme}
                        <span
                          style={{
                            marginLeft: '6px',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '9px',
                            color: 'var(--text-3)',
                          }}
                        >
                          {p.frequency}×
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* PR Sprint D-8 — context badge when the textarea was
                pre-filled by a Research → UGC Studio handoff. The
                badge stays visible until the founder edits the
                seed, at which point it's no longer accurate. */}
            {seededFromPainPoint && (
              <div
                style={{
                  marginBottom: '10px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'rgba(249,115,22,0.08)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  fontSize: '11px',
                  color: 'var(--text-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  📥 Loaded from pain point:
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>
                  {seededFromPainPoint}
                </span>
              </div>
            )}

            <textarea
              value={draftPrompt}
              onChange={(e) => {
                setDraftPrompt(e.target.value);
                // First keystroke means the founder is rewriting
                // the seed — drop the "loaded from" badge so it
                // doesn't lie about the current text.
                if (seededFromPainPoint) setSeededFromPainPoint(null);
              }}
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
          <GlassCard
            className="p-5"
            style={{
              // PR Sprint UGC+Photo final — chat card just fills
              // its grid cell. Height bounding moved to the
              // outer grid (above) so all three columns share
              // the same height + each scrolls internally.
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
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
              ref={threadRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '8px 0',
                minHeight: 0,
              }}
            >
              {/* PR Sprint UGC+Photo paridad — removed .reverse().
                  Newest message renders at the bottom; auto-scroll
                  effect keeps it visible. Matches Photo Studio
                  chronological ordering. */}
              {activeSession.messages.map((m, i) => (
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

            {/* PR Sprint D-7 — explicit state-machine for the chat
                input. Three modes (see inputModeFor()):
                  - enabled: thinking / waiting_for_input / reviewing
                  - rendering: 'generating' — disabled with hint
                  - hidden: terminal (completed / failed)
                Quick-action approval buttons surface ONLY when the
                agent is explicitly waiting on user input
                (status === 'reviewing' | 'waiting_for_input') — see
                showsApprovalActions(). */}
            {inputModeFor(activeSession.status) !== 'hidden' && (
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {/* Quick-action chips — pre-fill the textarea with a
                    starter; founder edits then sends. Approve is its
                    own button (not a pre-fill) because it's a
                    distinct intent that fires kind:'approve'
                    (POST .../video-agents/{id}/approve). */}
                {showsApprovalActions(activeSession.status) && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginBottom: '2px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setFollowUp(
                          'Change the visual style — try something cleaner / more modern.',
                        )
                      }
                      className="platform-btn platform-btn-ghost"
                      style={{ fontSize: '11px' }}
                    >
                      🎨 Change visual style
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFollowUp(
                          'Use a different voice — something warmer.',
                        )
                      }
                      className="platform-btn platform-btn-ghost"
                      style={{ fontSize: '11px' }}
                    >
                      🎤 Different voice
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFollowUp(
                          'Edit the script: ',
                        )
                      }
                      className="platform-btn platform-btn-ghost"
                      style={{ fontSize: '11px' }}
                    >
                      ✏️ Edit script
                    </button>
                  </div>
                )}

                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder={
                    inputModeFor(activeSession.status) === 'rendering'
                      ? 'Generating video, hang tight…'
                      : 'Send feedback or hit Approve to render…'
                  }
                  rows={2}
                  disabled={inputModeFor(activeSession.status) === 'rendering'}
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
                      onClick={() =>
                        void sendFollowUp({
                          kind: 'feedback',
                          message: followUp,
                        })
                      }
                      disabled={
                        sending ||
                        followUp.trim().length === 0 ||
                        inputModeFor(activeSession.status) === 'rendering'
                      }
                      className="platform-btn platform-btn-ghost"
                    >
                      {sending ? 'Sending…' : 'Send feedback'}
                    </button>
                    <Button
                      onClick={() => void sendFollowUp({ kind: 'approve' })}
                      disabled={
                        sending ||
                        inputModeFor(activeSession.status) === 'rendering'
                      }
                    >
                      ✓ Approve &amp; render
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
                  {/* PR Sprint UGC+Photo paridad — View-in-HeyGen
                      link removed. Anti-naming: the founder never
                      sees the provider name in the UI. */}
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
                  className="studio-spinner"
                  style={{
                    width: '28px',
                    height: '28px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
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
                {/* PR Sprint UGC+Photo paridad — View-in-HeyGen
                    link removed for anti-naming. Founder reviews
                    + approves inline in the Helm chat surface. */}
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

      {/* PR Sprint UGC+Photo final-fix — @keyframes lives in
          globals.css as `studio-spin` so both studios share one
          definition. Spinner divs reference `studio-spin` via
          the `.studio-spinner` class. */}
    </div>
  );
}
