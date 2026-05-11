'use client';

// PR #58 — Sprint 7.0.2: Settings card for the Monday Weekly Brief.
//
// - Toggle: writes `users.weekly_brief_enabled`. Cron honors this.
// - "Send test now" button: invokes /api/research/test-brief for
//   the founder's active project. Useful pre-Monday sanity check.
//
// We fetch the toggle state on mount so a hard refresh doesn't show
// it stuck on the wrong value.
import { useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Switch } from '@/components/ui/switch';

interface Props {
  /** Active project ID used by the test-brief button. */
  projectId: string | null;
}

export function WeeklyBriefConfig({ projectId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/weekly-brief-toggle', {
          cache: 'no-store',
        });
        const data = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEnabled(Boolean(data.enabled));
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    // Optimistic — flip the UI immediately, revert on failure.
    const previous = enabled;
    setEnabled(next);
    try {
      const res = await fetch('/api/user/weekly-brief-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setEnabled(previous);
        setFeedback({ kind: 'error', msg: 'Failed to save preference.' });
        return;
      }
      setFeedback({
        kind: 'success',
        msg: next
          ? 'You\'ll get a brief every Monday morning.'
          : 'Weekly brief turned off.',
      });
    } catch {
      setEnabled(previous);
      setFeedback({ kind: 'error', msg: 'Network error.' });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!projectId || testing) return;
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/research/test-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skipped?: boolean;
        reason?: string;
        error?: string;
        emailId?: string;
      };
      if (data.success) {
        setFeedback({
          kind: 'success',
          msg: 'Test brief sent to your email. Check your inbox.',
        });
      } else if (data.skipped) {
        setFeedback({
          kind: 'info',
          msg:
            data.reason ??
            'Nothing to brief on yet. Run Extract on the Research page first.',
        });
      } else {
        setFeedback({
          kind: 'error',
          msg: data.error ?? 'Test brief failed.',
        });
      }
    } catch {
      setFeedback({ kind: 'error', msg: 'Network error.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl font-light mb-1">
            Weekly Audience Brief
          </h2>
          <p className="text-sm text-text-3 max-w-prose">
            Every Monday morning, we&apos;ll email you a brief with the pain
            points your audience discussed this week, 5 ready-to-post angles
            in your voice, and a recap of what worked / flopped.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={loading || saving}
          label="Toggle Weekly Brief email"
        />
      </div>

      {enabled && (
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <button
            type="button"
            onClick={sendTest}
            disabled={!projectId || testing}
            className="text-xs font-mono text-accent hover:opacity-80 disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send test brief now →'}
          </button>
          {!projectId && (
            <span className="text-xs text-text-3">
              (no active project to brief)
            </span>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`mt-3 text-xs ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {feedback.msg}
        </div>
      )}
    </GlassCard>
  );
}
