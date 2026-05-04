import crypto from 'crypto';

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
export async function sendWebhook(
  url: string,
  secret: string | null,
  payload: WebhookPayload
): Promise<WebhookResult> {
  const body = JSON.stringify(payload);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Helm-Webhook/1.0',
        ...(signature ? { 'X-Helm-Signature': `sha256=${signature}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status, statusText: res.statusText };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
