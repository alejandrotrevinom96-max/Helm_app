'use client';

// PR #23 — Sprint 2.2.
// Single card in the Library grid. The whole card is a click target
// that opens the detail modal — we don't put inline edit affordances
// here on purpose because the cards become noisy fast and the modal
// already handles every action.
import type { LibraryPost } from '@/app/api/marketing/library/route';
import { ShareButton } from '@/components/share/share-button';

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
          {/* PR #64 — Sprint 7.0.7: surface per-format chip from the
              structured-drafts flow (Sprint 7.0.4). Skips formats
              already badged separately (reel/story have their own
              icons above) to avoid double-labelling. Always rendered
              when contentType is set — works for both drafts AND
              scheduled rows since Sprint 7.0.6 propagated the
              column. */}
          {post.contentType &&
            post.contentType !== 'reel' &&
            !post.isStory && (
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-accent/15 text-accent"
                title={`Content format: ${post.contentType}`}
              >
                {post.contentType.replace(/_/g, ' ')}
              </span>
            )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          {post.platform}
        </span>
      </div>

      {post.visualUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.visualUrl}
          alt=""
          className="w-full aspect-video object-cover rounded-lg mb-3 bg-bg-elev"
        />
      )}

      <p className="text-sm text-text-1 line-clamp-3 mb-3 whitespace-pre-wrap">
        {post.content}
      </p>

      {/* PR #55 — Sprint 6.9: surface consistencyScore when set.
          Field was carried in LibraryPost from PR #29 but never
          rendered on cards. Color-coded so the founder can scan
          the grid for off-brand drafts (red) at a glance. */}
      {typeof post.consistencyScore === 'number' && (
        <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.1em] inline-flex items-center gap-1.5 text-text-3">
          <span>Brand fit</span>
          <span
            className={
              post.consistencyScore >= 80
                ? 'text-emerald-500 font-medium'
                : post.consistencyScore >= 50
                  ? 'text-amber-500 font-medium'
                  : 'text-danger font-medium'
            }
          >
            {post.consistencyScore}/100
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
