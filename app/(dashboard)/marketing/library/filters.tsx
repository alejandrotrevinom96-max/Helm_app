'use client';

// PR #23 — Sprint 2.2.
// Search-by-text + platform select. PR #30 — Sprint 5.2 added a
// type select (post / story / both) so the user can subset the grid
// by post type independently of the active status tab.
const PLATFORMS = [
  'instagram',
  'facebook',
  'linkedin',
  'threads',
  'reddit',
] as const;

interface Props {
  filters: {
    platform: string;
    search: string;
    type: '' | 'post' | 'story' | 'reel';
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
          <option key={p} value={p} className="capitalize">
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}
