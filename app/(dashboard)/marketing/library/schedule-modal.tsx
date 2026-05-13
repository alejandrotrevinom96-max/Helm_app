'use client';

// PR #80 — Sprint 7.5.2: Schedule picker modal opened from the
// post-detail-modal in /marketing/library.
//
// The legacy flow only had "Schedule 9am" + "Schedule…" (open in
// calendar) on the StructuredDraftCard at Generate time. Once a
// draft hit the Library the founder lost the affordance: no way
// to schedule from the detail modal without bouncing back to
// Generate.
//
// This modal offers four quick presets (now / tomorrow / next-
// Monday) plus a custom datetime-local picker. Submits to the
// existing /api/marketing/library/[id]/schedule endpoint (PR #25),
// which already handles ownership, validation, visualUrls/
// structuredContent copy to scheduled_posts, and Stories/Reels
// guards.
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  postId: string;
  onScheduled: (scheduledFor: string) => void;
  onClose: () => void;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// Format a Date as a value that <input type="datetime-local">
// can render. Always in LOCAL time — the input's spec doesn't
// support a timezone marker, so we convert once at submit.
function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function nextMondayAt(hour: number, minute = 0): Date {
  const d = new Date();
  // 0 = Sun, 1 = Mon. We want strictly NEXT Monday (not today
  // if today is Monday) so the offset is at least 1.
  const day = d.getDay();
  const offset = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function ScheduleModal({ postId, onScheduled, onClose }: Props) {
  // Default to tomorrow 10am — matches the legacy "schedule for
  // tomorrow" pattern from the StructuredDraftCard.
  const [value, setValue] = useState<string>(() =>
    toDatetimeLocalValue(tomorrowAt(10)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(
    () => [
      { label: 'Tomorrow 9am', date: tomorrowAt(9) },
      { label: 'Tomorrow 2pm', date: tomorrowAt(14) },
      { label: 'Next Mon 9am', date: nextMondayAt(9) },
      { label: 'Next Mon 6pm', date: nextMondayAt(18) },
    ],
    [],
  );

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const localDate = new Date(value);
      if (Number.isNaN(localDate.getTime())) {
        setError('Invalid date/time');
        setBusy(false);
        return;
      }
      // Refuse "in the past" — the schedule endpoint also rejects
      // it server-side but failing fast in the modal keeps the
      // network round-trip out of the loop.
      if (localDate.getTime() <= Date.now() + 1000) {
        setError('Pick a time in the future (use Post now for immediate publish).');
        setBusy(false);
        return;
      }
      const iso = localDate.toISOString();
      const res = await fetch(`/api/marketing/library/${postId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: iso }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? data.hint ?? 'Schedule failed');
        setBusy(false);
        return;
      }
      onScheduled(iso);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Schedule post"
    >
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-md w-full">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h3 className="font-display text-xl font-light">Schedule post</h3>
            <p className="text-sm text-text-3 mt-1">
              Cron picks it up when the time hits and publishes via the
              connected integration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
              Quick presets
            </div>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setValue(toDatetimeLocalValue(p.date))}
                  className="text-xs px-3 py-2 bg-bg border border-border rounded-lg hover:border-border-bright transition-colors text-left"
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] font-mono text-text-3 mt-0.5">
                    {p.date.toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="schedule-when"
              className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
            >
              Or pick exact time (your local timezone)
            </label>
            <input
              id="schedule-when"
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
            />
          </div>

          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="px-4 py-2 text-sm text-text-2 hover:text-text-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </Button>
        </div>
      </div>
    </div>
  );
}
