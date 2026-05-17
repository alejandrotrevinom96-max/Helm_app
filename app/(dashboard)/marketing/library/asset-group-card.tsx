'use client';

// PR Sprint 7.26 — Asset-based content flow.
// PR Sprint D-8 Phase 3 — accordion expansion + per-platform row
// actions. The card header / media / body preview keep the
// original "click to open detail modal" target; the accordion
// toggle + per-row buttons are new interactive surfaces under
// the existing chrome.
//
// Visual model (collapsed — same as Sprint 7.26):
//   ┌──────────────────────────────────────────────────┐
//   │ DRAFT · UGC VIDEO                                │
//   │ [TikTok] [Instagram] [Facebook]                  │
//   │ [thumbnail]                                      │
//   │ "Tired of 7 tabs for one post?..."               │
//   │ 3 captions adapted · Created yesterday           │
//   │ ────────────────────────────────────────────     │
//   │ ▼ Show captions per platform                     │
//   └──────────────────────────────────────────────────┘
//
// Expanded (PR Sprint D-8 Phase 3):
//   │ ▲ Hide captions                                  │
//   │  ┌─ TikTok ─────────────────────── [HIGHLIGHTED]┐│  ← when filter=tiktok
//   │  │ "First-line hook + body…"                    ││
//   │  │ ✏️ Edit  🔄 Regenerate  📅 Schedule           ││
//   │  └──────────────────────────────────────────────┘│
//   │  ┌─ Instagram ────────────────────── [dimmed]   ┐│  ← when filter active + ≠ ig
//   │  │ "Casual caption with emojis…"                ││
//   │  │ ✏️ Edit  🔄 Regenerate  📅 Schedule           ││
//   │  └──────────────────────────────────────────────┘│
//   └──────────────────────────────────────────────────┘
//
// Filter highlight: when activePlatformFilter is set, the matching
// row gets a brighter border + background and the others fade to
// 50% opacity. Lets the founder scan a multi-platform card for
// "what does my TikTok caption look like specifically".

import { useState } from 'react';
import type { LibraryPost } from '@/app/api/marketing/library/route';
import { ContentTypeBadge } from '@/components/marketing/ContentTypeBadge';

