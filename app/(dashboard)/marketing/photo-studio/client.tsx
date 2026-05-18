'use client';

// PR Sprint D-8 Phase 2 — Photo Studio chat-agent client.
//
// Three-panel layout mirrors the UGC Studio:
//   ┌─ sessions ────┬─ chat thread ──────────────┬─ visual + copies ───┐
//   │ Recent prompts│ Founder ↔ agent messages    │ Visual preview      │
//   │ + New session │ Quick-action chips per      │ Copy cards grid     │
//   │               │ state. Input always visible │ (per platform, with │
//   │               │ in awaiting_* states.       │ regenerate/approve) │
//   └───────────────┴─────────────────────────────┴─────────────────────┘
//
// Backend lives in /api/photo-agent/sessions[/id]. The state
// machine + chat history live server-side; this client is a
// thin renderer that dispatches actions and polls.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import {
  inputModeFor,
  quickActionsFor,
  type PhotoSessionState,
  type QuickAction,
} from '@/lib/photo-agent/stateMachine';

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  kind: 'text' | 'system' | 'visual' | 'platforms' | 'copies';
  createdAt: number;
}

interface PerPlatformCopy {
  platform: string;
  text: string;
  hashtags: string[];
  ctaText: string | null;
}

interface Session {
  id: string;
  projectId: string;
  prompt: string;
  painPointId: string | null;
  state: PhotoSessionState;
  // PR Sprint UGC+Photo paridad — approval-gate fields. Server
  // sets approvalGateActive=true when the agent has converged on
  // a concept and the founder needs to explicitly approve before
  // fal.ai fires.
  approvalGateActive: boolean;
  approvalGateAt: string | null;
  assetType: 'photo' | 'carousel' | 'upload' | null;
  uploadedAssetUrl: string | null;
  concept: string | null;
  visualUrl: string | null;
  visualWidth: number | null;
  visualHeight: number | null;
  platforms: string[];
  copies: PerPlatformCopy[];
  messages: ChatMessage[];
  contentAssetId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const STATE_LABEL: Record<PhotoSessionState, string> = {
  understanding: 'Thinking…',
  awaiting_type_choice: 'Pick a type',
  reviewing_concept: 'Reviewing concept',
  generating_visual: 'Rendering visual…',
  awaiting_visual_feedback: 'Review visual',
  awaiting_platform_choice: 'Pick platforms',
  generating_copies: 'Writing captions…',
  awaiting_copy_feedback: 'Review captions',
  visual_failed: 'Visual failed — retry?',
  finalized: 'Saved',
  failed: 'Failed',
};

const STATE_COLOR: Record<PhotoSessionState, string> = {
  understanding: 'var(--text-3)',
  awaiting_type_choice: 'var(--accent)',
  reviewing_concept: 'var(--accent)',
  generating_visual: 'var(--accent)',
  awaiting_visual_feedback: 'var(--accent)',
  awaiting_platform_choice: 'var(--accent)',
  generating_copies: 'var(--accent)',
  awaiting_copy_feedback: 'var(--accent)',
  visual_failed: 'var(--d-red-2)',
  finalized: 'var(--d-green-2)',
  failed: 'var(--d-red-2)',
};

const ALL_PLATFORMS = [
  'instagram',
  'instagram_reels',
  'facebook',
  'facebook_reels',
  'linkedin',
  'threads',
  'reddit',
  'x',
  'tiktok',
];

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  instagram_reels: 'IG Reels',
  facebook: 'Facebook',
  facebook_reels: 'FB Reels',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  reddit: 'Reddit',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
};

