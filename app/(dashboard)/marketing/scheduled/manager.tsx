'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { formatScheduledDate } from '@/lib/utils';

interface Post {
  id: string;
  platform: string;
  content: string;
  scheduledFor: string;
  status: string;
  consistencyScore: number | null;
}

const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'threads'];

export function ScheduledManager({ posts }: { posts: Post[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [bulkRescheduleOpen, setBulkRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (platformFilter !== 'all' && p.platform !== platformFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q && !p.content.toLowerCase().includes(q)) return false;
      if (scoreFilter !== 'all') {
        if (p.consistencyScore == null) return false;
        if (scoreFilter === 'high' && p.consistencyScore < 85) return false;
        if (scoreFilter === 'medium' && (p.consistencyScore < 70 || p.consistencyScore >= 85)) return false;
        if (scoreFilter === 'low' && p.consistencyScore >= 70) return false;
      }
      return true;
    });
  }, [posts, search, platformFilter, statusFilter, scoreFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set();
      return new Set(filtered.map((p) => p.id));
    });
  };

  const bulkCancel = async () => {
    if (
      !confirm(
        `Cancel ${selected.size} scheduled post${selected.size === 1 ? '' : 's'}? This cannot be undone.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/marketing/schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Some posts could not be cancelled');
      } else {
        location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const bulkReschedule = async () => {
    if (!newDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/marketing/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          scheduledFor: new Date(newDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not reschedule');
      } else {
        location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <GlassCard className="p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search content..."
            className="flex-1 min-w-[200px] bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm [color-scheme:dark]"
          >
            <option value="all">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm [color-scheme:dark]"
          >
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="notified">Sent reminder</option>
            <option value="posted">Posted</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={scoreFilter}
            onChange={(e) => setScoreFilter(e.target.value)}
            className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm [color-scheme:dark]"
          >
            <option value="all">All scores</option>
            <option value="high">High (85+)</option>
            <option value="medium">Medium (70-84)</option>
            <option value="low">Low (&lt;70)</option>
          </select>
          <span className="text-xs text-text-3">
            {filtered.length} of {posts.length}
          </span>
        </div>
      </GlassCard>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-4">
          <GlassCard elevated className="p-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-accent font-medium">
              {selected.size} selected
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBulkRescheduleOpen(true)}
              disabled={busy}
            >
              Reschedule
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={bulkCancel}
              disabled={busy}
              className="border-danger/40 text-danger hover:border-danger hover:text-danger"
            >
              {busy ? 'Cancelling…' : `Cancel ${selected.size}`}
            </Button>
          </GlassCard>
        </div>
      )}

      {error && (
        <div className="mb-4 text-xs text-danger">{error}</div>
      )}

      {bulkRescheduleOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <GlassCard elevated className="max-w-md w-full p-5">
            <h3 className="font-display text-xl font-light mb-3">
              Reschedule {selected.size} post{selected.size === 1 ? '' : 's'}
            </h3>
            <input
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm [color-scheme:dark] mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBulkRescheduleOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={bulkReschedule}
                disabled={!newDate || busy}
              >
                {busy ? 'Updating…' : 'Reschedule all'}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <GlassCard className="p-8 text-center text-text-2">
            {posts.length === 0
              ? 'No scheduled posts yet. Compose one in /marketing.'
              : 'No posts match the current filters.'}
          </GlassCard>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-3">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleSelectAll}
                className="cursor-pointer"
              />
              <span>Select all visible</span>
            </div>

            {filtered.map((p) => (
              <GlassCard
                key={p.id}
                className={`p-4 ${selected.has(p.id) ? 'ring-1 ring-accent' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="mt-1 cursor-pointer"
                    aria-label={`Select ${p.platform} post`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-accent">
                        {p.platform}
                      </span>
                      <span className="text-[10px] font-mono text-text-3">
                        · {formatScheduledDate(p.scheduledFor)}
                      </span>
                      {p.status === 'cancelled' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-1 text-text-3">
                          cancelled
                        </span>
                      )}
                      {p.status === 'notified' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-success-soft text-success">
                          sent
                        </span>
                      )}
                      {p.status === 'posted' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-success-soft text-success">
                          posted
                        </span>
                      )}
                      {p.consistencyScore != null && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                            p.consistencyScore >= 85
                              ? 'bg-success-soft text-success'
                              : p.consistencyScore >= 70
                                ? 'bg-surface-1 text-text-2'
                                : 'bg-amber-500/10 text-amber-500'
                          }`}
                          title="Brand consistency score"
                        >
                          {p.consistencyScore}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-1 line-clamp-2 whitespace-pre-wrap">
                      {p.content}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
