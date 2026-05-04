'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { broadcastEvent } from '@/hooks/use-broadcast';

export interface EditablePost {
  id: string;
  platform: string;
  content: string;
  scheduledFor: string | Date;
}

// Convert a UTC Date back into a YYYY-MM-DDTHH:mm string the
// <input type="datetime-local"> expects in the browser's local zone.
function toLocalDatetimeInputValue(d: Date): string {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function localMinDatetime(): string {
  return toLocalDatetimeInputValue(new Date());
}

export function EditScheduledModal({
  post,
  onClose,
  onSaved,
}: {
  post: EditablePost | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) return;
    setContent(post.content);
    setPlatform(post.platform);
    const d = new Date(post.scheduledFor);
    setScheduledFor(toLocalDatetimeInputValue(d));
    setError(null);
  }, [post]);

  // Close on Escape — basic accessibility for modals
  useEffect(() => {
    if (!post) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [post, onClose]);

  if (!post) return null;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketing/schedule?id=${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          platform,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save');
      } else {
        broadcastEvent({ type: 'scheduled-post-updated' });
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Edit scheduled post"
    >
      <GlassCard
        elevated
        className="max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4 gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Scheduled post
            </div>
            <h2 className="font-display text-2xl font-light">Edit scheduled post</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent [color-scheme:dark]"
            >
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
              <option value="threads">Threads</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Scheduled for
            </label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={localMinDatetime()}
              className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm text-text-1 [color-scheme:dark]"
            />
            <p className="text-xs text-text-3 mt-1">
              Times in your timezone: <span className="font-mono">{tz}</span>
            </p>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={loading || !content.trim() || !scheduledFor}
            >
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
