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
}

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
}: Props) {
  const [copied, setCopied] = useState(false);
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
            {heygenStatus === 'queued' && (
              <span
                className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 border border-purple-500/30"
                title="The script is ready. Rendered video ships when HeyGen integration goes live."
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
  const estCost = (slideCount * 0.05).toFixed(2);
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
            title={`Flux Pro v1.1, 1:1, ~${slideCount} × $0.05 ≈ $${estCost}`}
          >
            {state.kind === 'generating'
              ? `Generating ${slideCount} slides…`
              : hasUrls
                ? '↻ Regenerate'
                : `🎨 Generate ${slideCount} slides ($${estCost})`}
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
    case 'reel':
      return <ReelView payload={payload} />;
    case 'carousel':
      return <CarouselView payload={payload} />;
    case 'photo':
    case 'single_image':
      return <PhotoView payload={payload} />;
    case 'ugc':
      return <UgcView payload={payload} />;
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

function ReelView({ payload }: { payload: Record<string, unknown> }) {
  const hook = asString(payload.hook);
  const beats = asObjectArray(payload.beats);
  const onScreen = asStringArray(payload.onScreenText);
  const audio = asString(payload.audioSuggestion);
  const caption = asString(payload.caption);
  return (
    <div className="space-y-4">
      <div>
        <Label>Hook (first 3s)</Label>
        <p className="text-sm italic text-text-1">{hook}</p>
      </div>
      {beats.length > 0 && (
        <div>
          <Label>Beats</Label>
          <ol className="space-y-2">
            {beats.map((b, i) => (
              <li key={i} className="text-sm text-text-1">
                <span className="font-mono text-text-3 mr-2">
                  {asString(b.duration) || `${i + 1}.`}
                </span>
                {asString(b.visual)}
                {asString(b.audio) && (
                  <div className="text-xs text-text-3 ml-7">🎵 {asString(b.audio)}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {onScreen.length > 0 && (
        <div>
          <Label>On-screen text</Label>
          <div className="flex flex-wrap gap-2">
            {onScreen.map((t, i) => (
              <span key={i} className="px-2 py-1 bg-bg-elev rounded text-xs">
                &ldquo;{t}&rdquo;
              </span>
            ))}
          </div>
        </div>
      )}
      {audio && (
        <div>
          <Label>Audio</Label>
          <p className="text-sm text-text-1">{audio}</p>
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

function UgcView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Opening</Label>
        <p className="text-sm italic text-text-1">{asString(payload.opening)}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{asString(payload.body)}</p>
      </div>
      <div>
        <Label>Closing</Label>
        <p className="text-sm text-text-1">{asString(payload.closing)}</p>
      </div>
      {asString(payload.recommendedDuration) && (
        <div className="text-[11px] font-mono text-text-3">
          Duration: {asString(payload.recommendedDuration)}
        </div>
      )}
    </div>
  );
}

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