function isTerminal(s: PhotoSessionState): boolean {
  return s === 'finalized' || s === 'failed';
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

export function PhotoStudioClient({ projectId }: Props) {
  const searchParams = useSearchParams();
  const incomingPainPointId = searchParams.get('painPointId') ?? '';
  const incomingPrompt = searchParams.get('prompt') ?? '';

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-session draft state (when no active session selected).
  const [draftPrompt, setDraftPrompt] = useState('');
  const [seededFromPainPoint, setSeededFromPainPoint] = useState<string | null>(
    null,
  );
  // PR Sprint D-finish — id of the pain point the founder picked
  // (either by landing here from Research with ?painPointId=, or by
  // clicking a chip in the new-session panel). Used by
  // createSession so the agent's first message lands in Case B
  // (theme + real quote + 3 angles) instead of the no-context
  // greeting.
  const [pickedPainPointId, setPickedPainPointId] = useState<string | null>(
    null,
  );

  // List of pain points for the chip rail. Loaded once on mount;
  // cached client-side because the founder rarely opens more than
  // one session per page-load and the freshness expectation is
  // weekly (research extractions run on a cadence).
  const [painPointOptions, setPainPointOptions] = useState<
    Array<{ id: string; theme: string; frequency: number; sampleQuote: string; actionableAngle: string }>
  >([]);

  // Chat input draft (for active session).
  const [chatInput, setChatInput] = useState('');

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  // ─── Load session list + seed draft prompt from URL params ───
  useEffect(() => {
    if (incomingPrompt && !seededFromPainPoint) {
      setDraftPrompt(incomingPrompt);
      return;
    }
    if (!incomingPainPointId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/research/pain-points/${encodeURIComponent(incomingPainPointId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          painPoint?: { theme: string; sampleQuote: string; actionableAngle: string };
        };
        if (cancelled || !data.painPoint) return;
        const { theme, sampleQuote, actionableAngle } = data.painPoint;
        const seed = [
          `Address this audience pain: "${theme}"`,
          actionableAngle ? `Angle: ${actionableAngle}` : null,
          sampleQuote ? `Real quote from community: "${sampleQuote}"` : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        if (draftPrompt.length === 0) setDraftPrompt(seed);
        setSeededFromPainPoint(theme);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPainPointId, incomingPrompt]);

  // PR Sprint D-finish — sync the incoming URL id into the picked-
  // state so createSession passes it through. Doing this in its own
  // effect keeps it independent of the prompt-seeding logic above.
  useEffect(() => {
    if (incomingPainPointId) setPickedPainPointId(incomingPainPointId);
  }, [incomingPainPointId]);

  // PR Sprint D-finish — fetch the pain-points chip rail. Cheap,
  // small payload, founder-scoped — fire once on mount.
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
        /* non-fatal — picker just won't show chips */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/photo-agent/sessions?projectId=${encodeURIComponent(projectId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as { sessions?: Session[] };
        if (cancelled) return;
        setSessions(data.sessions ?? []);
        const live = (data.sessions ?? []).find((s) => !isTerminal(s.state));
        if (live) setActiveId(live.id);
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

  // ─── Poll active session while non-terminal ────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!activeSession || isTerminal(activeSession.state)) return;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/photo-agent/sessions/${activeSession.id}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { session?: Session };
        if (!data.session) return;
        setSessions((prev) =>
          prev.map((s) => (s.id === data.session!.id ? data.session! : s)),
        );
      } catch {
        /* transient */
      }
    };
    // Fast poll (3s) — most state changes are server-initiated
    // (fal.ai + Opus return inside the request handler so we don't
    // really need polling, but it covers the case where a long-
    // running request times out client-side and the server finishes
    // in the background).
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeSession?.id, activeSession?.state]);

  // ─── Create new session ────────────────────────────────────
  const createSession = useCallback(async () => {
    if (creating) return;
    // PR Sprint D-finish — accept either an in-page picked id OR
    // an inbound URL id OR a typed prompt. Any of the three is
    // enough to seed a session.
    const painPointId = pickedPainPointId || incomingPainPointId || null;
    if (draftPrompt.trim().length === 0 && !painPointId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/photo-agent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt: draftPrompt.trim(),
          painPointId,
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
      setActiveId(data.session.id);
      setDraftPrompt('');
      setSeededFromPainPoint(null);
      setPickedPainPointId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  }, [
    creating,
    draftPrompt,
    projectId,
    incomingPainPointId,
    pickedPainPointId,
  ]);

  // ─── Send message / action ─────────────────────────────────
  const sendAction = useCallback(
    async (body: Record<string, unknown>) => {
      if (!activeSession || sending) return;
      setSending(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/photo-agent/sessions/${activeSession.id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error');
      } finally {
        setSending(false);
      }
    },
    [activeSession, sending],
  );

  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (text.length === 0) return;
    setChatInput('');
    await sendAction({ kind: 'message', text });
  }, [chatInput, sendAction]);

  // ─── Render ────────────────────────────────────────────────

  if (loading) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-text-3">Loading Photo Studio…</p>
      </GlassCard>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(220px, 260px) minmax(360px, 1fr) minmax(320px, 420px)',
        gap: '16px',
        // PR Sprint UGC+Photo final — bound the outer grid so
        // all three columns share a fixed height and scroll
        // independently. dvh handles mobile chrome; 240px
        // reserves the page header + sub-nav.
        height: 'calc(100dvh - 240px)',
        maxHeight: 'calc(100dvh - 240px)',
        minHeight: '420px',
        overflow: 'hidden',
      }}
    >
      {/* ─── Sessions sidebar ──────────────────────────────── */}
      <aside style={{ overflowY: 'auto', minHeight: 0 }}>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3"
          style={{ marginBottom: '8px' }}
        >
          Recent sessions ({sessions.length})
        </div>
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className="platform-btn platform-btn-ghost"
          style={{ width: '100%', marginBottom: '12px' }}
        >
          + New session
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
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
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>
                  {s.prompt.slice(0, 60)}
                  {s.prompt.length > 60 ? '…' : ''}
                </div>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px',
                    color: STATE_COLOR[s.state],
                  }}
                >
                  {STATE_LABEL[s.state]} · {relativeTime(s.updatedAt)}
                </div>
              </button>
            );
          })}
          {sessions.length === 0 && (
            <p className="text-xs text-text-3">No sessions yet. Start one →</p>
          )}
        </div>
      </aside>

      {/* ─── Chat panel ───────────────────────────────────── */}
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {!activeSession ? (
          <NewSessionPanel
            draftPrompt={draftPrompt}
            setDraftPrompt={setDraftPrompt}
            seededFromPainPoint={seededFromPainPoint}
            setSeededFromPainPoint={setSeededFromPainPoint}
            painPointOptions={painPointOptions}
            pickedPainPointId={pickedPainPointId}
            onPickPainPoint={(p) => {
              // PR Sprint D-finish — click on a pain-point chip in
              // the picker. Behavior mirrors the URL-deep-link
              // path: build the same seed text + show the same
              // "Loaded from" badge + flag the id for the next
              // createSession call.
              const seed = [
                `Address this audience pain: "${p.theme}"`,
                p.actionableAngle ? `Angle: ${p.actionableAngle}` : null,
                p.sampleQuote
                  ? `Real quote from community: "${p.sampleQuote}"`
                  : null,
              ]
                .filter(Boolean)
                .join('\n\n');
              setDraftPrompt(seed);
              setSeededFromPainPoint(p.theme);
              setPickedPainPointId(p.id);
            }}
            creating={creating}
            createSession={createSession}
            error={error}
          />
        ) : (
          <ActiveSessionPanel
            session={activeSession}
            chatInput={chatInput}
            setChatInput={setChatInput}
            sending={sending}
            sendAction={sendAction}
            sendMessage={sendMessage}
            error={error}
          />
        )}
      </main>

      {/* ─── Preview panel ─────────────────────────────────── */}
      <aside style={{ overflowY: 'auto', minHeight: 0 }}>
        {activeSession ? (
          <PreviewPanel session={activeSession} sendAction={sendAction} />
        ) : (
          <GlassCard className="p-4">
            <p className="text-sm text-text-3">
              Pick or start a session to preview the visual + copies here.
            </p>
          </GlassCard>
        )}
      </aside>
    </div>
  );
}

