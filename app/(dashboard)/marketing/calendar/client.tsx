'use client';

// PR #24 — Sprint 2.3: Calendar funcional.
//
// Top-level orchestrator for /marketing/calendar:
//   - week / month toggle
//   - prev / next navigation
//   - platform filter
//   - calendar grid (CalendarView)
//   - drag-drop -> opens golden-times modal -> PATCHes scheduledFor
//
// The grid itself lives in calendar-view.tsx because the layout for
// week vs. month diverges (week = 7 tall columns, month = 6×7 grid
// with greyed-out adjacent month days).
import { useEffect, useState, useCallback } from 'react';
import type { CalendarPost } from '@/app/api/marketing/calendar/route';
import { CalendarView } from './calendar-view';
import { CalendarFilters } from './calendar-filters';
import { GoldenTimesModal } from './golden-times-modal';

type ViewMode = 'week' | 'month';

// Compute the visible date range based on the anchor date + view.
// Week view = Sunday-anchored 7 days. Month view = full month bounds
// (we extend client-side to include leading / trailing adjacent month
// days for the 6×7 grid, but the API only needs the month bounds —
// adjacent days are usually empty anyway).
function getDateRange(date: Date, mode: ViewMode): { start: Date; end: Date } {
  if (mode === 'week') {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  return { start, end };
}

function navigate(date: Date, mode: ViewMode, dir: -1 | 1): Date {
  const next = new Date(date);
  if (mode === 'week') {
    next.setDate(date.getDate() + dir * 7);
  } else {
    next.setMonth(date.getMonth() + dir);
  }
  return next;
}

function formatPeriod(date: Date, mode: ViewMode): string {
  if (mode === 'week') {
    const { start, end } = getDateRange(date, 'week');
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = end.toLocaleDateString(undefined, {
      month: sameMonth ? undefined : 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startLabel} – ${endLabel}`;
  }
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function CalendarClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [posts, setPosts] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ platform: '' });
  const [pendingDrop, setPendingDrop] = useState<{
    post: CalendarPost;
    date: Date;
  } | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getDateRange(currentDate, viewMode);
      const params = new URLSearchParams({
        projectId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      if (filters.platform) params.set('platform', filters.platform);
      const res = await fetch(`/api/marketing/calendar?${params}`);
      const data: { posts?: CalendarPost[]; error?: string } =
        await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load calendar');
        setPosts([]);
        return;
      }
      setPosts(data.posts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, currentDate, viewMode, filters.platform]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Called by CalendarView when the user drops a post on a day. We
  // don't reschedule directly — the user picks a time first via the
  // GoldenTimesModal. This avoids accidentally rescheduling to 00:00
  // when the drop happens.
  const handleDrop = (post: CalendarPost, date: Date) => {
    setPendingDrop({ post, date });
  };

  // Called by the modal when the user picks a time. We compose the
  // final timestamp client-side (drop date + chosen time of day) and
  // PATCH the scheduled_post. Optimistic update keeps the UI snappy;
  // we revert on error.
  const handleConfirmTime = async (time: string) => {
    if (!pendingDrop) return;
    const { post, date } = pendingDrop;
    const [hours, minutes] = time.split(':').map(Number);
    const newDateTime = new Date(date);
    newDateTime.setHours(hours, minutes ?? 0, 0, 0);

    const previousIso = post.scheduledFor;
    // Optimistic: move the post in local state immediately.
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, scheduledFor: newDateTime.toISOString() }
          : p
      )
    );
    setPendingDrop(null);

    try {
      const res = await fetch(`/api/marketing/library/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: newDateTime.toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Revert.
        setPosts((prev) =>
          prev.map((p) =>
            p.id === post.id ? { ...p, scheduledFor: previousIso } : p
          )
        );
        setError(data?.error ?? 'Reschedule failed');
      }
    } catch (e) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, scheduledFor: previousIso } : p
        )
      );
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-text-2">
          Drag posts to reschedule for{' '}
          <span className="text-text-1 font-medium">{projectName}</span>.
          Drop on a day to pick a golden time.
        </p>

        <div className="flex items-center gap-1 bg-bg-elev p-1 rounded-lg border border-border self-start">
          {(['week', 'month'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] rounded-md transition-colors capitalize ${
                viewMode === mode
                  ? 'bg-accent text-white'
                  : 'text-text-3 hover:text-text-1'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCurrentDate(navigate(currentDate, viewMode, -1))}
          className="px-3 py-2 text-sm text-text-2 hover:text-text-1 hover:bg-bg-elev rounded-lg transition-colors"
        >
          ← Previous
        </button>

        <h3 className="font-display text-xl text-center">
          {formatPeriod(currentDate, viewMode)}
        </h3>

        <button
          type="button"
          onClick={() => setCurrentDate(navigate(currentDate, viewMode, 1))}
          className="px-3 py-2 text-sm text-text-2 hover:text-text-1 hover:bg-bg-elev rounded-lg transition-colors"
        >
          Next →
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <CalendarFilters filters={filters} onChange={setFilters} />
        <button
          type="button"
          onClick={() => setCurrentDate(new Date())}
          className="text-xs text-text-3 hover:text-accent underline"
        >
          Jump to today
        </button>
      </div>

      {error && (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-3 text-sm">
          Loading calendar…
        </div>
      ) : (
        <CalendarView
          posts={posts}
          currentDate={currentDate}
          viewMode={viewMode}
          onDrop={handleDrop}
        />
      )}

      {pendingDrop && (
        <GoldenTimesModal
          date={pendingDrop.date}
          onConfirm={handleConfirmTime}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}
