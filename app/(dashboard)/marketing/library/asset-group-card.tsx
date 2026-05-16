'use client';

// PR Sprint 7.26 — Asset-based content flow.
//
// Library card that represents ONE asset → N platforms. Renders
// when the LibraryClient grouped multiple posts under the same
// `assetId`. For a single-post group (or a post with no assetId)
// we fall back to LibraryPostCard, which keeps every legacy
// single-platform card intact.
//
// Visual model:
//   ┌───────────────────────────────────────────┐
//   │ DRAFT · UGC VIDEO                         │
//   │ [TikTok] [Instagram] [Facebook]  ← badges │
//   │ [thumbnail]                               │
//   │ "Tired of 7 tabs for one post?..."        │
//   │ (preview of asset.baseContent)            │
//   │ 3 captions adapted · Created yesterday    │
//   └───────────────────────────────────────────┘
//
// Click target: the whole card, opening AssetDetailModal (or
// falling through to PostDetailModal if no per-platform tab UI
// has shipped yet — see post-detail-modal.tsx).

import type { LibraryPost } from '@/app/api/marketing/library/route';
import { ContentTypeBadge } from '@/components/marketing/ContentTypeBadge';

interface Props {
  // Sorted alphabetically by platform for stable badge order.
  posts: LibraryPost[];
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

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'IG',
  instagram_reels: 'IG Reels',
  facebook: 'FB',
  facebook_reels: 'FB Reels',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  threads: 'Threads',
  x: 'X',
  tiktok: 'TikTok',
};

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > 0) {
    if (diffDays === 1) return 'tomorrow';
    if (diffDays < 7) return `in ${diffDays}d`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (diffDays === 0) return 'today';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > -7) return `${Math.abs(diffDays)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function AssetGroupCard({ posts, onClick }: Props) {
  // All posts in the group share the same status (they were all
  // generated together and follow the same lifecycle). We sample
  // from the first row for the chrome.
  const head = posts[0];
  const status = STATUS_STYLES[head.status];
  // The library API hydrates videoUrl + visualUrl from
  // content_assets via LEFT JOIN, so every post in the group has
  // the same value — but `find` is defensive against an edge case
  // where one row was inserted before the asset hydration shipped.
  const visualUrl = posts.find((p) => p.visualUrl)?.visualUrl ?? null;
  const videoUrl = posts.find((p) => p.videoUrl)?.videoUrl ?? null;
  const isVideoAsset =
    head.contentType === 'ugc' ||
    head.contentType === 'reel' ||
    posts.some((p) => p.isReel);
  const dateLabel =
    head.status === 'draft'
      ? `Created ${formatRelativeDate(head.createdAt)}`
      : head.status === 'scheduled'
        ? `Scheduled ${formatRelativeDate(head.scheduledFor)}`
        : head.status === 'published'
          ? `Published ${formatRelativeDate(head.publishedAt ?? head.scheduledFor)}`
          : `Cancelled ${formatRelativeDate(head.createdAt)}`;
  // For the body preview we use the asset's baseContent as a stand-in
  // when present. We don't have direct access here — fall back to the
  // first caption truncated.
  const body =
    (head.structuredContent as { baseContent?: string } | null)?.baseContent ??
    head.content;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full p-4 border border-border rounded-xl bg-bg hover:bg-bg-elev hover:border-border-bright transition-colors group"
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded ${status.bg}`}
          >
            {status.label}
          </span>
          {head.contentType && (
            <ContentTypeBadge contentType={head.contentType} />
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
          {posts.length} platform{posts.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Platform badges row */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {posts.map((p) => (
          <span
            key={p.id}
            className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded bg-bg-elev border border-border text-text-2"
          >
            {PLATFORM_LABEL[p.platform] ?? p.platform}
          </span>
        ))}
      </div>

      {/* Media preview — video for ugc/reel assets, image for
          photo/carousel. PR Sprint 7.26: the asset's videoUrl /
          imageUrls are mirrored across every platform variant via
          the library leftJoin, so we can render the same media
          here regardless of which post the founder clicks. */}
      {videoUrl && isVideoAsset ? (
        <video
          src={videoUrl}
          controls
          playsInline
          muted
          loop
          preload="metadata"
          className="w-full aspect-video object-cover rounded-lg mb-3 bg-bg-elev"
          poster={visualUrl ?? undefined}
          onClick={(e) => e.stopPropagation()}
        />
      ) : visualUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={visualUrl}
          alt=""
          className="w-full aspect-video object-cover rounded-lg mb-3 bg-bg-elev"
        />
      ) : isVideoAsset ? (
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

      {/* PR Sprint 7.27 — Body preview. For UGC/reel groups we
          show the SCRIPT (asset.baseContent) in an amber card so
          the founder sees what the avatar speaks before opening
          the detail modal. For other types it's the asset's
          baseContent / first post's content as before. */}
      {head.contentType === 'ugc' || head.contentType === 'reel' ? (
        <div className="mb-3 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-500 mb-1">
            🎥 Script
          </div>
          <p className="text-xs text-text-1 line-clamp-4 whitespace-pre-wrap leading-relaxed">
            {body}
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-1 line-clamp-3 mb-3 whitespace-pre-wrap">
          {body}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-text-3 gap-2">
        <span className="truncate">{dateLabel}</span>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-accent">
          {posts.length} caption{posts.length === 1 ? '' : 's'} adapted
        </span>
      </div>
    </button>
  );
}