// ─── New-session panel ────────────────────────────────────────

interface PainPointOption {
  id: string;
  theme: string;
  frequency: number;
  sampleQuote: string;
  actionableAngle: string;
}

interface NewSessionPanelProps {
  draftPrompt: string;
  setDraftPrompt: (v: string) => void;
  seededFromPainPoint: string | null;
  setSeededFromPainPoint: (v: string | null) => void;
  // PR Sprint D-finish — pain-points chip rail. Empty array means
  // none extracted yet (or the latest batch was entirely pre-
  // backfill); the picker hides itself rather than render a
  // dead section.
  painPointOptions: PainPointOption[];
  pickedPainPointId: string | null;
  onPickPainPoint: (p: PainPointOption) => void;
  creating: boolean;
  createSession: () => Promise<void>;
  error: string | null;
}

function NewSessionPanel({
  draftPrompt,
  setDraftPrompt,
  seededFromPainPoint,
  setSeededFromPainPoint,
  painPointOptions,
  pickedPainPointId,
  onPickPainPoint,
  creating,
  createSession,
  error,
}: NewSessionPanelProps) {
  return (
    <GlassCard
      className="p-5"
      style={{
        // PR Sprint UGC+Photo final — same flex behavior as the
        // active session card so the new-session form scrolls
        // internally instead of pushing the grid cell taller.
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        Start a new session
      </div>
      <h2 className="font-display text-2xl font-light mb-3">
        Describe the visual you want
      </h2>
      <p className="text-sm text-text-3 mb-4 max-w-prose">
        Helm reads your brand bible, drafts a concept, generates a visual, then
        writes captions adapted per network. Iterate by chat until each piece
        is right.
      </p>

      {/* PR Sprint D-finish — pain-points chip rail. Surfaces the
          latest research extraction so the founder can jump
          straight from "what is my audience complaining about" to
          a visual concept without leaving the studio. Click → fills
          the textarea with the same seed text the Research → Send-
          to flow uses, marks the id for createSession, and shows
          the "Loaded from" badge. */}
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
              const picked = pickedPainPointId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPickPainPoint(p)}
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
          if (seededFromPainPoint) setSeededFromPainPoint(null);
        }}
        placeholder="e.g. Founder selfie behind a laptop, warm office light, message about how solo founders are losing hours to manual posting."
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
          justifyContent: 'flex-end',
        }}
      >
        <Button
          onClick={() => void createSession()}
          disabled={creating || (draftPrompt.trim().length === 0 && !seededFromPainPoint)}
        >
          {creating ? 'Starting…' : 'Start session'}
        </Button>
      </div>

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
  );
}

