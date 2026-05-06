'use client';

// PR #23 — Sprint 2.2.
// Single card in the Library grid. The whole card is a click target
// that opens the detail modal — we don't put inline edit affordances
// here on purpose because the cards become noisy fast and the modal
// already handles every action.
import type { LibraryPost } from '@/app/api/marketing/library/route';

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
      <div className="flex items-center justify-between mb-3">
        <span
          className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${status.bg}`}
        >
          {status.label}
        </span>
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

      <div className="flex items-center justify-between text-xs text-text-3">
        <span>{dateLabel}</span>
        {post.performanceRating && RATING_EMOJI[post.performanceRating] && (
          <span aria-label={post.performanceRating} title={post.performanceRating}>
            {RATING_EMOJI[post.performanceRating]}
          </span>
        )}
      </div>
    </button>
  );
}
