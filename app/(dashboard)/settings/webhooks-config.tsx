'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';

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

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <GlassCard className="p-6 space-y-5">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Webhooks
        </div>
        <h3 className="font-display text-xl font-light mb-2">
          Webhook delivery
        </h3>
        <p className="text-sm text-text-2">
          When a scheduled post is due, Helm POSTs to your URL. Useful for
          Zapier, n8n, Buffer, or any custom automation.
        </p>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Webhook URL
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="text-xs text-text-3 mt-1">
          Must be HTTPS (HTTP allowed only for localhost testing).
        </p>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Signing secret
        </label>
        {revealedSecret ? (
          <div>
            <code className="block text-xs bg-bg-elev px-3 py-2 rounded text-text-1 break-all">
              {revealedSecret}
            </code>
            <p className="text-xs text-amber-500 mt-2">
              ⚠ Copy this now. We won&apos;t show it again.
            </p>
          </div>
        ) : hasSecret ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-bg-elev px-3 py-2 rounded text-text-3">
              ••••••••••••••••••••••••••••••••
            </code>
            <Button variant="ghost" size="sm" onClick={generateSecret}>
              Regenerate
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-3">No secret set</span>
            <Button variant="ghost" size="sm" onClick={generateSecret}>
              Generate
            </Button>
          </div>
        )}
        <p className="text-xs text-text-3 mt-2">
          Helm signs each payload with HMAC-SHA256 in header{' '}
          <code className="text-text-2">X-Helm-Signature</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save URL'}
        </Button>
        <Button
          variant="secondary"
          onClick={testWebhook}
          disabled={testing || !url}
        >
          {testing ? 'Testing…' : 'Send test ping'}
        </Button>
        {url && (
          <>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={remove}>
              Remove
            </Button>
          </>
        )}
      </div>

      {feedback && (
        <div
          className={`text-sm ${feedback.kind === 'success' ? 'text-success' : 'text-danger'}`}
        >
          {feedback.kind === 'success' ? '✓' : '⚠'} {feedback.msg}
        </div>
      )}

      <details className="pt-2 border-t border-border">
        <summary className="text-xs text-text-3 cursor-pointer hover:text-text-1">
          Sample payload structure
        </summary>
        <pre className="mt-2 text-[11px] bg-bg-elev p-3 rounded overflow-auto leading-relaxed">{`{
  "event": "scheduled_post.due",
  "timestamp": "2026-05-04T12:34:56.789Z",
  "data": {
    "id": "uuid-of-post",
    "platform": "instagram",
    "content": "Post text...",
    "scheduledFor": "2026-05-04T12:30:00.000Z"
  }
}`}</pre>
        <p className="text-[11px] text-text-3 mt-2">
          Verify the signature server-side:{' '}
          <code className="text-text-2">
            HMAC_SHA256(secret, body) === header.split(&apos;=&apos;)[1]
          </code>
        </p>
      </details>
    </GlassCard>
  );
}
