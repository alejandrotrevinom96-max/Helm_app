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
  // PR #24 — Sprint 2.3: parent removes the post from its in-memory
  // list when delete or move-to-draft succeeds, so we don't need a
  // full page reload.
  onRemove: (id: string) => void;
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

export function PostDetailModal({
  post,
  onClose,
  onUpdate,
  onClone,
  onRemove,
}: Props) {
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
  const [movingToDraft, setMovingToDraft] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // PR #29 — manual retry for posts whose auto-publish failed. We
  // don't auto-poll the publishStatus because the Library refetches
  // every time the user opens this modal anyway.
  const [retryingPublish, setRetryingPublish] = useState(false);
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

  const handleMoveToDraft = async () => {
    if (
      !confirm(
        'Mover este post de vuelta a Drafts? El horario agendado se borrará.'
      )
    ) {
      return;
    }
    setMovingToDraft(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/move-to-draft`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Move failed');
        setMovingToDraft(false);
        return;
      }
      // The original scheduled row is gone; remove it from the parent
      // list and close. The new draft will appear next time the parent
      // refetches counts (which it does on every removal).
      onRemove(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setMovingToDraft(false);
    }
  };

  const handleRetryPublish = async () => {
    setRetryingPublish(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}/retry-publish`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data?.error ?? 'Retry failed');
        setRetryingPublish(false);
        return;
      }
      // Reflect success locally — parent will pick up canonical state
      // on next refetch but we update optimistically so the modal
      // doesn't keep showing "Failed" while we wait.
      onUpdate({
        ...post,
        publishStatus: 'published',
        publishFailureReason: null,
        metaPermalink: data.permalink ?? post.metaPermalink,
        status: 'published',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setRetryingPublish(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        'Eliminar este post permanentemente? Esta acción NO se puede deshacer.'
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/library/${post.id}?source=${post.source}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Delete failed');
        setDeleting(false);
        return;
      }
      onRemove(post.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setDeleting(false);
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

        {/* PR #32 — Reel video preview + processing state. videoUrl
            is the Supabase Storage public URL we uploaded — we can
            preview it inline without going through Meta. */}
        {post.isReel && post.videoUrl && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Reel video
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={post.videoUrl}
              controls
              playsInline
              className="w-full max-w-sm rounded bg-bg"
              style={{ aspectRatio: '9/16' }}
            />
            <div className="mt-2 text-xs text-text-3">
              {post.videoDurationSeconds
                ? `${post.videoDurationSeconds}s`
                : ''}
              {post.videoSizeBytes
                ? ` · ${(post.videoSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                : ''}
            </div>
            {post.reelProcessingStatus === 'meta_processing' && (
              <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-500">
                ⏱ Meta is processing this Reel. The polling worker will
                publish it once status hits FINISHED — typically 30–90
                seconds, sometimes longer for large videos.
              </div>
            )}
            {post.reelProcessingStatus === 'error' && (
              <div className="mt-2 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
                ⊘ {post.reelProcessingError ?? 'Reel processing failed'}
              </div>
            )}
          </div>
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

        {/* PR #29 — Publishing status block. Only renders for scheduled
            posts that have actually been touched by the publisher
            (publishStatus is set). Drafts and never-attempted posts
            don't show this. */}
        {post.source === 'scheduled' && post.publishStatus && (
          <div className="mb-5 p-4 bg-bg rounded-lg border border-border">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Publishing
            </div>

            {post.publishStatus === 'publishing' && (
              <div className="text-sm text-amber-500">
                Publishing now…
              </div>
            )}

            {post.publishStatus === 'published' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <span>✓</span>
                  <span>
                    {post.isStory
                      ? 'Story published successfully'
                      : 'Published successfully'}
                  </span>
                </div>
                {post.isStory && post.storyExpiresAt && (
                  <div className="text-xs">
                    {new Date(post.storyExpiresAt) > new Date() ? (
                      <span className="text-pink-500">
                        Expires{' '}
                        {new Date(post.storyExpiresAt).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-text-3">
                        Expired on{' '}
                        {new Date(post.storyExpiresAt).toLocaleString()}.
                        The permalink may no longer work unless you
                        archived this Story to a Highlight on Instagram.
                      </span>
                    )}
                  </div>
                )}
                {post.publishedAt && (
                  <div className="text-xs text-text-3">
                    {new Date(post.publishedAt).toLocaleString()}
                  </div>
                )}
                {post.metaPermalink && (
                  <a
                    href={post.metaPermalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    View on {post.platform === 'instagram'
                      ? 'Instagram'
                      : 'Facebook'}{' '}
                    ↗
                  </a>
                )}
              </div>
            )}

            {post.publishStatus === 'failed' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-danger">
                  <span>⚠</span>
                  <span>Publishing failed</span>
                </div>
                {post.publishFailureReason && (
                  <div className="text-xs text-text-3 bg-bg-elev p-2 rounded font-mono break-words">
                    {post.publishFailureReason}
                  </div>
                )}
                {post.publishRetryCount > 0 && (
                  <div className="text-[10px] text-text-3">
                    Auto-retry attempts: {post.publishRetryCount}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRetryPublish}
                  disabled={retryingPublish}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {retryingPublish ? 'Retrying…' : '↻ Retry now'}
                </button>
              </div>
            )}
          </div>
        )}

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

        {/* Actions
            PR #24 — split into destructive (left, red) and constructive
            (right) groups. Move-to-draft only shows for scheduled rows
            (it's a no-op for drafts and we explicitly disallow it on
            published rows server-side). Delete is always available
            because the user reported "I can't delete old posts" as the
            #1 papercut. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            {post.source === 'scheduled' && post.status === 'scheduled' && (
              <button
                type="button"
                onClick={handleMoveToDraft}
                disabled={movingToDraft}
                className="px-3 py-2 bg-bg border border-border rounded-lg text-sm hover:bg-bg-elev hover:border-border-bright transition-colors disabled:opacity-50"
              >
                {movingToDraft ? 'Moving…' : '← Move to draft'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 text-danger hover:bg-danger/10 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : '🗑 Delete forever'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
