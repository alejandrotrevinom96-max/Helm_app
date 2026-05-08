// PR #39 — Sprint 6.5: HMAC-signed OAuth state.
//
// Pre-PR-39, the Meta OAuth flow used base64(JSON({userId, projectId,
// timestamp})) as the `state` parameter. That's CSRF-resistant by
// virtue of unguessable userId values + a 10-min freshness check +
// callback-side userId equality with the logged-in Supabase session,
// but the state itself was unsigned — anyone could craft a state
// claiming any userId/projectId. Defense in depth said: if Supabase
// auth ever has a bug, an attacker could exploit it.
//
// PR #39 wraps the state with HMAC-SHA256 so the callback can refuse
// any state that wasn't issued by us. Format:
//
//   <base64url-payload>.<base64url-mac>
//
// Where `payload` is the JSON blob and `mac` is HMAC-SHA256 of the
// payload using STATE_SIGNING_KEY (falling back to NEXTAUTH_SECRET
// for dev / TOKEN_ENCRYPTION_KEY as a last resort so a deploy
// without the dedicated env var still has *some* secret).
//
// VERIFICATION uses crypto.timingSafeEqual to avoid timing oracles.
// TTL is enforced by the caller via the embedded `timestamp`.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

function getKey(): Buffer {
  const secret =
    process.env.OAUTH_STATE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.TOKEN_ENCRYPTION_KEY ??
    process.env.ENCRYPTION_KEY ??
    null;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // Hard fail in prod — without a key we can't authenticate
      // OAuth callbacks at all and would silently sign with a
      // hardcoded string an attacker could trivially mint with.
      throw new Error(
        '[oauth-state] OAUTH_STATE_KEY (or NEXTAUTH_SECRET / TOKEN_ENCRYPTION_KEY / ENCRYPTION_KEY) must be set in production.'
      );
    }
    return Buffer.from('helm-dev-state-key-do-not-use-in-prod');
  }
  return Buffer.from(secret, 'utf8');
}

function base64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf as Buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(padded + padding, 'base64');
}

/**
 * Sign + serialize a state payload. Adds a `nonce` so two states
 * generated in the same millisecond (unlikely but possible) still
 * differ. Caller embeds whatever fields they need (userId,
 * projectId, timestamp).
 */
export function signState<T extends Record<string, unknown>>(payload: T): string {
  const withNonce = { ...payload, _n: randomBytes(8).toString('hex') };
  const json = JSON.stringify(withNonce);
  const payloadB64 = base64urlEncode(Buffer.from(json, 'utf8'));
  const mac = createHmac('sha256', getKey()).update(payloadB64).digest();
  return `${payloadB64}.${base64urlEncode(mac)}`;
}

/**
 * Verify + parse a signed state. Returns null on:
 *   - malformed input
 *   - bad signature
 *   - JSON parse failure
 *
 * The caller is responsible for additional checks (timestamp TTL,
 * field shape validation).
 */
export function verifyState<T = unknown>(state: string): T | null {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [payloadB64, macB64] = state.split('.');
  if (!payloadB64 || !macB64) return null;

  const expected = createHmac('sha256', getKey()).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = base64urlDecode(macB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const json = base64urlDecode(payloadB64).toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
