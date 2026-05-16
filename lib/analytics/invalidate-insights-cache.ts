// PR Sprint B-finish — invalidate the analytics insights cache.
//
// The cache key is (userId, projectsHash) with a 24h TTL. Adding
// or removing a project changes the projectsHash so the cache
// drops naturally; everything else inside the 24h window keeps
// returning the same bullets EVEN AFTER significant activity
// (new post published, new asset generated, etc.).
//
// This helper forces invalidation by deleting every cache row
// scoped to the founder. Cheap (one indexed DELETE) and safe to
// call from any code path that meaningfully changes the metrics
// the insights are computed from.
//
// Failures are swallowed — the cache is a perf optimization, not
// a correctness primitive, so a transient DB hiccup here should
// never break the flow that triggered the invalidation.

import { db } from '@/lib/db';
import { analyticsInsightsCache } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function invalidateAnalyticsInsightsCache(
  userId: string,
): Promise<void> {
  try {
    await db
      .delete(analyticsInsightsCache)
      .where(eq(analyticsInsightsCache.userId, userId));
  } catch (err) {
    console.warn(
      '[analytics-insights] cache invalidation failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }
}
