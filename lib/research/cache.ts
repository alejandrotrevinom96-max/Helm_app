// PR #59 — Sprint 7.0.3: generic TTL cache backed by Postgres.
//
// Vercel KV moved to a paid tier late 2025 so we can't use it. The
// access pattern (one write per 24h per key, frequent reads) fits
// Postgres comfortably at our volume. The cleanup sweep happens
// daily inside sync-metrics so stale rows don't accumulate.
//
// Failure mode is intentional: every helper returns null/0 on error
// rather than throwing, so a cache outage NEVER takes down the
// caller. Reddit RSS fetcher will just hit the network again.
import { db } from '@/lib/db';
import { researchCache } from '@/lib/db/schema';
import { eq, lt, gt, and } from 'drizzle-orm';

export async function getCached<T = unknown>(
  key: string,
): Promise<T | null> {
  try {
    const [row] = await db
      .select()
      .from(researchCache)
      .where(
        and(
          eq(researchCache.cacheKey, key),
          gt(researchCache.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ? (row.cacheValue as T) : null;
  } catch (e) {
    console.error('[cache] getCached failed:', e);
    return null;
  }
}

export async function setCached(
  key: string,
  value: unknown,
  ttlHours = 24,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  try {
    await db
      .insert(researchCache)
      .values({
        cacheKey: key,
        cacheValue: value as object,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: researchCache.cacheKey,
        set: {
          cacheValue: value as object,
          expiresAt,
        },
      });
  } catch (e) {
    console.error('[cache] setCached failed:', e);
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    await db.delete(researchCache).where(eq(researchCache.cacheKey, key));
  } catch (e) {
    console.error('[cache] deleteCached failed:', e);
  }
}

/**
 * Remove every cache row whose expires_at is in the past. Called by
 * the daily sync-metrics cron — returns the number of rows deleted
 * so the cron can include it in its summary log.
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const deleted = await db
      .delete(researchCache)
      .where(lt(researchCache.expiresAt, new Date()))
      .returning({ id: researchCache.id });
    return deleted.length;
  } catch (e) {
    console.error('[cache] cleanupExpiredCache failed:', e);
    return 0;
  }
}
