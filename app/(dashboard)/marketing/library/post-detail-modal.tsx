'use client';

// PR #23 — Sprint 2.2.
//
// Detail modal for a single Library post. Shows:
//   - the full content + visual
//   - status / platform / dates
//   - feedback section (rating + notes + 4 manual metrics) — only for
//     scheduled_posts rows that have status='published' (drafts and
//     pending-scheduled posts have nothing to rate yet)
//   - "Clone & remix" action (always available)
//
// The feedback Save button issues PATCH /api/marketing/library/[id].
// Clone issues POST /api/marketing/library/[id]/clone and redirects.
import { useState } from 'react';
import type { LibraryPost } from '@/app/api/marketing/library/route';

interface Props {
  post: LibraryPost;
  onClose: () => void;
  onUpdate: (updated: LibraryPost) => void;
  onClone: () => void;
}

const RATING_OPTIONS = [
  { value: 'worked', emoji: '👍', label: 'Worked' },
  { value: 'flopped', emoji: '👎', label: 'Flopped' },
  { value: 'not_sure', emoji: '❓', label: 'Not sure' },
] as const;

const METRIC_FIELDS = [
  { key: 'metricsImpressions', label: 'Impressions' },
  { key: 'metricsLikes', label: 'Likes' },
  { key: 'metricsComments', label: 'Comments' },
  { key: 'metricsShares', label: 'Shares' },
] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function PostDetailModal({ post, onClose, onUpdate, onClone }: Props) {
  const [rating, setRating] = useState<string | null>(post.performanceRating);
  const [notes, setNotes] = useState(post.performanceNote ?? '');
  const [metrics, setMetrics] = useState<Record<string, string>>({
    metricsImpressions: post.metricsImpressions?.toString() ?? '',
    metricsLikes: post.metricsLikes?.toString() ?? '',
    metricsComments: post.metricsComments?.toString() ?? '',
    metricsShares: post.metricsShares?.toString() ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showFeedback =
    post.source === 'scheduled' && post.status === 'published';

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        performanceRating: rating,
        performanceNote: notes,
      };
      for (const { key } of METRIC_FIELDS) {
        const v = metrics[key];
        body[key] = v === '' ? null : Number(v);
      }
      const res = await fetch(`/api/marketing/library/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Save failed');
        return;
      }
      // Server returned the raw scheduled_posts row; map it back into
      // LibraryPost shape so the parent stays consistent.
      const updated: LibraryPost = {
        ...post,
        performanceRating: data.post?.performanceRating ?? null,
        performanceNote: data.post?.performanceNote ?? null,
        metricsImpressions: data.post?.metricsImpressions ?? null,
        metricsLikes: data.post?.metricsLikes ?? null,
        metricsComments: data.post?.metricsComments ?? null,
        metricsShares: data.post?.metricsShares ?? null,
      };
      onUpdate(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/clone`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTable: post.source }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Clone failed');
        setCloning(false);
        return;
      }
      onClone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setCloning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
              {post.platform} · {post.status}
            </div>
            <h3 className="font-display text-2xl font-light">Post detail</h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="mb-4 p-4 bg-bg border border-border rounded-lg">
          <p className="text-sm text-text-1 whitespace-pre-wrap">
            {post.content}
          </p>
        </div>

        {/* Visual */}
        {post.visualUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.visualUrl}
            alt=""
            className="w-full rounded-lg mb-4 bg-bg"
          />
        )}

        {/* Metadata */}
        <div className="mb-6 grid grid-cols-2 gap-3 text-xs">
          {post.scheduledFor && (
            <div>
              <span className="text-text-3 block">Scheduled for</span>
              <span className="text-text-1">
                {formatDateTime(post.scheduledFor)}
              </span>
            </div>
          )}
          {post.publishedAt && (
            <div>
              <span className="text-text-3 block">Published</span>
              <span className="text-text-1">
                {formatDateTime(post.publishedAt)}
              </span>
            </div>
          )}
          <div>
            <span className="text-text-3 block">Created</span>
            <span className="text-text-1">
              {formatDateTime(post.createdAt)}
            </span>
          </div>
          {post.consistencyScore !== null && (
            <div>
              <span className="text-text-3 block">Consistency score</span>
              <span className="text-text-1">{post.consistencyScore}/100</span>
            </div>
          )}
        </div>

        {/* Feedback section — only for published posts */}
        {showFeedback && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              Feedback
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                How did this post perform?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RATING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setRating(rating === opt.value ? null : opt.value)
                    }
                    className={`
                      px-3 py-3 rounded-lg border transition-colors text-center
                      ${
                        rating === opt.value
                          ? 'border-accent bg-accent-soft'
                          : 'border-border hover:border-border-bright'
                      }
                    `}
                  >
                    <div className="text-2xl mb-1">{opt.emoji}</div>
                    <div className="text-xs">{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What worked or didn't?"
                rows={3}
                className="w-full p-3 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent resize-y"
              />
            </div>

            <div>
              <label className="text-xs text-text-2 mb-2 block">
                Manual metrics (optional)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {METRIC_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <input
                      type="number"
                      min={0}
                      value={metrics[key]}
                      onChange={(e) =>
                        setMetrics((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full p-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
                    />
                    <label className="text-[10px] text-text-3 block mt-1">
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 border border-danger/30 bg-danger/10 rounded-lg text-xs text-danger">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-border">
          <button
            type="button"
            onClick={handleClone}
            disabled={cloning}
            className="px-4 py-2 bg-bg border border-border rounded-lg text-sm hover:bg-bg-elev hover:border-border-bright transition-colors disabled:opacity-50"
          >
            {cloning ? 'Cloning…' : '🔄 Clone & remix'}
          </button>

          {showFeedback && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save feedback'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
