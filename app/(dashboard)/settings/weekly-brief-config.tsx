'use client';

// PR #58 — Sprint 7.0.2: Settings card for the Monday Weekly Brief.
//
// - Toggle: writes `users.weekly_brief_enabled`. Cron honors this.
// - "Send test now" button: invokes /api/research/test-brief for
//   the founder's active project. Useful pre-Monday sanity check.
//
// We fetch the toggle state on mount so a hard refresh doesn't show
// it stuck on the wrong value.
//
// PR Sprint 7.25 Phase 2 — repainted on top of the platform redesign
// (green-glow card, big 52x28 toggle, mono ghost-link footer). All
// API integrations are untouched.
import { useEffect, useState } from 'react';

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

  const toggle = async () => {
    if (saving || loading) return;
    const next = !enabled;
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
    <section className="platform-card platform-card-glow-green platform-reveal-2">
      <div className="platform-brief-head">
        <div>
          <h2 className="platform-h2">Weekly Audience Brief</h2>
          <p className="platform-desc">
            Every Monday morning, we&apos;ll email you a brief with the pain
            points your audience discussed this week,{' '}
            <b>5 ready-to-post angles</b> in your voice, and a recap of what
            worked / flopped.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle Weekly Brief email"
          disabled={loading || saving}
          onClick={toggle}
          className={`platform-toggle-big${enabled ? '' : ' platform-toggle-off'}`}
        />
      </div>

      {enabled && (
        <div className="platform-card-foot">
          <button
            type="button"
            onClick={sendTest}
            disabled={!projectId || testing}
            className="platform-ghost-link"
          >
            {testing ? 'Sending…' : 'Send test brief now'}
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {!projectId && (
            <span className="platform-field-help">
              (no active project to brief)
            </span>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`platform-field-help ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-success'
                : ''
          }`}
          style={{ marginTop: '10px' }}
        >
          {feedback.msg}
        </div>
      )}
    </section>
  );
}
