'use client';

// PR #43 — Sprint 6.7.1: detail modal for a clicked calendar post.
//
// Why a calendar-specific modal instead of reusing
// `app/(dashboard)/marketing/library/post-detail-modal.tsx`:
// the Library modal expects a full LibraryPost (rating fields,
// publish lifecycle, clone callback, etc.) and is bound to
// /api/marketing/library mutation endpoints. The calendar
// already has the data it needs (CalendarPost shape), so we
// render directly from props — no extra fetch, no FK indirection,
// no risk of clone/delete/rating mutations from a calendar click.
//
// Capabilities deliberately kept narrow:
//   - Show caption + image + scheduled time + platform
//   - Share via the existing ShareButton (the v3-blocked feature
//     replacement; native share on mobile, fallback modal desktop)
//   - Close on click-outside / X button / Escape
//
// What's NOT here (deferred / handled elsewhere):
//   - Edit (Library modal handles it via PATCH /library/[id])
//   - Reschedule (drag-drop + golden-times modal already do this)
//   - Cancel (Library "Move to draft" / Delete handle it)
import { useEffect } from 'react';
import { Calendar, X } from 'lucide-react';
import type { CalendarPost } from '@/app/api/marketing/calendar/route';
import { ShareButton } from '@/components/share/share-button';
import { PlatformPill } from '@/components/platform-pill';
import { getPlatformStyle } from '@/lib/platforms/colors';

interface Props {
  post: CalendarPost | null;
  onClose: () => void;
}

function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CalendarPostModal({ post, onClose }: Props) {
  // Escape-to-close. Mounted unconditionally and conditional on
  // `post` so the listener is removed when the modal closes; we
  // don't want the global escape key intercepted while no modal
  // is rendered.
  useEffect(() => {
    if (!post) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [post, onClose]);

  if (!post) return null;

  const style = getPlatformStyle(post.platform);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        // Click-outside closes; clicks inside the inner card don't
        // bubble (stopPropagation below).
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Scheduled post detail"
    >
      <div
        className="bg-bg-elev border border-border rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        style={{
          borderTopColor: style.brand,
          borderTopWidth: '4px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-border gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <PlatformPill platform={post.platform} size="md" />
            <div className="flex items-center gap-1 text-xs text-text-3">
              <Calendar className="w-3 h-3" />
              {formatScheduledTime(post.scheduledFor)}
            </div>
            {post.isStory && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-pink-500/15 text-pink-500">
                📸 Story
              </span>
            )}
            {post.isReel && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/15 text-purple-500">
                🎬 Reel
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text-1 p-1 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* PR Sprint 7.27 — Video preview for UGC/Reel rows.
              videoUrl + structuredContent.baseContent are now
              carried by the calendar API so the modal can show
              the rendered take + the script the avatar speaks. */}
          {(() => {
            const isVideo =
              post.contentType === 'ugc' ||
              post.contentType === 'reel' ||
              post.isReel;
            const script = (
              post.structuredContent as { baseContent?: string } | null
            )?.baseContent;
            return (
              <>
                {isVideo && post.videoUrl ? (
                  <video
                    src={post.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    poster={post.visualUrl ?? undefined}
                    className="w-full rounded-lg max-h-96 object-cover bg-bg aspect-[9/16]"
                  />
                ) : post.visualUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.visualUrl}
                    alt=""
                    className="w-full rounded-lg max-h-80 object-cover bg-bg"
                  />
                ) : isVideo ? (
                  <div className="w-full aspect-video rounded-lg bg-bg-elev border border-dashed border-purple-500/30 flex items-center justify-center text-purple-500">
                    <div className="text-center">
                      <div className="text-2xl mb-1" aria-hidden>
                        🎬
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.15em]">
                        Video rendering…
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* SCRIPT — what the avatar speaks. Distinct from
                    the caption below so the founder doesn't mix
                    them up. */}
                {isVideo && script && (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-500">
                        🎥 Script · spoken by avatar
                      </div>
                      <span className="text-[10px] font-mono text-text-3">
                        {script.split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>
                    <p className="text-sm text-text-1 whitespace-pre-wrap leading-relaxed">
                      {script}
                    </p>
                  </div>
                )}

                {/* PLATFORM CAPTION */}
                <div>
                  {isVideo && (
                    <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1.5">
                      ✏️ {post.platform} caption
                    </div>
                  )}
                  <div className="text-sm text-text-1 whitespace-pre-wrap leading-relaxed">
                    {post.content}
                  </div>
                </div>
              </>
            );
          })()}

          {post.publishStatus === 'published' && (
            <div className="text-xs text-emerald-500 inline-flex items-center gap-1">
              ✓ Published
            </div>
          )}
          {post.publishStatus === 'failed' && (
            <div className="text-xs text-danger inline-flex items-center gap-1">
              ⚠ Publishing failed
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-border">
          <ShareButton
            caption={post.content}
            imageUrl={post.visualUrl}
            variant="primary"
            label="Share now"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