// ─── Active session chat panel ────────────────────────────────

interface ActiveSessionPanelProps {
  session: Session;
  chatInput: string;
  setChatInput: (v: string) => void;
  sending: boolean;
  sendAction: (body: Record<string, unknown>) => Promise<void>;
  sendMessage: () => Promise<void>;
  error: string | null;
}

function ActiveSessionPanel({
  session,
  chatInput,
  setChatInput,
  sending,
  sendAction,
  sendMessage,
  error,
}: ActiveSessionPanelProps) {
  const mode = inputModeFor(session.state);
  const quickActions = quickActionsFor(session.state);

  // PR Sprint UGC+Photo paridad — fixed-height chat container +
  // auto-scroll to bottom on new message. Pre-fix the container
  // grew with each message and pushed the page-level scrollbar
  // past the viewport. Now the thread is bounded; only the
  // inner div scrolls; newest message stays visible.
  const threadRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [session.messages.length, session.id]);

  const onQuickAction = (a: QuickAction) => {
    // Type-pick chips dispatch as a structured action (not a free-
    // text message) so the backend skips the classifier and goes
    // straight to refineConcept.
    if (a.intent === 'pick_type') {
      const assetType = a.label.includes('Carousel')
        ? 'carousel'
        : a.label.includes('Upload')
          ? 'upload'
          : 'photo';
      void sendAction({ kind: 'action', action: 'pick_type', assetType });
      return;
    }
    // PR Sprint UGC+Photo paridad — concept-review approval chip
    // fires the approve_concept action so fal.ai runs after
    // explicit founder confirmation. Other chips in this state
    // (Adjust style / Different composition / New concept)
    // pre-fill the textarea for feedback.
    if (a.intent === 'approve' && session.state === 'reviewing_concept') {
      void sendAction({ kind: 'action', action: 'approve_concept' });
      return;
    }
    if (a.intent === 'approve' && session.state === 'awaiting_visual_feedback') {
      void sendAction({ kind: 'action', action: 'approve_visual' });
      return;
    }
    if (a.intent === 'approve' && session.state === 'awaiting_platform_choice') {
      void sendAction({ kind: 'action', action: 'approve_platforms' });
      return;
    }
    if (a.intent === 'approve' && session.state === 'awaiting_copy_feedback') {
      void sendAction({ kind: 'action', action: 'approve_copies' });
      return;
    }
    // PR Sprint D-bugs — visual_failed recovery chips. "Try
    // again" maps to retry_visual (same concept), "Refine
    // concept first" maps to refine_concept (back to chat for
    // adjustment, then re-fire).
    if (a.intent === 'approve' && session.state === 'visual_failed') {
      void sendAction({ kind: 'action', action: 'retry_visual' });
      return;
    }
    if (
      session.state === 'visual_failed' &&
      a.label.includes('Refine concept')
    ) {
      void sendAction({ kind: 'action', action: 'refine_concept' });
      return;
    }
    // Everything else: pre-fill the input so the founder can tweak
    // before sending.
    setChatInput(a.seed);
  };

  return (
    <GlassCard
      className="p-5"
      style={{
        // PR Sprint UGC+Photo final — chat card just fills its
        // grid cell. Outer grid handles height bounding so all
        // three columns line up and scroll independently.
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
          {session.prompt.slice(0, 80)}
        </h2>
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: STATE_COLOR[session.state],
          }}
        >
          {STATE_LABEL[session.state]}
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
        {session.messages.map((m, i) => (
          <div
            key={`${m.createdAt ?? i}-${m.role}`}
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
              {m.role === 'user' ? 'You' : '🎨 Agent'}
            </div>
            {m.content}
          </div>
        ))}
        {session.errorMessage && (
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
            ⚠ {session.errorMessage}
          </div>
        )}
      </div>

      {mode !== 'hidden' && (
        <div
          style={{
            marginTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {quickActions.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                marginBottom: '2px',
              }}
            >
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => onQuickAction(a)}
                  disabled={sending || mode === 'disabled'}
                  className="platform-btn platform-btn-ghost"
                  style={{ fontSize: '11px' }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={
              mode === 'disabled'
                ? STATE_LABEL[session.state]
                : session.state === 'reviewing_concept'
                  ? 'Send feedback or hit Approve to generate…'
                  : 'Reply or describe what to change in your own words…'
            }
            rows={2}
            disabled={mode === 'disabled'}
            className="platform-field-input"
            style={{ resize: 'vertical', minHeight: '52px' }}
          />
          <div
            style={{
              display: 'flex',
              gap: '8px',
              justifyContent: 'flex-end',
            }}
          >
            <Button
              onClick={() => void sendMessage()}
              disabled={
                sending || chatInput.trim().length === 0 || mode === 'disabled'
              }
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
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
  );
}

// ─── Preview panel ────────────────────────────────────────────

interface PreviewPanelProps {
  session: Session;
  sendAction: (body: Record<string, unknown>) => Promise<void>;
}

function PreviewPanel({ session, sendAction }: PreviewPanelProps) {
  return (
    <GlassCard className="p-4">
      <div
        className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3"
        style={{ marginBottom: '8px' }}
      >
        Preview
      </div>

      {session.visualUrl ? (
        <>
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio:
                session.visualWidth && session.visualHeight
                  ? `${session.visualWidth} / ${session.visualHeight}`
                  : '1 / 1',
              borderRadius: '10px',
              overflow: 'hidden',
              background: 'var(--bg-elev)',
              marginBottom: '8px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.visualUrl}
              alt="Generated visual"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          {session.state === 'awaiting_platform_choice' && (
            <PlatformPicker session={session} sendAction={sendAction} />
          )}
        </>
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
            textAlign: 'center',
          }}
        >
          {session.state === 'generating_visual' ? (
            <>
              <Spinner />
              <span>Rendering visual — usually 6-10 seconds.</span>
            </>
          ) : (
            <span>Visual will appear here once the agent renders it.</span>
          )}
        </div>
      )}

      {session.copies.length > 0 && (
        <CopiesGrid session={session} sendAction={sendAction} />
      )}
    </GlassCard>
  );
}

