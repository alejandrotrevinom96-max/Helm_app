'use client';

// PR #24 — Sprint 2.3 (Calendar funcional).
// PR #25 — Sprint 2.4 adds the Drafts pool drawer to the right rail
// and unifies the drag state so chips from EITHER source (the
// in-calendar grid or the drafts pool) participate in the same drop.
//
// Top-level orchestrator for /marketing/calendar:
//   - week / month toggle
//   - prev / next navigation
//   - platform filter
//   - calendar grid (CalendarView) on the left
//   - drafts pool drawer (DraftsPool) on the right
//   - drag-drop -> opens golden-times modal -> moves the post
//
// Drop branches by source:
//   - source='scheduled' → PATCH /api/marketing/library/[id] (reschedule)
//   - source='generated' → POST /api/marketing/library/[id]/schedule
//                          (insert into scheduled_posts + delete draft)
import { useEffect, useState, useCallback } from 'react';
import type { CalendarPost } from '@/app/api/marketing/calendar/route';
import { CalendarView, type DraggedItem } from './calendar-view';
import { CalendarFilters } from './calendar-filters';
import { GoldenTimesModal } from './golden-times-modal';
import { DraftsPool } from './drafts-pool';
import { CalendarPostModal } from './calendar-post-modal';

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
    item: DraggedItem;
    date: Date;
  } | null>(null);

  // PR #25: lifted drag state. Both CalendarView's chips and the
  // DraftsPool's chips push into this; CalendarView's drop handler
  // reads from here. Without lifting, a draft from the pool couldn't
  // be picked up by the calendar's drop target because each component
  // owned its own draggedPost.
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // PR #43 — Sprint 6.7.1: detail modal state. Set when a chip is
  // clicked; cleared on close. We hold the full CalendarPost
  // (rather than just an id) because the calendar already has
  // every field the modal needs in `posts` — no extra fetch.
  const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(
    null
  );

  // Drafts pool drawer state. Open by default — the user pidió el pool
  // visible explícitamente. The collapsed state is a 48px-wide vertical
  // strip with the count, so even when collapsed the drawer announces
  // itself.
  const [draftsPoolOpen, setDraftsPoolOpen] = useState(true);
  // Bumped after a successful schedule so DraftsPool refetches and the
  // just-scheduled draft disappears from the list.
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);

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
      const res = await fetch(`/api/marketing/calendar?${params}`, {
        // PR #46 — Sprint 6.7.4: bypass any browser HTTP cache
        // so a fresh navigation after a schedule mutation pulls
        // the new posts immediately.
        cache: 'no-store',
      });
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

  const handleDragStart = (item: DraggedItem) => {
    setDraggedItem(item);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverKey(null);
  };

  // Called by CalendarView when the user drops a post on a day. We
  // don't reschedule directly — the user picks a time first via the
  // GoldenTimesModal. This avoids accidentally rescheduling to 00:00
  // when the drop happens.
  const handleDrop = (item: DraggedItem, date: Date) => {
    setPendingDrop({ item, date });
    // Don't clear draggedItem yet — the modal close path handles that.
    setDragOverKey(null);
  };

  // Called by the modal when the user picks a time. We compose the
  // final timestamp client-side (drop date + chosen time of day) and
  // dispatch to the right endpoint based on the dragged item's source.
  const handleConfirmTime = async (time: string) => {
    if (!pendingDrop) return;
    const { item, date } = pendingDrop;
    const [hours, minutes] = time.split(':').map(Number);
    const newDateTime = new Date(date);
    newDateTime.setHours(hours, minutes ?? 0, 0, 0);

    setPendingDrop(null);
    setDraggedItem(null);

    if (item.source === 'scheduled') {
      // ===== Reschedule existing scheduled post =====
      const previousIso = item.scheduledFor;
      // Optimistic: move the post in local state immediately.
      setPosts((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? { ...p, scheduledFor: newDateTime.toISOString() }
            : p
        )
      );

      try {
        const res = await fetch(`/api/marketing/library/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledFor: newDateTime.toISOString() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // Revert.
          setPosts((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, scheduledFor: previousIso ?? p.scheduledFor }
                : p
            )
          );
          setError(data?.error ?? 'Reschedule failed');
        }
      } catch (e) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, scheduledFor: previousIso ?? p.scheduledFor }
              : p
          )
        );
        setError(e instanceof Error ? e.message : 'Network error');
      }
      return;
    }

    // ===== Schedule a draft (move generated_posts → scheduled_posts) =====
    try {
      const res = await fetch(
        `/api/marketing/library/${item.id}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledFor: newDateTime.toISOString() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Schedule failed');
        return;
      }
      // Refresh the calendar so the newly-scheduled post shows in its day.
      // We could splice locally but the server is the source of truth
      // for the new id, scheduledFor canonical form, etc — refetch is
      // simpler and the response is small.
      fetchPosts();
      // Bump the drafts pool so the row disappears from there.
      setDraftsRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const cancelPendingDrop = () => {
    setPendingDrop(null);
    setDraggedItem(null);
  };

  return (
    <div className="space-y-6">
      {/* PR #38 — Sprint 6.4: V3 disclaimer banner. Pre-PR-38 the
          calendar implied posts auto-publish at scheduledFor; in
          reality auto-publish is gated by Meta App Review which is
          blocked. Until V3 ships, the calendar is a planning tool
          and the Share button on each post does the actual
          shipping. We surface that contract here so testers don't
          schedule a post and then wonder why nothing got posted. */}
      <div className="p-4 bg-accent/10 border border-accent/30 rounded-lg">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0" aria-hidden>
            🚀
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium mb-1">
              Auto-post to Meta is coming in V3
            </div>
            <div className="text-xs text-text-2 leading-relaxed">
              For now, schedule posts here as your editorial calendar — open
              any post and tap <span className="font-medium">Share</span> to
              publish to Instagram, Facebook, X, or anywhere in 1 tap.
            </div>
          </div>
        </div>
      </div>

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

      {/* Layout split: calendar grid on the left, drafts pool drawer on
          the right. On mobile we stack — the drawer floats below the
          calendar. The lg:items-stretch keeps the drawer's height
          aligned with the calendar grid. */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-stretch">
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setCurrentDate(navigate(currentDate, viewMode, -1))
              }
              className="px-3 py-2 text-sm text-text-2 hover:text-text-1 hover:bg-bg-elev rounded-lg transition-colors"
            >
              ← Previous
            </button>

            <h3 className="font-display text-xl text-center">
              {formatPeriod(currentDate, viewMode)}
            </h3>

            <button
              type="button"
              onClick={() =>
                setCurrentDate(navigate(currentDate, viewMode, 1))
              }
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
              draggedItem={draggedItem}
              dragOverKey={dragOverKey}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverDay={setDragOverKey}
              onDrop={handleDrop}
              onPostClick={setSelectedPost}
            />
          )}
        </div>

        <DraftsPool
          projectId={projectId}
          isOpen={draftsPoolOpen}
          onToggle={() => setDraftsPoolOpen((v) => !v)}
          onDragStart={(draft) =>
            handleDragStart({
              id: draft.id,
              source: 'generated',
              platform: draft.platform,
              content: draft.content,
              scheduledFor: null,
            })
          }
          onDragEnd={handleDragEnd}
          refreshKey={draftsRefreshKey}
        />
      </div>

      {pendingDrop && (
        <GoldenTimesModal
          date={pendingDrop.date}
          onConfirm={handleConfirmTime}
          onCancel={cancelPendingDrop}
        />
      )}

      {/* PR #43 — Sprint 6.7.1: detail modal. Mounted at root so
          its overlay covers the whole calendar. Closes on click-
          outside / X / Escape (handled inside the component). */}
      <CalendarPostModal
        post={selectedPost}
        onClose={() => setSelectedPost(null)}
      />
    </div>
  );
}
