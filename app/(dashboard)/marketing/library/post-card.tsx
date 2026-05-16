'use client';

// PR #23 — Sprint 2.2.
// Single card in the Library grid. The whole card is a click target
// that opens the detail modal — we don't put inline edit affordances
// here on purpose because the cards become noisy fast and the modal
// already handles every action.
//
// PR Sprint 7.24 — Prompt 4 refresh:
//   - Content-type chip moves to the shared ContentTypeBadge so
//     colors are consistent across Library / Calendar / Modal.
//   - UGC and Reel cards show the type chip (🎥 Script / 🎬 Reel)
//     and use the structured-content's caption (when present) as
//     the body preview instead of the raw script text — the
//     script lives in the modal where it can render as a proper
//     teleprompter (UgcBundleView, fix b2aa201).
//   - Cards with no visualUrl show a tappable "+ Add visual"
//     placeholder. For new drafts post-Prompt-3 the auto-image
//     flow has usually already populated visualUrl by the time
//     the card mounts; the placeholder is the fallback for
//     legacy rows or for content types we don't auto-image
//     (carousel goes through generate-slides separately).
//   - Variant chip "Option A" / "Option B" surfaces when the row
//     came out of the A/B pair flow (Sprint 7.24 — Prompt 3).
import type { LibraryPost } from '@/app/api/marketing/library/route';
import { ShareButton } from '@/components/share/share-button';
import { ContentTypeBadge } from '@/components/marketing/ContentTypeBadge';

interface Props {
  post: LibraryPost;
  onClick: () => void;
}

const STATUS_STYLES: Record<
  LibraryPost['status'],
  { bg: string; label: string }
> = {
  draft: { bg: 'bg-text-3/15 text-text-2', label: 'Draft' },
  scheduled: { bg: 'bg-accent/15 text-accent', label: 'Scheduled' },
  published: { bg: 'bg-emerald-500/15 text-emerald-500', label: 'Published' },
  cancelled: { bg: 'bg-danger/15 text-danger', label: 'Cancelled' },
};