// ─── Platform picker (shown during awaiting_platform_choice) ─

function PlatformPicker({ session, sendAction }: PreviewPanelProps) {
  const [picked, setPicked] = useState<string[]>(session.platforms);
  return (
    <div
      style={{
        marginTop: '8px',
        padding: '10px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3"
        style={{ marginBottom: '6px' }}
      >
        Distribution
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {ALL_PLATFORMS.map((p) => {
          const on = picked.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                const next = on
                  ? picked.filter((x) => x !== p)
                  : [...picked, p];
                setPicked(next);
                void sendAction({
                  kind: 'action',
                  action: 'set_platforms',
                  platforms: next,
                });
              }}
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: on ? 'var(--d-orange)' : 'var(--border)',
                background: on ? 'rgba(249,115,22,0.10)' : 'transparent',
                color: on ? 'var(--text-1)' : 'var(--text-3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {PLATFORM_LABEL[p] ?? p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Copies grid (shown during awaiting_copy_feedback) ───────

function CopiesGrid({ session, sendAction }: PreviewPanelProps) {
  return (
    <div style={{ marginTop: '14px' }}>
      <div
        className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3"
        style={{ marginBottom: '6px' }}
      >
        Captions ({session.copies.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {session.copies.map((c) => (
          <CopyCard
            key={c.platform}
            copy={c}
            session={session}
            sendAction={sendAction}
          />
        ))}
      </div>
      {session.state === 'awaiting_copy_feedback' && (
        <div style={{ marginTop: '10px' }}>
          <Button
            onClick={() =>
              void sendAction({ kind: 'action', action: 'approve_copies' })
            }
          >
            ✓ Approve all and save
          </Button>
        </div>
      )}
      {session.state === 'finalized' && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(16,185,129,0.10)',
            border: '1px solid rgba(16,185,129,0.3)',
            color: 'var(--d-green-2)',
            fontSize: '12px',
          }}
        >
          ✓ Saved to Library. Open the Library tab to schedule or publish.
        </div>
      )}
    </div>
  );
}

interface CopyCardProps {
  copy: PerPlatformCopy;
  session: Session;
  sendAction: (body: Record<string, unknown>) => Promise<void>;
}

function CopyCard({ copy, session, sendAction }: CopyCardProps) {
  const [direction, setDirection] = useState('');
  const canRegen = session.state === 'awaiting_copy_feedback';
  return (
    <div
      style={{
        padding: '10px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-2)',
          }}
        >
          {PLATFORM_LABEL[copy.platform] ?? copy.platform}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
          {copy.text.length} chars · {copy.hashtags.length}#
        </span>
      </div>
      <p
        style={{
          fontSize: '12px',
          color: 'var(--text-1)',
          whiteSpace: 'pre-wrap',
          marginBottom: '6px',
        }}
      >
        {copy.text}
      </p>
      {copy.hashtags.length > 0 && (
        <p
          style={{
            fontSize: '11px',
            color: 'var(--text-3)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {copy.hashtags.join(' ')}
        </p>
      )}
      {canRegen && (
        <div style={{ marginTop: '8px' }}>
          <input
            type="text"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Optional direction (e.g. more casual, shorter)"
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '11px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
              color: 'var(--text-1)',
              marginBottom: '6px',
            }}
          />
          <button
            type="button"
            onClick={() =>
              void sendAction({
                kind: 'action',
                action: 'regenerate_copy',
                platform: copy.platform,
                direction: direction.trim() || null,
              })
            }
            className="platform-btn platform-btn-ghost"
            style={{ fontSize: '11px' }}
          >
            🔄 Regenerate this one
          </button>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: '24px',
        height: '24px',
        border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }}
    />
  );
}

// Silence the unused Image import warning (kept around for a
// future <Image>-based switch if we ever want next/image
// optimization on fal.media URLs — they're remote-pattern-gated
// in next.config.mjs already).
void Image;
