'use client';

// PR #40 — webhook config card. POSTs to /api/settings/webhook
// for URL save / secret regen / removal / test-ping. All backend
// behavior unchanged.
//
// PR Sprint 7.25 Phase 2 — repainted on top of the platform redesign
// (blue-glow card, mono eyebrow, native <details> payload preview,
// orange "Generate" secret action, primary orange CTA).
import { useState, useEffect } from 'react';

export function WebhooksConfig() {
  const [url, setUrl] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/settings/webhook')
      .then((r) => r.json())
      .then((d) => {
        setUrl(d.url ?? '');
        setHasSecret(!!d.hasSecret);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/settings/webhook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ kind: 'error', msg: data.error ?? 'Save failed' });
      } else {
        setFeedback({ kind: 'success', msg: 'URL saved' });
      }
    } finally {
      setSaving(false);
    }
  };

  const generateSecret = async () => {
    if (
      hasSecret &&
      !confirm(
        'Generate a new secret? This will invalidate any existing receivers using the old secret.'
      )
    )
      return;
    setFeedback(null);
    const res = await fetch('/api/settings/webhook', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerateSecret: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.secret) {
      setRevealedSecret(data.secret);
      setHasSecret(true);
    } else {
      setFeedback({ kind: 'error', msg: data.error ?? 'Failed to generate' });
    }
  };

  const testWebhook = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/settings/webhook/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFeedback({
          kind: 'success',
          msg: `Delivered · ${data.status} ${data.statusText ?? ''}`,
        });
      } else {
        setFeedback({
          kind: 'error',
          msg: data.reason ?? data.error ?? 'Failed',
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove webhook? Posts will no longer be sent to this URL.')) {
      return;
    }
    await fetch('/api/settings/webhook', { method: 'DELETE' });
    setUrl('');
    setHasSecret(false);
    setRevealedSecret(null);
    setFeedback({ kind: 'success', msg: 'Webhook removed' });
  };

  if (loading) {
    return (
      <section className="platform-card platform-card-glow-blue platform-reveal-3">
        <div className="platform-lbl">Webhooks</div>
        <h2 className="platform-h2">Webhook delivery</h2>
        <p className="platform-desc">Loading…</p>
      </section>
    );
  }

  return (
    <section className="platform-card platform-card-glow-blue platform-reveal-3">
      <div className="platform-lbl">Webhooks</div>
      <h2 className="platform-h2">Webhook delivery</h2>
      <p className="platform-desc">
        When a scheduled post is due, Helm POSTs to your URL. Useful for{' '}
        <b>Zapier</b>, <b>n8n</b>, <b>Buffer</b>, or any custom automation.
      </p>

      <div className="platform-field">
        <label className="platform-field-label" htmlFor="webhook-url">
          Webhook URL
        </label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="platform-input"
        />
        <p className="platform-field-help">
          Must be HTTPS (HTTP allowed only for{' '}
          <code>localhost</code> testing).
        </p>
      </div>

      <div className="platform-field">
        <div className="platform-field-label">Signing secret</div>
        {revealedSecret ? (
          <div>
            <code className="platform-secret-revealed">{revealedSecret}</code>
            <p className="platform-field-help" style={{ color: 'var(--d-orange-2)' }}>
              ⚠ Copy this now. We won&apos;t show it again.
            </p>
          </div>
        ) : hasSecret ? (
          <div className="platform-secret-row">
            <code className="platform-secret-mask">
              ••••••••••••••••••••••••••••••••
            </code>
            <button
              type="button"
              onClick={generateSecret}
              className="platform-secret-action"
            >
              Regenerate
            </button>
          </div>
        ) : (
          <div className="platform-secret-row">
            <span className="platform-secret-none">No secret set</span>
            <button
              type="button"
              onClick={generateSecret}
              className="platform-secret-action"
            >
              Generate
            </button>
          </div>
        )}
        <p className="platform-field-help">
          Helm signs each payload with <code>HMAC-SHA256</code> in header{' '}
          <code>X-Helm-Signature</code>.
        </p>
      </div>

      <div className="platform-actions-row">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="platform-btn platform-btn-primary"
        >
          {saving ? 'Saving…' : 'Save URL'}
        </button>
        <button
          type="button"
          onClick={testWebhook}
          disabled={testing || !url}
          className="platform-btn platform-btn-ghost"
        >
          {testing ? 'Testing…' : 'Send test ping'}
        </button>
        {url && (
          <>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={remove}
              className="platform-btn platform-btn-ghost"
            >
              Remove
            </button>
          </>
        )}
      </div>

      {feedback && (
        <div
          className="platform-field-help"
          style={{
            marginTop: '12px',
            color:
              feedback.kind === 'success'
                ? 'var(--d-green-2)'
                : 'var(--d-red-2)',
          }}
        >
          {feedback.kind === 'success' ? '✓' : '⚠'} {feedback.msg}
        </div>
      )}

      <details className="platform-payload">
        <summary className="platform-payload-summary">
          Sample payload structure
        </summary>
        <pre className="platform-payload-block">{`{
  "event": "scheduled_post.due",
  "timestamp": "2026-05-04T12:34:56.789Z",
  "data": {
    "id": "uuid-of-post",
    "platform": "instagram",
    "content": "Post text...",
    "scheduledFor": "2026-05-04T12:30:00.000Z"
  }
}`}</pre>
        <p className="platform-field-help" style={{ marginTop: '8px' }}>
          Verify the signature server-side:{' '}
          <code>HMAC_SHA256(secret, body) === header.split(&apos;=&apos;)[1]</code>
        </p>
      </details>
    </section>
  );
}
