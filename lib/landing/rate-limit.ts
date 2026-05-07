// PR #34 — Sprint 6.2: per-IP rate limiter for the public preview
// endpoint. Hashed IP only (privacy + GDPR-friendlier).
// PR #36 — split into peek + commit so failed-pre-Anthropic
// requests don't burn the user's hourly cap. Pre-PR-36 a user
// who typed 5 typos (DNS fails) got blocked for an hour without
// ever consuming Anthropic credits — terrible UX.
//
// Sliding window:
//   - 5 requests per 1-hour window per ip_hash
//   - 6th committed request gets a 1-hour block
//   - Window resets when no committed requests for 1h
//   - peek() never increments; commit() does the real work
//
// We don't use Redis or a managed limiter — Postgres handles a few
// QPS without breaking a sweat for a public endpoint that's already
// expected to top out at the per-IP cap. If we ever need >100 QPS
// of preview traffic we can swap to Vercel Edge Config / KV.
import { db } from '@/lib/db';
import { previewRateLimits } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';

const WINDOW_MINUTES = 60;
const MAX_REQUESTS_PER_WINDOW = 5;
const BLOCK_DURATION_MINUTES = 60;

// IP_HASH_SALT is a separate env var (not the same as the token
// encryption key) so rotating it doesn't invalidate stored tokens.
// Falls back to NEXTAUTH_SECRET in dev.
function ipHashSalt(): string {
  return (
    process.env.IP_HASH_SALT ??
    process.env.NEXTAUTH_SECRET ??
    'helm-default-ip-salt-do-not-use-in-prod'
  );
}

export function hashIp(ip: string): string {
  return createHash('sha256')
    .update(ip + ipHashSalt())
    .digest('hex')
    .slice(0, 32);
}

// Pulls the client IP from Vercel-set headers. Falls back through a
// few candidate names so this still works behind other proxies.
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetAt?: Date;
  reason?: string;
}

// Read-only check. Tells us if the IP is currently blocked AND how
// many slots are left in the current window. Doesn't touch the row
// — call commitRateLimit() AFTER the request succeeds (or at least
// reaches the expensive part) to actually consume a slot.
export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const ipHash = hashIp(ip);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(previewRateLimits)
    .where(eq(previewRateLimits.ipHash, ipHash))
    .limit(1);

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      remainingRequests: 0,
      resetAt: existing.blockedUntil,
      reason: `Too many requests. Try again at ${existing.blockedUntil.toISOString()}.`,
    };
  }

  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const windowExpired =
    !existing ||
    now.getTime() - existing.windowStart.getTime() > windowMs;

  // No row, expired window, or non-blocked existing row → still room.
  // remaining is computed against a hypothetical "if I committed now"
  // so the UI can preview "X requests left this hour" honestly.
  const currentCount = windowExpired ? 0 : existing.count;
  return {
    allowed: true,
    remainingRequests: Math.max(0, MAX_REQUESTS_PER_WINDOW - currentCount),
  };
}

// Increments the counter. Call ONLY after the endpoint did real work
// (cache hit return, or about to call Anthropic). Failures that exit
// before this point (URL invalid, fetch DNS fail, etc.) shouldn't
// burn the user's cap.
//
// Returns allowed=false if this commit would push past the cap. The
// caller should treat that as 429 (race-condition guard between two
// concurrent requests in the same second).
export async function commitRateLimit(ip: string): Promise<RateLimitResult> {
  const ipHash = hashIp(ip);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(previewRateLimits)
    .where(eq(previewRateLimits.ipHash, ipHash))
    .limit(1);

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      remainingRequests: 0,
      resetAt: existing.blockedUntil,
      reason: `Too many requests. Try again at ${existing.blockedUntil.toISOString()}.`,
    };
  }

  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const windowExpired =
    !existing ||
    now.getTime() - existing.windowStart.getTime() > windowMs;

  if (windowExpired) {
    await db
      .insert(previewRateLimits)
      .values({ ipHash, count: 1, windowStart: now, blockedUntil: null })
      .onConflictDoUpdate({
        target: previewRateLimits.ipHash,
        set: { count: 1, windowStart: now, blockedUntil: null },
      });
    return {
      allowed: true,
      remainingRequests: MAX_REQUESTS_PER_WINDOW - 1,
    };
  }

  const newCount = existing.count + 1;
  if (newCount > MAX_REQUESTS_PER_WINDOW) {
    const blockedUntil = new Date(
      now.getTime() + BLOCK_DURATION_MINUTES * 60 * 1000
    );
    await db
      .update(previewRateLimits)
      .set({ blockedUntil })
      .where(eq(previewRateLimits.ipHash, ipHash));
    return {
      allowed: false,
      remainingRequests: 0,
      resetAt: blockedUntil,
      reason: `Rate limit exceeded (${MAX_REQUESTS_PER_WINDOW}/hour). Try again in 1 hour.`,
    };
  }

  await db
    .update(previewRateLimits)
    .set({ count: newCount })
    .where(eq(previewRateLimits.ipHash, ipHash));

  return {
    allowed: true,
    remainingRequests: MAX_REQUESTS_PER_WINDOW - newCount,
  };
}
