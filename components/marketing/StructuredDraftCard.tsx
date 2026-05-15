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
import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';

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

  const handleGenerateSingleImage = async () => {
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

      const res = await fetch('/api/visuals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          platform,
          postContent,
          draftId,
        }),
      });
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

  // PR #65 — Sprint 7.0.8: kick off slide image generation. Each
  // slide costs ~$0.05; we surface the total upfront so the
  // founder consents to spend before the call fires.
  const handleGenerateSlides = async () => {
    if (!draftId || slides.kind === 'generating') return;
    setSlides({ ...slides, kind: 'generating', message: undefined });
    try {
      const res = await fetch(
        `/api/marketing/posts/${draftId}/generate-slides`,
        { method: 'POST' },
      );
      const data = (await res.json()) as {
        success?: boolean;
        visualUrls?: (string | null)[];
        slidesGenerated?: number;
        slidesRequested?: number;
        estimatedCostUsd?: number;
        error?: string;
        hint?: string;
        failures?: { slideIndex: number; reason: string }[];
      };
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

  // PR #76 — Sprint 7.3: HeyGen status badge. The server attaches
  // heygenJobId + heygenStatus to structuredContent for video-needing
  // types (reel, ugc). We surface it as a non-blocking badge so the
  // founder knows the script is ready but the rendered video is
  // pending. typeof guards because structuredContent is jsonb and
  // could legally be anything Opus returned.
  const heygenStatus =
    payload && typeof payload.heygenStatus === 'string'
      ? payload.heygenStatus
      : null;
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
                className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 border border-purple-500/30"
                title="The script is ready. Video rendering ships when the integration goes live."
              >
                🎬 video queued
              </span>
            )}
            {heygenStatus === 'processing' && (
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">
                🎬 video rendering
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
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-danger/15 text-danger border border-danger/30">
                🎬 video failed
              </span>
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

      {/* PR #65 — Sprint 7.0.8: Carousel slide image generation
          surface. Only renders for contentType='carousel' drafts;
          everything else skips this block. */}
      {contentType === 'carousel' && payload != null && (
        <CarouselSlideImagesBlock
          slideCount={countSlides(payload)}
          state={slides}
          onGenerate={handleGenerateSlides}
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
            onGenerate={handleGenerateSingleImage}
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
  return (
    <div className="mb-4 p-3 border border-border rounded-lg bg-bg-elev/40">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          Slide images
          {hasUrls && (
            <span className="ml-2 text-emerald-500">
              ✓ {state.urls.length}/{slideCount} ready
            </span>
          )}
        </div>
        {state.kind !== 'ready' || state.urls.length < slideCount ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || state.kind === 'generating'}
            className="text-xs font-mono px-2 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
            // PR #80 — Sprint 7.5.2 (Bug #4): tooltip keeps the
            // PR Sprint 7.19 — title tooltip used to surface
            // model name + price; consumer-facing copy no
            // longer shows internal tool names or per-image
            // cost. Backend tracking (visual_generations.
            // generationCostUsd) is unchanged.
            title={`Generates ${slideCount} AI images`}
          >
            {state.kind === 'generating'
              ? `Generating ${slideCount} slides…`
              : hasUrls
                ? '↻ Regenerate'
                : `🎨 Generate ${slideCount} slides`}
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
  return (
    <div className="mb-4 p-3 border border-border rounded-lg bg-bg-elev/40">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          Image
          {ready && <span className="ml-2 text-emerald-500">✓ ready</span>}
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || state.kind === 'generating'}
          className="text-xs font-mono px-2 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
          title="Generate AI image"
        >
          {state.kind === 'generating'
            ? 'Generating…'
            : ready
              ? '↻ Regenerate'
              : '🎨 Generate image'}
        </button>
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
