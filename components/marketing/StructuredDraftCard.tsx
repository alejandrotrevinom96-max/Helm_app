'use client';

// PR #60 — Sprint 7.0.4: render one structured draft.
//
// One card per (platform, contentType) pair. The card dispatches to a
// sub-view based on the type so a Reel renders differently than a
// LinkedIn essay. Sub-views are dumb — they read fields off the
// structured payload, no fetching, no mutation.
//
// We keep this in components/marketing/ (new folder) instead of the
// existing app/(dashboard)/marketing/draft-card.tsx so the legacy
// Haiku-pillar-variants flow stays untouched.
import { useEffect, useRef, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { ShipsWheelLoader, PulseMarkLoader } from '@/components/ui/loaders';

interface Props {
  platform: string;
  contentType: string;
  displayName: string;
  // PR #61 — Sprint 7.0.4.1: accept `unknown` because Opus can
  // return anything from JSON.parse (string / number / array /
  // null / object). The runtime guard in DraftBody routes
  // non-objects to the Fallback view instead of crashing the
  // sub-views with `.title`/`.slides` access on a string.
  structuredContent: unknown;
  error?: string;
  draftId?: string;
  // PR Sprint 7.13 hotfix v2 (BUG 2) — surface the brand-fit
  // score badge right on the Generator card so the founder sees
  // it the moment generation finishes, not just when they
  // navigate to Library.
  consistencyScore?: number | null;
  // PR #80 — Sprint 7.5.2: restore the like/dislike affordance
  // that lived on the legacy DraftCard. Optional because:
  //   - Freshly-generated drafts don't have a vote yet (undefined
  //     resolves to neither button pressed).
  //   - The Library and other Card consumers can omit this prop
  //     if they're rendering historical drafts that already have
  //     a vote stored on the row.
  // Field name matches the DB column (PR #42 `userVote`), NOT
  // `userReaction` — Sprint 7.5.2 audit caught the plan using
  // the wrong field name.
  initialVote?: 'liked' | 'disliked' | null;
  // PR Sprint 7.13 hotfix v2 (BUG 3A) — needed for the single-
  // image generation handler: /api/visuals/generate requires
  // projectId in the body. The parent (StructuredGeneratePanel)
  // already knows it.
  projectId?: string;
  // PR Sprint 7.24 — Prompt 3. Variant chip surfaces "Option A" /
  // "Option B" on the card so founders can compare the pair at a
  // glance. Null/undefined on legacy single-variant generations.
  variantLabel?: 'A' | 'B' | null;
}

type VoteValue = 'liked' | 'disliked' | null;

interface ScheduleState {
  kind: 'idle' | 'scheduling' | 'scheduled' | 'error';
  message?: string;
  scheduledFor?: string;
}

interface SlideGenState {
  kind: 'idle' | 'generating' | 'ready' | 'error';
  urls: string[];
  message?: string;
  costUsd?: number;
}

export function StructuredDraftCard({
  platform,
  contentType,
  displayName,
  structuredContent,
  error,
  draftId,
  initialVote = null,
  consistencyScore = null,
  projectId,
  variantLabel = null,
}: Props) {
  const [copied, setCopied] = useState(false);
  // PR #80 — Sprint 7.5.2: vote state. Optimistic toggle on click;
  // a network failure resets to the prior value and surfaces the
  // error via the existing toast pattern that the rest of this
  // card uses inline. Voting `liked` again unsets to null
  // (Twitter-style toggle), matching how the legacy DraftCard
  // worked.
  const [vote, setVote] = useState<VoteValue>(initialVote);
  const [voteBusy, setVoteBusy] = useState(false);

  const handleVote = async (next: 'liked' | 'disliked') => {
    if (!draftId || voteBusy) return;
    const target: VoteValue = vote === next ? null : next;
    const prev = vote;
    setVote(target); // optimistic
    setVoteBusy(true);
    try {
      const res = await fetch(`/api/marketing/posts/${draftId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: target }),
      });
      if (!res.ok) {
        // Revert on server reject. We don't surface the error
        // chrome (it would steal focus from the generate flow) —
        // the visual unmount of the highlight tells the founder
        // it didn't stick.
        setVote(prev);
      }
    } catch {
      setVote(prev);
    } finally {
      setVoteBusy(false);
    }
  };
  // PR #64 — Sprint 7.0.7: inline schedule. Tomorrow 9am is the
  // default cadence (one-click); the founder can still drag to a
  // specific slot in Calendar after.
  const [schedule, setSchedule] = useState<ScheduleState>({ kind: 'idle' });
  // PR #65 — Sprint 7.0.8: carousel slide images. Generated on
  // demand via the /generate-slides endpoint. URLs persist in the
  // draft row server-side so a refresh would re-hydrate them; this
  // state is the in-session cache for the current card.
  const [slides, setSlides] = useState<SlideGenState>({
    kind: 'idle',
    urls: [],
  });

  // PR Sprint 7.25 Phase 8 — auto-fire image generation on mount.
  // Founders shouldn't have to click "Generate 8 slides" — Helm
  // absorbs the Flux cost out of margin. The refs below dedupe the
  // implicit auto-fire (we only want it once per card, not on every
  // state-induced re-render or React 18 strict-mode double-mount).
  // Both endpoints have a server-side cache short-circuit that
  // returns persisted URLs without re-charging Flux, so a duplicate
  // fire would be safe even without the ref — but the ref keeps the
  // network noise off the developer console.
  const autoFiredSlidesRef = useRef(false);
  const autoFiredSingleRef = useRef(false);
  // PR Sprint 7.25 Phase 9 — third auto-fire ref for HeyGen. The
  // server-side generate-structured route inserts a heygen_jobs
  // row with status='queued' for UGC/Reel drafts but doesn't
  // actually call HeyGen — the founder previously had to open the
  // Library detail modal and click "Generate video" to flip the
  // job to processing. Now the card auto-fires the HeyGen call on
  // mount so the queue actually moves. The endpoint itself is
  // idempotent (refuses to re-fire when status !== 'queued') so
  // re-mounts can't double-charge.
  const autoFiredHeygenRef = useRef(false);
  // Local mirror of heygenStatus so the badge flips from "queued"
  // to "processing" the instant /api/heygen/generate-video accepts
  // the call. Without this, the founder would see "queued" until
  // they refresh — which is exactly the visibility gap they
  // reported.
  const [heygenStatusOverride, setHeygenStatusOverride] = useState<
    'queued' | 'processing' | 'completed' | 'failed' | null
  >(null);
  const [heygenErrorMessage, setHeygenErrorMessage] = useState<string | null>(
    null,
  );
  // PR Sprint 7.25 Phase 11.10 — separate slot for the raw HeyGen
  // upstream error string. `heygenErrorMessage` is the friendly
  // mapped copy ("Voice configuration issue. Update your avatar
  // in Settings."); `heygenUpstreamError` is what HeyGen actually
  // said ("Avatar abc123 not found", "Invalid voice_id", etc.).
  // Rendered as small mono text under the friendly message so
  // the founder can act on the real reason when the mapped copy
  // turns out to be misleading.
  const [heygenUpstreamError, setHeygenUpstreamError] = useState<
    string | null
  >(null);

  const handleCopy = async () => {
    if (structuredContent == null) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(structuredContent, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — no-op */
    }
  };

  const handleScheduleTomorrow = async () => {
    if (!draftId || schedule.kind === 'scheduling') return;
    // Local-time "tomorrow at 09:00" — the founder's browser timezone.
    // The cron honors UTC instants, so we convert once at submit.
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    setSchedule({ kind: 'scheduling' });
    try {
      const res = await fetch(`/api/marketing/library/${draftId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: t.toISOString() }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        code?: string;
      };
      if (!res.ok || !data.success) {
        setSchedule({
          kind: 'error',
          message: data.error ?? 'Failed to schedule',
        });
        return;
      }
      setSchedule({
        kind: 'scheduled',
        scheduledFor: t.toISOString(),
      });
    } catch (e) {
      setSchedule({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  const openInCalendar = () => {
    if (!draftId) return;
    // Calendar accepts a draftId query param to pre-select the
    // draft for manual placement. The Calendar client picks it up
    // on mount and offers a "Drop here" affordance.
    window.location.href = `/marketing/calendar?draftId=${encodeURIComponent(draftId)}`;
  };

  // PR Sprint 7.13 hotfix v2 (BUG 3A) — single-image Flux state +
  // handler. Parallel to slides but hits /api/visuals/generate
  // instead of /api/marketing/posts/[id]/generate-slides. The
  // endpoint response shape is `{ ok, visual: { url, ... } }`
  // (not `{ url }`) — Sprint 7.12's Library modal misread it,
  // which is why generated singles "vanished". We unwrap
  // visual.url correctly here.
  const [singleImage, setSingleImage] = useState<{
    kind: 'idle' | 'generating' | 'ready' | 'error';
    url?: string;
    message?: string;
  }>({ kind: 'idle' });

  const handleGenerateSingleImage = async (forceRegen = false) => {
    if (!draftId || singleImage.kind === 'generating') return;
    setSingleImage({ kind: 'generating' });
    try {
      // Pull a content hint from the structured payload. Most
      // single-image types have `imageDirection` or `caption`;
      // fall back to a generic prompt when neither exists so
      // Flux still gets something brand-aware to work with.
      const sc = payload ?? {};
      const postContent =
        (typeof sc.imageDirection === 'string' && sc.imageDirection) ||
        (typeof sc.caption === 'string' && sc.caption) ||
        (typeof sc.content === 'string' && sc.content) ||
        'Generate a brand-aligned image for this post.';

      // PR Sprint 7.25 Phase 8 — pass `?regenerate=1` only when the
      // founder explicitly clicked Regenerate. On the implicit
      // auto-fire (mount) we want the server to return the cached
      // image instantly when one exists so we don't re-charge Flux
      // on every Library navigation.
      const res = await fetch(
        `/api/visuals/generate${forceRegen ? '?regenerate=1' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            platform,
            postContent,
            draftId,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        visual?: { url?: string };
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.ok || !data.visual?.url) {
        setSingleImage({
          kind: 'error',
          message: data.error ?? data.hint ?? 'Image generation failed',
        });
        return;
      }
      setSingleImage({ kind: 'ready', url: data.visual.url });
    } catch (e) {
      setSingleImage({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  // PR #65 — Sprint 7.0.8: kick off slide image generation.
  //
  // PR Sprint 7.25 Phase 8 — image generation is now AUTO-FIRED on
  // mount (see useEffect below). Helm absorbs the cost (~$0.30 per
  // carousel) — the founder doesn't see a cost prompt anymore.
  // This handler still exists for the "↻ Regenerate" button.
  // forceRegen=true bypasses the server-side cache, so Regenerate
  // burns a fresh Flux pass. The implicit mount auto-fire passes
  // forceRegen=false and gets the cached URLs instantly when the
  // draft already has them (re-mount / Library nav case).
  const handleGenerateSlides = async (forceRegen = false) => {
    if (!draftId || slides.kind === 'generating') return;
    setSlides({ ...slides, kind: 'generating', message: undefined });
    try {
      const res = await fetch(
        `/api/marketing/posts/${draftId}/generate-slides${forceRegen ? '?regenerate=1' : ''}`,
        { method: 'POST' },
      );
      // PR Sprint 7.25 Phase 11.9 — defensive parse. The endpoint
      // now always returns JSON (Phase-11.9 server-side try/catch),
      // but if a deploy lag or a route-level Next crash gives us
      // plain text, .json() throws and the founder used to see
      // "Unexpected token 'A', 'An error o'… is not valid JSON".
      // Parse via .text() + JSON.parse with a fallback so the user
      // gets a real message even when the server misbehaves.
      const rawText = await res.text();
      let data: {
        success?: boolean;
        visualUrls?: (string | null)[];
        slidesGenerated?: number;
        slidesRequested?: number;
        estimatedCostUsd?: number;
        error?: string;
        hint?: string;
        failures?: { slideIndex: number; reason: string }[];
      } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        // Plain-text Vercel error pages start with "An error
        // occurred" — surface that as a friendly message instead
        // of the JSON parse exception.
        const looksLikeVercelErrorPage =
          rawText.startsWith('An error') || rawText.startsWith('<!DOCTYPE');
        data = {
          success: false,
          error: looksLikeVercelErrorPage
            ? 'Server didn’t respond with JSON (deployment may still be warming up).'
            : `Unexpected response: ${rawText.slice(0, 120)}`,
          hint: 'Try again in a few seconds.',
        };
      }
      if (!res.ok || !data.success) {
        setSlides({
          kind: 'error',
          urls: [],
          message: data.error ?? data.hint ?? 'Slide generation failed',
        });
        return;
      }
      const urls = (data.visualUrls ?? []).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      );
      const partial =
        (data.slidesGenerated ?? 0) < (data.slidesRequested ?? urls.length);
      setSlides({
        kind: partial ? 'error' : 'ready',
        urls,
        costUsd: data.estimatedCostUsd,
        message: partial
          ? `Partial: ${data.slidesGenerated}/${data.slidesRequested} slides generated. Retry to complete.`
          : undefined,
      });
    } catch (e) {
      setSlides({
        kind: 'error',
        urls: [],
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  };

  // Object-shape gate. JSON.parse can return string / number / array
  // / null / object — anything but a plain object would crash the
  // sub-views as soon as they touch `.title` etc. Route those to the
  // Fallback view which just stringifies the payload.
  const payload = isPlainObject(structuredContent)
    ? (structuredContent as Record<string, unknown>)
    : null;

  // PR Sprint 7.25 Phase 8 — auto-fire slide image generation on
  // mount for carousels. Guarded by:
  //   - draftId present (no DB row → nothing to attach images to)
  //   - payload is a real object with at least one slide
  //   - we haven't already fired (ref guard against re-renders +
  //     React 18 strict-mode double-mounts)
  //   - state is still idle (a fast re-render with stale closures
  //     could otherwise fire after the user already kicked off a
  //     manual regenerate)
  // The server endpoint caches persisted URLs, so a re-mount on a
  // carousel with images already saved returns instantly (cost = $0)
  // and the state flips from 'generating' to 'ready' within ~200ms.
  useEffect(() => {
    if (autoFiredSlidesRef.current) return;
    if (!draftId) return;
    if (contentType !== 'carousel') return;
    if (!payload) return;
    if (slides.kind !== 'idle' || slides.urls.length > 0) return;
    const slideCount = countSlides(payload);
    if (slideCount === 0) return;
    autoFiredSlidesRef.current = true;
    void handleGenerateSlides();
    // We intentionally depend ONLY on the primitive props that
    // could legitimately change the "should we fire?" answer.
    // The handler closure captures the latest setSlides via React's
    // setState identity, so adding it to deps would cause double
    // fires on every state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, contentType, payload]);

  // Same pattern as the carousel auto-fire above, but for single-
  // image content types. Both Flux endpoints share the server-side
  // cache short-circuit so a re-mount on a draft that already has
  // imageUrl persisted returns the URL instantly without charging.
  useEffect(() => {
    if (autoFiredSingleRef.current) return;
    if (!draftId || !projectId) return;
    if (contentType !== 'photo' && contentType !== 'single_image') return;
    if (!payload) return;
    if (singleImage.kind !== 'idle' || singleImage.url) return;
    autoFiredSingleRef.current = true;
    void handleGenerateSingleImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, projectId, contentType, payload]);

  // PR Sprint 7.25 Phase 9 — auto-fire HeyGen for UGC/Reel drafts
  // that already have a queued job row (created server-side by
  // /api/ai/generate-structured). Without this, the queue sat
  // there forever waiting for the founder to open Library and
  // click "Generate video". /api/heygen/generate-video is
  // idempotent (refuses re-fire when job.status !== 'queued') and
  // returns errorKind='not_configured' when the project has no
  // avatar configured — we surface that to the badge so the
  // founder can fix it in Settings instead of staring at "queued"
  // forever.
  // PR Sprint 7.25 Phase 11.6 — extracted into a callable handler
  // so the new "↻ Retry video" button next to the failed badge can
  // re-fire without relying on a re-mount of the card.
  const fireHeygen = async (jobId: string) => {
    setHeygenStatusOverride('queued');
    setHeygenErrorMessage(null);
    setHeygenUpstreamError(null);
    try {
      const res = await fetch('/api/heygen/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        hint?: string;
        errorKind?: string;
        upstreamError?: string;
      };
      if (!res.ok || !data.success) {
        // not_configured = no avatar in Settings → actionable.
        // feature_disabled = HEYGEN_ENABLED off in env → ops issue.
        // invalid_state = already processing → benign, keep
        // showing "queued" until the next refresh picks up the
        // server-side status.
        if (data.errorKind === 'invalid_state') return;
        setHeygenStatusOverride('failed');
        const friendly =
          data.errorKind === 'not_configured'
            ? 'No avatar set. Open Settings → Video Avatar to pick one.'
            : data.errorKind === 'feature_disabled'
              ? 'Video generation is off on this deployment. Queue will process when it ships.'
              : data.errorKind === 'voice_config'
                ? 'Voice configuration issue. If you just updated your avatar, the queue auto-retries in ~60s. Otherwise check the upstream message below.'
                : (data.hint ?? data.error ?? 'Video generation failed to start');
        setHeygenErrorMessage(friendly);
        // PR Sprint 7.25 Phase 11.10 — capture the raw HeyGen
        // error so the founder sees what HeyGen actually said
        // (vs the friendly mapped copy that can be misleading).
        if (data.upstreamError) {
          setHeygenUpstreamError(data.upstreamError);
        }
        return;
      }
      // HeyGen accepted the call → server flipped status to
      // 'processing'. Mirror that in local state so the badge
      // flips immediately instead of waiting for a Library refresh.
      setHeygenStatusOverride('processing');
    } catch (e) {
      setHeygenStatusOverride('failed');
      setHeygenErrorMessage(
        e instanceof Error ? e.message : 'Network error',
      );
    }
  };

  const heygenJobIdFromPayload =
    payload && typeof payload.heygenJobId === 'string'
      ? payload.heygenJobId
      : null;

  const handleRetryHeygen = () => {
    if (!heygenJobIdFromPayload) return;
    void fireHeygen(heygenJobIdFromPayload);
  };

  useEffect(() => {
    if (autoFiredHeygenRef.current) return;
    if (!payload) return;
    const status =
      typeof payload.heygenStatus === 'string' ? payload.heygenStatus : null;
    if (status !== 'queued' || !heygenJobIdFromPayload) return;
    if (contentType !== 'ugc' && contentType !== 'reel') return;
    autoFiredHeygenRef.current = true;
    void fireHeygen(heygenJobIdFromPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, payload, heygenJobIdFromPayload]);

  // PR #76 — Sprint 7.3: HeyGen status badge. The server attaches
  // heygenJobId + heygenStatus to structuredContent for video-needing
  // types (reel, ugc). We surface it as a non-blocking badge so the
  // founder knows the script is ready but the rendered video is
  // pending. typeof guards because structuredContent is jsonb and
  // could legally be anything Opus returned.
  // PR Sprint 7.25 Phase 9 — the local override (set by the auto-
  // fire useEffect once HeyGen accepts the call) wins over the
  // server-stamped status from the payload. That keeps the badge
  // accurate in this session even though we haven't refetched the
  // draft row.
  const payloadHeygenStatus =
    payload && typeof payload.heygenStatus === 'string'
      ? payload.heygenStatus
      : null;
  const heygenStatus = heygenStatusOverride ?? payloadHeygenStatus;
  const heygenVideoUrl =
    payload && typeof payload.videoUrl === 'string'
      ? payload.videoUrl
      : null;

  return (
    <GlassCard className="p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-2">
              {platform}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              {contentType.replace(/_/g, ' ')}
            </span>
            {/* PR Sprint 7.24 — Prompt 3. Variant chip. Soft
                terracotta tint so it reads as "this is one of a pair"
                not "this is an error/warning". Hover text spells out
                the comparison framing. */}
            {variantLabel && (
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30"
                title="Generated at the same time as the other variant — pick your favorite, delete the other."
              >
                Option {variantLabel}
              </span>
            )}
            {/* PR Sprint 7.13 hotfix v2 (BUG 2) — Brand fit badge.
                Same pill style as the post-card so the founder
                sees a consistent signal across Generator and
                Library. Color buckets: ≥80 green, 50-79 accent
                (on-brand), <50 danger (off-brand). */}
            {typeof consistencyScore === 'number' && (
              <span
                className={`text-[10px] font-mono uppercase tracking-[0.15em] font-bold px-2 py-0.5 rounded ${
                  consistencyScore >= 80
                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                    : consistencyScore >= 50
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'bg-danger/15 text-danger border border-danger/30'
                }`}
                title="How well this draft matches your brand bible."
              >
                Brand fit {consistencyScore}/100
              </span>
            )}
            {heygenStatus === 'queued' && (
              <span
                className="helm-loader-inline"
                title="The script is ready. Helm is rendering the video — usually 60-120s."
                aria-label="Video queued"
              >
                <PulseMarkLoader
                  size={20}
                  vertical={false}
                  label="Video queued"
                  // No subLabel — keeps the inline badge thin.
                />
              </span>
            )}
            {heygenStatus === 'processing' && (
              <span
                className="helm-loader-inline"
                title="Helm is rendering the video right now."
                aria-label="Video rendering"
              >
                <PulseMarkLoader
                  size={20}
                  vertical={false}
                  label="Rendering video"
                />
              </span>
            )}
            {heygenStatus === 'completed' && heygenVideoUrl && (
              <a
                href={heygenVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25"
              >
                ▶ watch video
              </a>
            )}
            {heygenStatus === 'failed' && (
              // PR Sprint 7.25 Phase 11.6 — was a single chip with
              // the error in a tooltip; the founder reported they
              // couldn't tell WHY the video failed without hovering.
              // Now: the chip stays for the at-a-glance status, but
              // an explicit "↻ Retry" button sits beside it for one-
              // click recovery. The full error message renders below
              // the header in <HeygenFailureBlock />.
              <>
                <span
                  className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-danger/15 text-danger border border-danger/30"
                  title={heygenErrorMessage ?? 'Video generation failed.'}
                >
                  🎬 video failed
                </span>
                {heygenJobIdFromPayload && (
                  <button
                    type="button"
                    onClick={handleRetryHeygen}
                    className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
                    title="Re-queue the video. Server caps total tries at 3 — beyond that the worker stops auto-retrying."
                  >
                    ↻ retry
                  </button>
                )}
              </>
            )}
          </div>
          <h3 className="font-display text-lg font-light">{displayName}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* PR #80 — Sprint 7.5.2: vote (👍/👎) restored. The
              legacy DraftCard had these inline; Sprint 7.3
              promoted StructuredDraftCard without them. The
              vote feeds Voice Memory (lib/voice/fingerprint.ts
              extracts patterns from liked drafts; the Hidden
              filter in Library uses disliked). Each press
              toggles — clicking the active button clears.
              Disabled until the draftId is present (no DB row =
              nothing to vote on). */}
          {draftId && (
            <>
              <button
                type="button"
                onClick={() => handleVote('liked')}
                disabled={voteBusy}
                aria-pressed={vote === 'liked'}
                aria-label={vote === 'liked' ? 'Unlike' : 'Like'}
                className={`text-base leading-none px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                  vote === 'liked'
                    ? 'bg-emerald-500/20 text-emerald-500'
                    : 'text-text-3 hover:text-text-1 hover:bg-bg-elev'
                }`}
                title="Like — feeds voice memory"
              >
                👍
              </button>
              <button
                type="button"
                onClick={() => handleVote('disliked')}
                disabled={voteBusy}
                aria-pressed={vote === 'disliked'}
                aria-label={vote === 'disliked' ? 'Restore' : 'Hide'}
                className={`text-base leading-none px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                  vote === 'disliked'
                    ? 'bg-danger/20 text-danger'
                    : 'text-text-3 hover:text-text-1 hover:bg-bg-elev'
                }`}
                title="Hide — removes from default library view"
              >
                👎
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={structuredContent == null}
            className="text-xs font-mono text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            {copied ? 'Copied ✓' : 'Copy JSON'}
          </button>
          {/* PR #64 — Sprint 7.0.7: inline schedule. Only rendered
              when we have a draftId (always true for newly-generated
              drafts; absent for the rare "preview-only" path). */}
          {draftId && schedule.kind !== 'scheduled' && (
            <>
              <button
                type="button"
                onClick={openInCalendar}
                disabled={schedule.kind === 'scheduling'}
                className="text-xs font-mono px-2 py-1 rounded border border-border hover:border-border-bright disabled:opacity-50"
              >
                Schedule…
              </button>
              <button
                type="button"
                onClick={handleScheduleTomorrow}
                disabled={schedule.kind === 'scheduling'}
                className="text-xs font-mono px-2 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
                title="Schedule for tomorrow at 9:00 AM (your local time)"
              >
                {schedule.kind === 'scheduling'
                  ? 'Scheduling…'
                  : 'Schedule 9am →'}
              </button>
            </>
          )}
          {schedule.kind === 'scheduled' && (
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded bg-emerald-500/15 text-emerald-600">
              ✓ Scheduled
            </span>
          )}
        </div>
      </header>

      {/* PR #64 — Sprint 7.0.7: schedule error surface. The
          schedule endpoint returns a concrete reason when a
          structured draft can't be auto-published yet (e.g.
          "Reel script ready, but auto-publish needs a video.").
          We render the full message so the founder can act. */}
      {schedule.kind === 'error' && (
        <div className="mb-4 p-3 border border-danger/30 bg-danger/10 rounded text-xs text-danger">
          {schedule.message}
        </div>
      )}

      {/* PR Sprint 7.25 Phase 11.6 — surface HeyGen failure details
          inline. Pre-fix the only signal was the small "🎬 video
          failed" chip + a tooltip. Founders kept asking "why?" and
          had to open the Library detail modal to find out.
          PR Sprint 7.25 Phase 11.10 — also show the raw HeyGen
          upstream error string in small mono text. The mapped
          friendly copy can be misleading (e.g. "Voice
          configuration issue" when the actual problem is an
          unregistered talking_photo URL) — surfacing the raw
          message lets the founder act on the real reason. */}
      {heygenStatus === 'failed' && heygenErrorMessage && (
        <div className="mb-4 p-3 border border-danger/30 bg-danger/10 rounded text-xs text-danger flex items-start gap-2">
          <span aria-hidden>🎬</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold mb-0.5">Video didn&apos;t start.</div>
            <div className="text-danger/90">{heygenErrorMessage}</div>
            {heygenUpstreamError && (
              <details className="mt-2">
                <summary className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-3 cursor-pointer hover:text-text-2">
                  Renderer said
                </summary>
                <div className="mt-1 p-2 rounded bg-bg-elev border border-border font-mono text-[11px] text-text-2 break-words">
                  {heygenUpstreamError}
                </div>
              </details>
            )}
          </div>
          {heygenJobIdFromPayload && (
            <button
              type="button"
              onClick={handleRetryHeygen}
              className="shrink-0 text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30"
            >
              ↻ Retry
            </button>
          )}
        </div>
      )}

      {/* PR #65 — Sprint 7.0.8: Carousel slide image generation
          surface. Only renders for contentType='carousel' drafts;
          everything else skips this block. */}
      {contentType === 'carousel' && payload != null && (
        <CarouselSlideImagesBlock
          slideCount={countSlides(payload)}
          state={slides}
          // PR Sprint 7.25 Phase 8 — pass forceRegen=true only when
          // the user is explicitly regenerating (state was already
          // 'ready'). On first manual click after an auto-fire
          // failure, forceRegen=false lets the server cache short-
          // circuit kick in if the URLs landed via a parallel call.
          onGenerate={() =>
            handleGenerateSlides(slides.kind === 'ready')
          }
          canGenerate={Boolean(draftId)}
        />
      )}

      {/* PR Sprint 7.13 hotfix v2 (BUG 3A) — Single-photo Flux
          surface. Parallel to the carousel block above but for
          single-image content types. Pre-fix Single Photo drafts
          had no image-generation UI on the Generator page; the
          founder had to navigate to Library and find the button
          inside the modal. Now they can fire Flux from the card
          immediately. */}
      {(contentType === 'photo' ||
        contentType === 'single_image') &&
        payload != null && (
          <SinglePhotoImageBlock
            state={singleImage}
            // Same forceRegen-only-on-Regenerate logic as the
            // carousel block above.
            onGenerate={() =>
              handleGenerateSingleImage(singleImage.kind === 'ready')
            }
            canGenerate={Boolean(draftId && projectId)}
          />
        )}

      {error ? (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded text-sm text-danger">
          Generation failed: {error}
        </div>
      ) : structuredContent == null ? (
        <div className="text-sm text-text-3">Empty draft.</div>
      ) : payload == null ? (
        // Non-object top-level (string/number/array/etc). Show raw
        // so the founder can at least see what the model returned.
        <FallbackView payload={{ raw: structuredContent }} />
      ) : (
        <DraftBody contentType={contentType} payload={payload} />
      )}
    </GlassCard>
  );
}

// PR #65 — Sprint 7.0.8: carousel slide images UI block.
function CarouselSlideImagesBlock({
  slideCount,
  state,
  onGenerate,
  canGenerate,
}: {
  slideCount: number;
  state: SlideGenState;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  if (slideCount === 0) return null;
  const hasUrls = state.urls.length > 0;
  const isGenerating = state.kind === 'generating';
  return (
    <div className="mb-4 p-3 border border-border rounded-lg bg-bg-elev/40">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          Slide images
          {hasUrls && state.kind === 'ready' && (
            <span className="ml-2 text-emerald-500">
              ✓ {state.urls.length}/{slideCount} ready
            </span>
          )}
        </div>
        {isGenerating ? (
          // PR Sprint 7.25 Phase 9 — inline Ship's Wheel replaces
          // the "Generating N slides…" plain-text state. Same
          // semantic (work in flight), much better visual signal.
          <ShipsWheelLoader
            size={32}
            vertical={false}
            label="Charting slides"
            subLabel={`${slideCount} images`}
          />
        ) : state.kind !== 'ready' || state.urls.length < slideCount ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="text-xs font-mono px-2 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
            title={`Generates ${slideCount} AI images`}
          >
            {hasUrls ? '↻ Regenerate' : `🎨 Generate ${slideCount} slides`}
          </button>
        ) : null}
      </div>
      {state.message && (
        <div
          className={`text-xs mb-2 ${
            state.kind === 'error' ? 'text-danger' : 'text-text-2'
          }`}
        >
          {state.message}
        </div>
      )}
      {hasUrls && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {state.urls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${i}-${url.slice(-20)}`}
              src={url}
              alt={`Slide ${i + 1}`}
              className="w-full aspect-square object-cover rounded bg-bg"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// PR Sprint 7.13 hotfix v2 (BUG 3A) — single-image surface.
// Mirrors CarouselSlideImagesBlock for non-carousel image
// content types (Instagram photo, LinkedIn single_image, TikTok
// photo, etc.). One Flux call per draft (~$0.05).
function SinglePhotoImageBlock({
  state,
  onGenerate,
  canGenerate,
}: {
  state: {
    kind: 'idle' | 'generating' | 'ready' | 'error';
    url?: string;
    message?: string;
  };
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  const ready = state.kind === 'ready' && state.url;
  const isGenerating = state.kind === 'generating';
  return (
    <div className="mb-4 p-3 border border-border rounded-lg bg-bg-elev/40">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          Image
          {ready && <span className="ml-2 text-emerald-500">✓ ready</span>}
        </div>
        {isGenerating ? (
          // Ship's Wheel inline — same loader used for carousel
          // slides so the founder learns one visual language for
          // "Helm is making a picture for me".
          <ShipsWheelLoader
            size={32}
            vertical={false}
            label="Painting image"
          />
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="text-xs font-mono px-2 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
            title="Generate AI image"
          >
            {ready ? '↻ Regenerate' : '🎨 Generate image'}
          </button>
        )}
      </div>
      {state.message && (
        <div
          className={`text-xs mb-2 ${
            state.kind === 'error' ? 'text-danger' : 'text-text-2'
          }`}
        >
          {state.message}
        </div>
      )}
      {ready && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.url}
          alt="Generated"
          className="w-full max-w-sm aspect-square object-cover rounded bg-bg"
        />
      )}
    </div>
  );
}

function countSlides(payload: Record<string, unknown>): number {
  const slides = payload.slides;
  return Array.isArray(slides) ? slides.length : 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    // Reject DOM nodes / class instances — only plain {} survives.
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}

function DraftBody({
  contentType,
  payload,
}: {
  contentType: string;
  payload: Record<string, unknown>;
}) {
  switch (contentType) {
    // PR Sprint 7.24 — both 'reel' and 'ugc' produce the UGCBundle
    // shape (Sprint 7.18 taxonomy collapse) so they share the same
    // view. Pre-fix this branch routed to ReelView/UgcView which
    // each read the legacy {hook:string, beats:[]} or {opening,
    // body, closing} shapes that no longer exist post-7.18.
    case 'reel':
    case 'ugc':
      return <UgcBundleView payload={payload} />;
    case 'carousel':
      return <CarouselView payload={payload} />;
    case 'photo':
    case 'single_image':
      return <PhotoView payload={payload} />;
    case 'community_post':
      return <CommunityPostView payload={payload} />;
    case 'text_post':
      return <TextPostView payload={payload} />;
    case 'self_post':
      return <RedditSelfPostView payload={payload} />;
    case 'link_post':
      return <RedditLinkPostView payload={payload} />;
    case 'single_tweet':
      return <SingleTweetView payload={payload} />;
    case 'thread':
      return <ThreadView payload={payload} />;
    default:
      return <FallbackView payload={payload} />;
  }
}

// ----- helpers ---------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
      {children}
    </div>
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}
function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    : [];
}

// ----- sub-views -------------------------------------------------------------

// PR Sprint 7.24 — UGCBundle renderer. Replaces the legacy ReelView
// and UgcView, both of which read pre-7.18 shapes that no longer
// match what the generator produces. UGCBundle is a structured
// teleprompter-friendly script with hook / body[] / cta / overlays
// / caption / hashtags / metadata — see lib/voice-engine/ugc-schema.ts.
//
// Layout reads as a recordable script with timecodes so the founder
// can use the card itself as their teleprompter:
//   [HOOK · 0-Xs · delivery]
//     "<hook text>"
//   [BODY]
//     Beat 1 (Xs · delivery): "<text>"
//     Beat 2 (Ys · delivery): "<text>"
//     ...
//   [CTA · Xs · delivery]
//     "<cta text>"
//   [OVERLAYS]
//     0.5s — "DROPPED"
//     2.3s — "BUFFER ❌"
//   [CAPTION]
//     <caption text>
//   [HASHTAGS]
//     #tag1 #tag2 #tag3
function UgcBundleView({ payload }: { payload: Record<string, unknown> }) {
  const hook = (payload.hook ?? {}) as Record<string, unknown>;
  const body = asObjectArray(payload.body);
  const cta = (payload.cta ?? {}) as Record<string, unknown>;
  const overlays = asObjectArray(payload.overlays);
  const caption = asString(payload.caption);
  const hashtags = asStringArray(payload.hashtags);

  const hookText = asString(hook.text);
  const hookDur = typeof hook.duration_seconds === 'number'
    ? hook.duration_seconds
    : null;
  const hookDelivery = asString(hook.delivery);

  const ctaText = asString(cta.text);
  const ctaDur = typeof cta.duration_seconds === 'number'
    ? cta.duration_seconds
    : null;
  const ctaDelivery = asString(cta.delivery);

  const totalDuration =
    (hookDur ?? 0) +
    body.reduce((sum, b) => {
      const d = typeof b.duration_seconds === 'number' ? b.duration_seconds : 0;
      return sum + d;
    }, 0) +
    (ctaDur ?? 0);

  return (
    <div className="space-y-4">
      {hookText && (
        <div>
          <Label>
            Hook
            {hookDur !== null && (
              <span className="ml-2 normal-case tracking-normal text-text-3">
                · {hookDur.toFixed(1)}s
              </span>
            )}
            {hookDelivery && (
              <span className="ml-2 normal-case tracking-normal text-accent">
                · {hookDelivery}
              </span>
            )}
          </Label>
          <p className="text-sm italic text-text-1">&ldquo;{hookText}&rdquo;</p>
        </div>
      )}

      {body.length > 0 && (
        <div>
          <Label>Body — {body.length} beat{body.length === 1 ? '' : 's'}</Label>
          <ol className="space-y-2">
            {body.map((b, i) => {
              const beat = typeof b.beat === 'number' ? b.beat : i + 1;
              const text = asString(b.text);
              const dur =
                typeof b.duration_seconds === 'number' ? b.duration_seconds : null;
              const delivery = asString(b.delivery);
              return (
                <li key={i} className="text-sm text-text-1">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="font-mono text-[11px] text-text-3 shrink-0">
                      Beat {beat}
                    </span>
                    {dur !== null && (
                      <span className="font-mono text-[11px] text-text-3 shrink-0">
                        · {dur.toFixed(1)}s
                      </span>
                    )}
                    {delivery && (
                      <span className="font-mono text-[11px] text-accent shrink-0">
                        · {delivery}
                      </span>
                    )}
                  </div>
                  <p className="ml-0">&ldquo;{text}&rdquo;</p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {ctaText && (
        <div>
          <Label>
            CTA
            {ctaDur !== null && (
              <span className="ml-2 normal-case tracking-normal text-text-3">
                · {ctaDur.toFixed(1)}s
              </span>
            )}
            {ctaDelivery && (
              <span className="ml-2 normal-case tracking-normal text-accent">
                · {ctaDelivery}
              </span>
            )}
          </Label>
          <p className="text-sm italic text-text-1">&ldquo;{ctaText}&rdquo;</p>
        </div>
      )}

      {totalDuration > 0 && (
        <div className="text-[11px] font-mono text-text-3">
          Total spoken duration: ~{totalDuration.toFixed(1)}s
        </div>
      )}

      {overlays.length > 0 && (
        <div>
          <Label>On-screen overlays · {overlays.length}</Label>
          <ul className="space-y-1">
            {overlays.map((o, i) => {
              const trigger =
                typeof o.trigger_at_seconds === 'number'
                  ? o.trigger_at_seconds
                  : null;
              const dur =
                typeof o.duration_seconds === 'number' ? o.duration_seconds : null;
              const text = asString(o.text);
              return (
                <li
                  key={i}
                  className="text-xs text-text-1 flex items-baseline gap-2"
                >
                  <span className="font-mono text-text-3 shrink-0">
                    {trigger !== null ? `${trigger.toFixed(1)}s` : '—'}
                    {dur !== null ? `–${(trigger ?? 0 + dur).toFixed(1)}s` : ''}
                  </span>
                  <span className="px-2 py-0.5 bg-bg-elev rounded font-medium">
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {caption && (
        <div>
          <Label>Caption ({caption.length} chars)</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}

      {hashtags.length > 0 && (
        <div>
          <Label>Hashtags</Label>
          <p className="text-xs text-text-2">
            {hashtags.map((h) => `#${h}`).join(' ')}
          </p>
        </div>
      )}
    </div>
  );
}

function CarouselView({ payload }: { payload: Record<string, unknown> }) {
  const slides = asObjectArray(payload.slides);
  const caption = asString(payload.caption) || asString(payload.coverCopy);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {slides.map((s, i) => {
          const role = asString(s.role) || 'slide';
          return (
            <div key={i} className="p-3 bg-bg-elev rounded text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  Slide {i + 1}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  {role}
                </span>
              </div>
              <div className="font-medium text-text-1">{asString(s.title)}</div>
              {asString(s.body) && (
                <div className="text-xs text-text-2 mt-1">{asString(s.body)}</div>
              )}
            </div>
          );
        })}
      </div>
      {caption && (
        <div>
          <Label>Caption</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}
    </div>
  );
}

function PhotoView({ payload }: { payload: Record<string, unknown> }) {
  const direction = asString(payload.imageDirection);
  const caption = asString(payload.caption) || asString(payload.copy);
  return (
    <div className="space-y-4">
      {direction && (
        <div>
          <Label>Image direction</Label>
          <p className="text-sm italic text-text-1">{direction}</p>
        </div>
      )}
      {caption && (
        <div>
          <Label>Caption ({caption.length} chars)</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}
    </div>
  );
}

// PR Sprint 7.24 — UgcView removed. The legacy renderer read
// payload.opening/body/closing which no longer exist post-7.18.
// UGC content type now routes to UgcBundleView (above) which reads
// the real UGCBundle shape: hook + body[] + cta + overlays + caption
// + hashtags + metadata.

function CommunityPostView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Opening</Label>
        <p className="text-sm text-text-1">{asString(payload.opening)}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{asString(payload.body)}</p>
      </div>
      <div>
        <Label>Closing</Label>
        <p className="text-sm text-text-1">{asString(payload.closing)}</p>
      </div>
    </div>
  );
}

function TextPostView({ payload }: { payload: Record<string, unknown> }) {
  const hook = asString(payload.hook);
  const bodyParas = asStringArray(payload.body);
  const cta = asString(payload.cta);
  return (
    <div className="space-y-3">
      {hook && (
        <div className="text-base italic text-text-1">{hook}</div>
      )}
      {bodyParas.map((p, i) => (
        <p key={i} className="text-sm text-text-1">
          {p}
        </p>
      ))}
      {cta && (
        <p className="text-sm text-text-2 italic border-l-2 border-accent/40 pl-3">
          {cta}
        </p>
      )}
    </div>
  );
}

function RedditSelfPostView({ payload }: { payload: Record<string, unknown> }) {
  const title = asString(payload.title);
  const body = asString(payload.body);
  const tldr = asString(payload.optionalTldr);
  return (
    <div className="space-y-3">
      <div>
        <Label>Title ({title.length} chars)</Label>
        <p className="text-sm font-medium text-text-1">{title}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{body}</p>
      </div>
      {tldr && (
        <div>
          <Label>TL;DR</Label>
          <p className="text-sm italic text-text-2">{tldr}</p>
        </div>
      )}
    </div>
  );
}

function RedditLinkPostView({ payload }: { payload: Record<string, unknown> }) {
  const title = asString(payload.title);
  const comment = asString(payload.optionalComment);
  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <p className="text-sm font-medium text-text-1">{title}</p>
      </div>
      {comment && (
        <div>
          <Label>Optional context comment</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{comment}</p>
        </div>
      )}
    </div>
  );
}

function SingleTweetView({ payload }: { payload: Record<string, unknown> }) {
  const content = asString(payload.content);
  return (
    <div className="space-y-1">
      <p className="text-sm whitespace-pre-wrap text-text-1">{content}</p>
      <p className="text-[11px] font-mono text-text-3">
        {content.length} / 280 chars
      </p>
    </div>
  );
}

function ThreadView({ payload }: { payload: Record<string, unknown> }) {
  const tweets = asStringArray(payload.tweets);
  return (
    <div className="space-y-2">
      {tweets.map((t, i) => (
        <div key={i} className="p-3 bg-bg-elev rounded">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            {i + 1} / {tweets.length}
          </div>
          <p className="text-sm text-text-1">{t}</p>
          <p className="text-[11px] font-mono text-text-3 mt-1">{t.length} / 280</p>
        </div>
      ))}
    </div>
  );
}

function FallbackView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <pre className="text-xs font-mono text-text-2 bg-bg-elev p-3 rounded overflow-x-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
