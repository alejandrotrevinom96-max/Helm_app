'use client';

// PR #24 — Sprint 2.3.
// Single-control filter bar for the Calendar. Just a platform select
// for now — the date range is implicit from the navigation, so there's
// no Library-style "search + filter" combo here. Mirrors the platform
// list used by the Generate composer.
const PLATFORMS = [
  'instagram',
  'facebook',
  'linkedin',
  'threads',
  'reddit',
] as const;

interface Props {
  filters: { platform: string };
  onChange: (next: { platform: string }) => void;
}

export function CalendarFilters({ filters, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <select
        value={filters.platform}
        onChange={(e) => onChange({ platform: e.target.value })}
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
