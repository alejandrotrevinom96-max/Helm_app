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
import {
  applyGoldenTime,
  GOLDEN_TIMES,
  type Platform,
} from '@/lib/marketing/platform-rules';

// PR Sprint 7.26 — Asset-based content flow.
//
// When opened for a post that's part of a multi-platform asset
// group, the modal can ALSO schedule the asset's other platform
// variants in the same submit. Two new affordances:
//
//   - Sibling checkboxes: pick which other platforms in the asset
//     group should be scheduled alongside the one this modal was
//     opened for.
//   - Stagger toggle: when ON, each platform gets stamped with its
//     own GOLDEN_TIMES hour ON THE SAME DAY (TikTok 9am, IG 11am,
//     FB 2pm, etc.). When OFF, every platform shares the picked
//     time (founder explicitly chose a coordinated push).
//
// Submit fires POST /api/marketing/library/{id}/schedule once per
// selected post via Promise.allSettled — partial failures surface
// in the error pane but don't roll back successful schedules.
interface SiblingPost {
  id: string;
  platform: string;
}

interface Props {
  postId: string;
  // The platform of the post this modal was opened for. Used to
  // pre-select its golden-time when stagger is ON and to label
  // the row in the sibling list.
  platform?: string;
  // Other posts in the same content_asset group. Empty / undefined
  // = legacy single-platform schedule flow (the only path before
  // 7.26).
  siblings?: SiblingPost[];
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

export function ScheduleModal({
  postId,
  platform,
  siblings,
  onScheduled,
  onClose,
}: Props) {
  // Default to tomorrow 10am — matches the legacy "schedule for
  // tomorrow" pattern from the StructuredDraftCard.
  const [value, setValue] = useState<string>(() =>
    toDatetimeLocalValue(tomorrowAt(10)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PR Sprint 7.26 — sibling selection. Default to ALL siblings
  // checked because the founder almost always wants to ship the
  // multi-platform asset to every platform it was generated for.
  const [selectedSiblingIds, setSelectedSiblingIds] = useState<Set<string>>(
    () => new Set((siblings ?? []).map((s) => s.id)),
  );
  // Stagger ON by default when siblings exist — the whole point of
  // the multi-platform flow is each network getting its own
  // optimized time. Founder can flip it off if they want a
  // synchronized push (launch announcements, time-sensitive news).
  const [stagger, setStagger] = useState<boolean>(
    () => (siblings?.length ?? 0) > 0,
  );
  const hasSiblings = (siblings?.length ?? 0) > 0;

  const presets = useMemo(
    () => [
      { label: 'Tomorrow 9am', date: tomorrowAt(9) },
      { label: 'Tomorrow 2pm', date: tomorrowAt(14) },
      { label: 'Next Mon 9am', date: nextMondayAt(9) },
      { label: 'Next Mon 6pm', date: nextMondayAt(18) },
    ],
    [],
  );

  // PR Sprint 7.26 — Asset-based content flow.
  //
  // submit fires N parallel schedule calls when siblings are
  // selected. Each post gets either:
  //   - The user-picked time (stagger OFF), OR
  //   - The asset's CHOSEN DAY at the platform's golden time
  //     (stagger ON).
  //
  // We use Promise.allSettled so a single platform failure (e.g.
  // its OAuth token expired) doesn't block the others. Partial
  // failures surface in the error pane; the founder can re-run
  // for just the failed platforms.
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
      if (localDate.getTime() <= Date.now() + 1000) {
        setError(
          'Pick a time in the future (use Post now for immediate publish).',
        );
        setBusy(false);
        return;
      }

      // Build the post list: always include the primary post.
      // Then add the selected siblings.
      const allTargets: Array<{ id: string; platform: string }> = [
        { id: postId, platform: platform ?? '' },
      ];
      for (const s of siblings ?? []) {
        if (selectedSiblingIds.has(s.id)) {
          allTargets.push({ id: s.id, platform: s.platform });
        }
      }

      // Resolve each target's scheduledFor. When stagger is ON,
      // we apply the platform's golden time on the picked DAY
      // (ignoring the hour/minute the user typed). When OFF,
      // every target gets the same minute.
      const scheduleFor = (p: string): Date => {
        if (!stagger) return localDate;
        // applyGoldenTime expects a Platform; fall back to the
        // user-picked time if the platform isn't recognized.
        if (!(p in GOLDEN_TIMES)) return localDate;
        return applyGoldenTime(localDate, p as Platform);
      };

      const requests = allTargets.map((t) => {
        const iso = scheduleFor(t.platform).toISOString();
        return fetch(`/api/marketing/library/${t.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledFor: iso }),
        })
          .then(async (res) => ({
            id: t.id,
            platform: t.platform,
            iso,
            ok: res.ok,
            body: (await res.json().catch(() => ({}))) as {
              success?: boolean;
              error?: string;
              hint?: string;
            },
          }))
          .catch((e: unknown) => ({
            id: t.id,
            platform: t.platform,
            iso,
            ok: false,
            body: {
              error:
                e instanceof Error ? e.message : 'Network error',
            } as { success?: boolean; error?: string; hint?: string },
          }));
      });
      const results = await Promise.all(requests);
      const failed = results.filter(
        (r) => !r.ok || !r.body?.success,
      );
      if (failed.length === allTargets.length) {
        // Total failure — surface the first one's error verbatim.
        const f = failed[0];
        setError(f.body?.error ?? f.body?.hint ?? 'Schedule failed');
        setBusy(false);
        return;
      }
      if (failed.length > 0) {
        // Partial — surface a summary but keep the modal closed
        // since some platforms DID schedule.
        const names = failed
          .map((f) => f.platform || f.id)
          .join(', ');
        setError(
          `Scheduled ${results.length - failed.length} of ${results.length}. Failed: ${names}.`,
        );
        // Still call onScheduled so the parent refreshes — partial
        // success should still update the UI for the rows that did
        // ship.
      }
      // Use the primary post's iso for the legacy callback shape
      // (the parent uses it for an in-memory update).
      onScheduled(results[0]?.iso ?? localDate.toISOString());
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

          {/* PR Sprint 7.26 — sibling platform picker + stagger
              toggle. Only renders when the parent passed siblings,
              i.e. this post belongs to a multi-platform asset
              group. Founders can de-select platforms they don't
              want to schedule in this batch (rare — defaulted ON). */}
          {hasSiblings && (
            <div className="pt-2 border-t border-border">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                Also schedule asset siblings
              </div>
              <div className="space-y-1.5">
                {(siblings ?? []).map((s) => {
                  const checked = selectedSiblingIds.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(selectedSiblingIds);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          setSelectedSiblingIds(next);
                        }}
                      />
                      <span className="text-text-1">{s.platform}</span>
                      {stagger && s.platform in GOLDEN_TIMES && (
                        <span className="text-[10px] font-mono text-text-3">
                          @ {GOLDEN_TIMES[s.platform as Platform]}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <label className="flex items-start gap-2 mt-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={stagger}
                  onChange={() => setStagger((v) => !v)}
                  className="mt-1"
                />
                <span>
                  <span className="text-text-1">Stagger by golden time</span>
                  <span className="block text-[11px] text-text-3 mt-0.5">
                    Each platform posts at its own peak hour on the
                    chosen day (TikTok 9am, IG 11am, FB 2pm, …).
                    Turn off to schedule every platform at the same
                    exact minute.
                  </span>
                </span>
              </label>
            </div>
          )}

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