interface Props {
  // Sorted alphabetically by platform for stable badge order.
  posts: LibraryPost[];
  // PR Sprint D-8 Phase 3 — pass the LibraryFilters platform
  // value through so the accordion can highlight the matching
  // row. Empty string = no filter active.
  activePlatformFilter: string;
  // Opens the PostDetailModal for the whole asset (the original
  // click target). The per-row Edit button reuses the same handler
  // but pre-selects the specific platform's post via onOpenPost.
  onClick: () => void;
  // PR Sprint D-8 Phase 3 — open the detail modal pre-focused on
  // ONE specific post (the one whose row the founder clicked).
  // Lets per-platform actions land in the right place inside the
  // modal without scrolling / hunting.
  onOpenPost: (post: LibraryPost) => void;
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

export function AssetGroupCard({
  posts,
  activePlatformFilter,
  onClick,
  onOpenPost,
}: Props) {
  // PR Sprint D-8 Phase 3 — accordion auto-opens when a platform
  // filter is active so the founder lands on the matching row
  // without an extra click. They can still collapse manually.
  const [expanded, setExpanded] = useState<boolean>(
    Boolean(activePlatformFilter),
  );

  const head = posts[0];
  const status = STATUS_STYLES[head.status];
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
  const body =
    (head.structuredContent as { baseContent?: string } | null)?.baseContent ??
    head.content;

  return (
    <div className="w-full border border-border rounded-xl bg-bg overflow-hidden hover:border-border-bright transition-colors group">
      {/* Main clickable region — opens the detail modal. PR Sprint
          D-8 Phase 3: split into its own button so we can keep
          accordion controls + per-row actions interactive without
          nesting them inside another <button>. */}
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full p-4 hover:bg-bg-elev transition-colors"
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
          {posts.map((p) => {
            const matchesFilter =
              activePlatformFilter && activePlatformFilter === p.platform;
            const dimmed =
              activePlatformFilter && activePlatformFilter !== p.platform;
            return (
              <span
                key={p.id}
                className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border transition-opacity ${
                  matchesFilter
                    ? 'bg-accent/15 border-accent text-accent'
                    : dimmed
                      ? 'bg-bg-elev border-border text-text-3 opacity-50'
                      : 'bg-bg-elev border-border text-text-2'
                }`}
              >
                {PLATFORM_LABEL[p.platform] ?? p.platform}
              </span>
            );
          })}
        </div>

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

      {/* PR Sprint D-8 Phase 3 — accordion toggle. Separate from
          the main click region so the founder can expand /
          collapse without bouncing into the detail modal. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-t border-border text-[11px] font-mono uppercase tracking-[0.12em] text-text-3 hover:bg-bg-elev hover:text-text-1 transition-colors"
      >
        <span>
          {expanded ? '▲ Hide captions' : '▼ Show captions per platform'}
        </span>
        <span>
          {posts.length} caption{posts.length === 1 ? '' : 's'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border bg-bg-elev/40">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              isHighlighted={
                Boolean(activePlatformFilter) &&
                activePlatformFilter === post.platform
              }
              isDimmed={
                Boolean(activePlatformFilter) &&
                activePlatformFilter !== post.platform
              }
              onOpenDetail={() => onOpenPost(post)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PostRow — one platform inside the accordion ────────────────

interface PostRowProps {
  post: LibraryPost;
  isHighlighted: boolean;
  isDimmed: boolean;
  // Opens the detail modal pre-focused on this post. Used by both
  // ✏️ Edit and 📅 Schedule — the existing modal already handles
  // both flows in-place, so we don't need separate routes for now.
  onOpenDetail: () => void;
}

function PostRow({ post, isHighlighted, isDimmed, onOpenDetail }: PostRowProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [localText, setLocalText] = useState<string | null>(null);

  // PR Sprint D-8 Phase 3 — fall back to post.content because the
  // /api/marketing/library route doesn't currently expose caption /
  // hashtags as separate fields (they live in DB but aren't
  // surfaced). Hashtag count is approximated by counting #-prefixed
  // tokens in the content — good enough for the preview chip.
  const captionText = localText ?? post.content;
  const charCount = captionText.length;
  const hashtagCount = (captionText.match(/(^|\s)#[\w-]+/g) ?? []).length;
  // Only drafts can be regenerated; scheduled / published rows
  // are frozen by the backend. We dim the button visually so the
  // founder knows up-front.
  const canRegenerate = post.status === 'draft' && post.source === 'generated';

  const regenerate = async () => {
    if (!canRegenerate || regenerating) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(
        `/api/marketing/posts/${encodeURIComponent(post.id)}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        post?: { content?: string; caption?: string };
        error?: string;
      };
      if (!res.ok) {
        setRegenError(data.error ?? `Regenerate failed (${res.status})`);
        return;
      }
      const fresh = data.post?.caption ?? data.post?.content ?? null;
      if (fresh) setLocalText(fresh);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div
      className={`px-4 py-3 border-b border-border last:border-b-0 transition-all ${
        isHighlighted
          ? 'bg-accent/10 border-l-2 border-l-accent'
          : isDimmed
            ? 'opacity-50'
            : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-0.5 rounded ${
            isHighlighted
              ? 'bg-accent/20 text-accent'
              : 'bg-bg-elev text-text-2'
          }`}
        >
          {PLATFORM_LABEL[post.platform] ?? post.platform}
        </span>
        <span className="text-[10px] font-mono text-text-3">
          {charCount} chars · {hashtagCount}#
        </span>
      </div>

      <p className="text-xs text-text-1 line-clamp-2 whitespace-pre-wrap mb-2">
        {captionText}
      </p>

      {regenError && (
        <div className="text-[11px] text-danger mb-2">⚠ {regenError}</div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-[11px] px-2 py-1 rounded border border-border bg-bg hover:bg-bg-elev hover:border-border-bright transition-colors"
        >
          ✏️ Edit
        </button>
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={!canRegenerate || regenerating}
          title={
            canRegenerate
              ? 'Generate a fresh caption for this platform only'
              : 'Only drafts can be regenerated'
          }
          className="text-[11px] px-2 py-1 rounded border border-border bg-bg hover:bg-bg-elev hover:border-border-bright transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {regenerating ? '🔄 Regenerating…' : '🔄 Regenerate'}
        </button>
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-[11px] px-2 py-1 rounded border border-border bg-bg hover:bg-bg-elev hover:border-border-bright transition-colors"
        >
          📅 Schedule
        </button>
      </div>
    </div>
  );
}