const RATING_EMOJI: Record<string, string> = {
  worked: '👍',
  flopped: '👎',
  not_sure: '❓',
};

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  // Future
  if (diffDays > 0) {
    if (diffDays === 1) return 'tomorrow';
    if (diffDays < 7) return `in ${diffDays}d`;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
  // Past
  if (diffDays === 0) return 'today';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > -7) return `${Math.abs(diffDays)}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function LibraryPostCard({ post, onClick }: Props) {
  const status = STATUS_STYLES[post.status];

  // Choose the most meaningful date for the footer based on lifecycle
  // stage. Draft = createdAt; scheduled = scheduledFor; published =
  // publishedAt (falling back to scheduledFor).
  const dateLabel =
    post.status === 'draft'
      ? `Created ${formatRelativeDate(post.createdAt)}`
      : post.status === 'scheduled'
        ? `Scheduled ${formatRelativeDate(post.scheduledFor)}`
        : post.status === 'published'
          ? `Published ${formatRelativeDate(post.publishedAt ?? post.scheduledFor)}`
          : `Cancelled ${formatRelativeDate(post.createdAt)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full p-4 border border-border rounded-xl bg-bg hover:bg-bg-elev hover:border-border-bright transition-colors group"
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${status.bg}`}
          >
            {status.label}
          </span>
          {/* PR #29 — auto-publishing state badge. Shows alongside the
              status badge so the user sees lifecycle (scheduled →
              published) AND the publish attempt outcome separately. */}
          {post.publishStatus === 'publishing' && (
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
              Publishing…
            </span>
          )}
          {post.publishStatus === 'failed' && (
            <span
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger"
              title={post.publishFailureReason ?? 'Publishing failed'}
            >
              Failed
            </span>
          )}
          {/* PR #30 — Story badge. Pink to match Instagram's brand
              accent. The "Expired" sub-badge fades in once the 24h
              window passes — UI honest about what's still viewable. */}
          {post.isStory && (
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-pink-500/15 text-pink-500">
              📸 Story
            </span>
          )}
          {post.isStory &&
            post.storyExpiresAt &&
            new Date(post.storyExpiresAt) < new Date() && (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-3">
                Expired
              </span>
            )}
          {/* PR #32 — Reel badges. Purple distinguishes from Story's
              pink. Processing tint mirrors the Story flow:
              meta_processing → amber, error → danger, ready → no
              extra badge (the lifecycle status badge above tells
              the published story). */}
          {post.isReel && (
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-purple-500/15 text-purple-500">
              🎬 Reel
            </span>
          )}
          {post.isReel &&
            post.reelProcessingStatus === 'meta_processing' && (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
                Processing…
              </span>
            )}
          {post.isReel &&
            post.reelProcessingStatus === 'error' && (
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-danger/15 text-danger"
                title={post.reelProcessingError ?? 'Reel processing failed'}
              >
                Reel error
              </span>
            )}
          {/* PR Sprint 7.24 — Prompt 4. Shared ContentTypeBadge.
              Skips when isStory (story badge already lives above
              with a pink tint) and when isReel (the reel badge
              above already says 🎬 Reel). Renders for everything
              else including the new UGC '🎥 Script' label. */}
          {post.contentType && !post.isStory && !post.isReel && (
            <ContentTypeBadge contentType={post.contentType} />
          )}
          {/* PR Sprint 7.24 — Prompt 3. Variant chip surfaces
              "Option A" / "Option B" when the row was generated
              as one half of an A/B pair. Soft terracotta to read
              as informational. */}
          {post.variantLabel && (
            <span
              className="text-[10px] font-mono uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30"
              title="Generated at the same time as the other variant — pick your favorite, delete the other."
            >
              Option {post.variantLabel}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          {post.platform}
        </span>
      </div>

      {/* PR Sprint 7.26 — Asset-based content flow. UGC / Reel
          drafts now embed the rendered HeyGen video directly on
          the card (not just a script preview). post.videoUrl is
          hydrated by the library API's LEFT JOIN on
          content_assets, so EVERY platform variant in an asset
          group shows the same render. Falls through to the legacy
          image / placeholder logic for non-video content types. */}
      {post.videoUrl &&
      (post.contentType === 'ugc' ||
        post.contentType === 'reel' ||
        post.isReel) ? (
        <video
          src={post.videoUrl}
          controls
          playsInline
          // muted+loop so a hover preview feels natural without
          // surprising audio. The user can unmute via the native
          // controls when they want sound.
          muted
          loop
          preload="metadata"
          className="w-full aspect-video object-cover rounded-lg mb-3 bg-bg-elev"
          poster={post.visualUrl ?? undefined}
          onClick={(e) => {
            // Native controls swallow clicks anyway, but
            // stopPropagation here keeps the card-level onClick
            // (open modal) from firing when the user pauses/plays.
            e.stopPropagation();
          }}
        />
      ) : post.visualUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.visualUrl}
          alt=""
          className="w-full aspect-video object-cover rounded-lg mb-3 bg-bg-elev"
        />
      ) : post.contentType !== 'ugc' &&
        post.contentType !== 'reel' &&
        post.contentType !== 'self_post' &&
        post.contentType !== 'text_post' &&
        post.contentType !== 'community_post' ? (
        <div className="w-full aspect-video rounded-lg mb-3 bg-bg-elev border border-dashed border-border flex items-center justify-center text-text-3">
          <div className="text-center">
            <div className="text-2xl mb-1 opacity-60" aria-hidden>
              🖼️
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em]">
              + Add visual
            </div>
          </div>
        </div>
      ) : (post.contentType === 'ugc' || post.contentType === 'reel') ? (
        // Video pending — show a "rendering" placeholder so the
        // founder knows the HeyGen render is in flight instead of
        // staring at script-only chrome.
        <div className="w-full aspect-video rounded-lg mb-3 bg-bg-elev border border-dashed border-purple-500/30 flex items-center justify-center text-purple-500">
          <div className="text-center">
            <div className="text-2xl mb-1 opacity-80" aria-hidden>
              🎬
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em]">
              Video rendering…
            </div>
          </div>
        </div>
      ) : null}

      {/* PR Sprint 7.24 — Prompt 4. UGC body preview. Pre-fix the
          card showed the raw script with timecodes and director
          notes — useful for the founder but visually identical to
          a narrative post, defeating the point of distinguishing
          UGC at a glance. Now UGC + Reel cards lead with a
          one-line script-mode label; the detail modal still
          renders the full UgcBundleView teleprompter. */}
      {post.contentType === 'ugc' || post.contentType === 'reel' ? (
        <div className="mb-3">
          <div className="text-xs font-mono uppercase tracking-[0.15em] text-amber-500 mb-1">
            🎥 Recordable script
          </div>
          <p className="text-sm text-text-1 line-clamp-2 whitespace-pre-wrap italic">
            {post.content.slice(0, 140) || 'Script ready — open to view teleprompter.'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-1 line-clamp-3 mb-3 whitespace-pre-wrap">
          {post.content}
        </p>
      )}

      {/* PR #55 — Sprint 6.9: surface consistencyScore when set.
          Sprint 7.13 (BUG 2) — pre-fix this rendered as subtle
          mono text that founders missed when scanning the grid.
          Now a prominent accent pill matching the other badges
          (content type chip, platform chip). Same gate (renders
          for ANY status when score is a number) — the visibility
          fix is purely visual weight, not logic. */}
      {typeof post.consistencyScore === 'number' && (
        <div className="mb-3">
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.15em] font-bold px-2 py-1 rounded inline-flex items-center gap-1.5 ${
              post.consistencyScore >= 80
                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                : post.consistencyScore >= 50
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-danger/15 text-danger border border-danger/30'
            }`}
            title="How well this draft matches your brand bible (voice, pillars, vocabulary). 80+ green, 50-79 on-brand, <50 off-brand."
          >
            <span>Brand fit</span>
            <span>{post.consistencyScore}/100</span>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-3 gap-2">
        <span className="truncate">{dateLabel}</span>
        <div className="flex items-center gap-1 shrink-0">
          {/* PR #29 — when the post made it to Meta we show a permalink
              chip the user can click to view the live post. stopPropagation
              so the card-click (open modal) doesn't fire too. */}
          {post.metaPermalink && (
            <a
              href={post.metaPermalink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors"
            >
              View ↗
            </a>
          )}
          {post.performanceRating && RATING_EMOJI[post.performanceRating] && (
            <span aria-label={post.performanceRating} title={post.performanceRating}>
              {RATING_EMOJI[post.performanceRating]}
            </span>
          )}
          {/* PR #38 — Sprint 6.4: quick-share without opening the
              detail modal. ShareButton's onClick stopPropagation
              keeps the card-click from firing alongside. */}
          <ShareButton
            caption={post.content}
            imageUrl={post.visualUrl}
            variant="icon"
            label="Share"
          />
        </div>
      </div>
    </button>
  );
}
