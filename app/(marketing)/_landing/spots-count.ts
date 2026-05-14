// PR Sprint 7.19 — landing copy v3.1 (PRODUCTION).
//
// Server-side helper that returns the lifetime-spots counter
// rendered across the landing page (hero microcopy, mid-page
// CTA, pricing section, final-footer CTA).
//
// The two numbers (claimed + left) come from the same source
// so they always add up to 50 — per the landing-copy spec:
//
//   const claimed = await supabase.from('founders_spots').count()
//   const left = 50 - claimed
//
// We use the canonical `users` table count via Drizzle (service-
// role connection that bypasses RLS, since the landing renders
// for anonymous visitors). Capping at the 50-spot total means
// once we cross 50 signups, the page shows "50 claimed · 0 left"
// rather than negative numbers; the founder will edit copy at
// that point.
//
// Cached for 60 seconds at the route layer (export const revalidate
// in app/(marketing)/page.tsx) so the count is fresh-ish without
// hammering the DB on every page view.

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { count } from 'drizzle-orm';
import { logger } from '@/lib/observability/logger';

export const LIFETIME_SPOT_TOTAL = 50;

export interface SpotsCount {
  claimed: number;
  left: number;
  total: typeof LIFETIME_SPOT_TOTAL;
}

/**
 * Returns the current spots count. On DB error, falls back to
 * a sane "we just launched" state so the landing never breaks
 * because of an analytics query.
 */
export async function getSpotsCount(): Promise<SpotsCount> {
  try {
    const [row] = await db.select({ c: count() }).from(users);
    const raw = Number(row?.c ?? 0);
    const claimed = Math.min(LIFETIME_SPOT_TOTAL, Math.max(0, raw));
    return {
      claimed,
      left: LIFETIME_SPOT_TOTAL - claimed,
      total: LIFETIME_SPOT_TOTAL,
    };
  } catch (e) {
    logger.warn('landing/spots-count', 'count query failed', { error: e });
    // Safe defaults — the landing keeps rendering with a
    // believable starter number so a transient DB blip doesn't
    // break the conversion engine.
    return { claimed: 0, left: LIFETIME_SPOT_TOTAL, total: LIFETIME_SPOT_TOTAL };
  }
}
