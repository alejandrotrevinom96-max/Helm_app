'use client';

// PR #23 — Sprint 2.2.
// Search-by-text + platform select. PR #30 — Sprint 5.2 added a
// type select (post / story / both) so the user can subset the grid
// by post type independently of the active status tab.
// PR #62 — Sprint 7.0.5 added a contentType select for the
// structured-draft formats (Reel, Carousel, Thread, etc.). It's a
// client-side filter so it composes with the existing API-side
// status/platform/type filters.
// PR Sprint D-8 Phase 3 — added the modern visual networks (tiktok,
// instagram_reels, facebook_reels, x) to the dropdown. Pre-D-8 the
// filter only listed the OG 5 even though the rest of the app
// already publishes to them. Filtering by tiktok highlighted the
// drift; fixing it now keeps the dropdown in sync with what
// AssetGroupCard actually renders.
const PLATFORMS = [
  'instagram',
  'instagram_reels',
  'facebook',
  'facebook_reels',
  'linkedin',
  'threads',
  'reddit',
  'x',
  'tiktok',
] as const;

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  instagram_reels: 'Instagram Reels',
  facebook: 'Facebook',
  facebook_reels: 'Facebook Reels',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  reddit: 'Reddit',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
};

// Mirrors the seeded `content_types.type` values from
// scripts/seed-content-types.ts. Plus 'legacy' which targets the
// pre-Sprint-7.0.4 plain-text drafts (contentType=null).
const CONTENT_TYPE_OPTIONS = [
  { value: '', label: 'All formats' },
  { value: 'legacy', label: 'Legacy (no format)' },
  { value: 'reel', label: 'Reels' },
  { value: 'carousel', label: 'Carousels' },
  { value: 'photo', label: 'Single photo' },
  { value: 'ugc', label: 'UGC script' },
  { value: 'community_post', label: 'Community post' },
  { value: 'text_post', label: 'Text post' },
  { value: 'self_post', label: 'Reddit self-post' },
  { value: 'link_post', label: 'Reddit link post' },
  { value: 'single_image', label: 'Single image' },
  { value: 'single_tweet', label: 'Tweet' },
  { value: 'thread', label: 'Thread' },
] as const;

interface Props {
  filters: {
    platform: string;
    search: string;
    type: '' | 'post' | 'story' | 'reel';
    contentType: string;
  };
  onChange: (next: Props['filters']) => void;
}

export function LibraryFilters({ filters, onChange }: Props) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
      <input
        type="text"
        placeholder="Search post content…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="flex-1 px-3 py-2 bg-bg-elev border border-border rounded-lg text-sm outline-none focus:border-accent"
      />

      <select
        value={filters.type}
        onChange={(e) =>
          onChange({
            ...filters,
            type: e.target.value as '' | 'post' | 'story' | 'reel',
          })
        }
        className="px-3 py-2 bg-bg-elev border border-border rounded-lg text-sm outline-none focus:border-accent"
      >
        <option value="">All types</option>
        <option value="post">Regular posts</option>
        <option value="story">📸 Stories</option>
        <option value="reel">🎬 Reels</option>
      </select>

      <select
        value={filters.platform}
        onChange={(e) =>
          onChange({ ...filters, platform: e.target.value })
        }
        className="px-3 py-2 bg-bg-elev border border-border rounded-lg text-sm outline-none focus:border-accent capitalize"
      >
        <option value="">All platforms</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABEL[p] ?? p}
          </option>
        ))}
      </select>

      {/* PR #62 — Sprint 7.0.5: per-format filter (client-side). */}
      <select
        value={filters.contentType}
        onChange={(e) =>
          onChange({ ...filters, contentType: e.target.value })
        }
        className="px-3 py-2 bg-bg-elev border border-border rounded-lg text-sm outline-none focus:border-accent"
      >
        {CONTENT_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
