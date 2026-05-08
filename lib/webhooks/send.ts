import crypto from 'crypto';
import { assertSafeUrl } from '@/lib/security/url-validator';

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}

// POST a JSON payload to a user-configured webhook. Signs the body with
// HMAC-SHA256 in `X-Helm-Signature: sha256=<hex>` when a secret is set.
// Fire-and-forget at the call site: caller decides whether to retry or log.
//
// PR #39 Sprint 6.5: the URL is user-controlled (Settings → Webhook).
// Without an SSRF gate, an attacker who manages to set their webhook to
// http://localhost:5432/ or http://169.254.169.254/latest/meta-data/
// would have us POST our serialized event payload to internal services
// — and worse, the cron worker that fires these webhooks runs in our
// trust domain. We resolve the URL through assertSafeUrl on every call
// (cheap — one DNS lookup) and refuse anything that points to a
// private/internal address.
//
// Redirects: we set redirect: 'manual' so a webhook receiver can't
// 302 us into a private host. If we ever need to follow redirects for
// legit webhook flows we'll re-validate each hop the way preview-bible
// does. For now manual is the safe default — consumers SHOULD answer
// at the canonical URL they registered.
export async function sendWebhook(
  url: string,
  secret: string | null,
  payload: WebhookPayload
): Promise<WebhookResult> {
  const safe = await assertSafeUrl(url);
  if (!safe.valid || !safe.url) {
    return {
      ok: false,
      error: safe.reason ?? 'Webhook URL refused for safety reasons.',
    };
  }

  const body = JSON.stringify(payload);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : null;

  try {
    const res = await fetch(safe.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Helm-Webhook/1.0',
        ...(signature ? { 'X-Helm-Signature': `sha256=${signature}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });
    return { ok: res.ok, status: res.status, statusText: res.statusText };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
