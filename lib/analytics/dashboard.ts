import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  scheduledPosts,
  waitlistResponses,
  waitlistPages,
  researchFindings,
} from '@/lib/db/schema';
import { eq, and, gte, lt, sql, count, inArray } from 'drizzle-orm';

interface KPI {
  value: number;
  sparkline: number[];
  // PR #83 — Sprint 7.8: period-over-period delta. `previous` is the
  // count from the prior 7-day window (so a `7d` period means
  // current = [now-7d, now], previous = [now-14d, now-7d]).
  // `previous` is null when there's no prior data — the UI shows no
  // delta line in that case rather than inventing a zero baseline
  // that would lie about momentum.
  previous: number | null;
  period: '7d';
}

export interface DashboardData {
  totalSignups: KPI;
  postsPublished: KPI;
  researchInsights: KPI;
  validateResponseRate: {
    value: number;
    total: number;
    activePages: number;
  };
}

// Fill missing days with 0 so the sparkline always has the same length and
// the trend reads correctly (a 1-data-point sparkline lies about momentum).
function dailyToSparkline(
  rows: Array<{ day: string; cnt: number }>,
  days: number
): number[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, Number(r.cnt));
  const result: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    result.push(map.get(d.toISOString().split('T')[0]) ?? 0);
  }
  return result;
}

// Aggregated KPIs across the user's projects. PR #18 added scope support:
//   - scope='global' (default): query every project the user owns, like
//     before. The /analytics page passes this when its toggle is "All
//     projects".
//   - scope='project': filter to a single projectId. The /analytics page
//     passes this when the toggle is "This project".
// The /api/analytics/dashboard route still calls without args (= global).
export async function getDashboardData(
  options: { scope?: 'global' | 'project'; projectId?: string } = {}
): Promise<DashboardData | { error: string; status: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized', status: 401 };

  // Decide which projects to aggregate over. In scope=project we still
  // verify ownership by joining the user's project list.
  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, user.id));
  const allProjectIds = userProjects.map((p) => p.id);

  const projectIds =
    options.scope === 'project' && options.projectId
      ? allProjectIds.filter((id) => id === options.projectId)
      : allProjectIds;

  const empty: DashboardData = {
    totalSignups: { value: 0, sparkline: [], previous: null, period: '7d' },
    postsPublished: { value: 0, sparkline: [], previous: null, period: '7d' },
    researchInsights: { value: 0, sparkline: [], previous: null, period: '7d' },
    validateResponseRate: { value: 0, total: 0, activePages: 0 },
  };

  if (projectIds.length === 0) return empty;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  // PR #83 — Sprint 7.8: two 7-day windows for period-over-period
  // deltas. `currentSince` is "last 7 days ending now"; `prevSince`
  // is "the 7 days before that". A row's createdAt/foundAt is in
  // the current window if it's >= currentSince, and in the previous
  // window if it's in [prevSince, currentSince).
  const currentSince = new Date(Date.now() - 7 * 86400000);
  const prevSince = new Date(Date.now() - 14 * 86400000);

  // 1. Total signups + 14-day sparkline
  const userPages = await db
    .select({ id: waitlistPages.id })
    .from(waitlistPages)
    .where(inArray(waitlistPages.projectId, projectIds));
  const pageIds = userPages.map((p) => p.id);

  let totalSignups = 0;
  let signupsSparkline: number[] = [];
  // PR #83: 7d-window counts for the period-over-period delta.
  // `totalSignups` is all-time (matches PR #18 contract — the
  // widget shows lifetime total); `signupsCurrent7d` /
  // `signupsPrev7d` drive the delta line below the number.
  let signupsCurrent7d = 0;
  let signupsPrev7d: number | null = null;

  if (pageIds.length > 0) {
    const totalResp = await db
      .select({ count: count() })
      .from(waitlistResponses)
      .where(inArray(waitlistResponses.waitlistPageId, pageIds));
    totalSignups = Number(totalResp[0]?.count ?? 0);

    const day = sql<string>`date_trunc('day', ${waitlistResponses.createdAt})::date::text`;
    const dailySignups = await db
      .select({ day, cnt: count() })
      .from(waitlistResponses)
      .where(
        and(
          inArray(waitlistResponses.waitlistPageId, pageIds),
          gte(waitlistResponses.createdAt, thirtyDaysAgo)
        )
      )
      .groupBy(day)
      .orderBy(day);
    signupsSparkline = dailyToSparkline(
      dailySignups.map((r) => ({ day: r.day, cnt: Number(r.cnt) })),
      14
    );

    // 7d / prior-7d counts. We sum from the daily breakdown that
    // already exists so we don't pay another SQL round-trip.
    const cutoffCurrent = currentSince.toISOString().split('T')[0];
    const cutoffPrev = prevSince.toISOString().split('T')[0];
    let anyPrevData = false;
    for (const { day, cnt } of dailySignups) {
      const n = Number(cnt);
      if (day >= cutoffCurrent) {
        signupsCurrent7d += n;
      } else if (day >= cutoffPrev) {
        signupsPrev7d = (signupsPrev7d ?? 0) + n;
        anyPrevData = true;
      }
    }
    // If we never saw any prior-window data, previous stays null —
    // the UI then hides the delta rather than show "↓ -X vs last 7d"
    // against a fabricated zero baseline.
    if (!anyPrevData) signupsPrev7d = null;
  }

  // 2. Posts published last 30 days (status notified or posted)
  const postsPublishedRes = await db
    .select({ count: count() })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, user.id),
        gte(scheduledPosts.scheduledFor, thirtyDaysAgo),
        sql`${scheduledPosts.status} IN ('notified', 'posted')`
      )
    );

  const postsDay = sql<string>`date_trunc('day', ${scheduledPosts.scheduledFor})::date::text`;
  const dailyPosts = await db
    .select({ day: postsDay, cnt: count() })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, user.id),
        gte(scheduledPosts.scheduledFor, thirtyDaysAgo),
        sql`${scheduledPosts.status} IN ('notified', 'posted')`
      )
    )
    .groupBy(postsDay)
    .orderBy(postsDay);
  const postsSparkline = dailyToSparkline(
    dailyPosts.map((r) => ({ day: r.day, cnt: Number(r.cnt) })),
    14
  );

  // PR #83 — period-over-period for posts. Same daily-breakdown
  // reduce pattern as signups above. Note: the all-time KPI value
  // counts the FULL 30-day window for posts (different from
  // signups which is lifetime), but the delta still compares the
  // last 7d to the prior 7d so the founder gets weekly momentum.
  let postsCurrent7d = 0;
  let postsPrev7d: number | null = null;
  {
    const cutoffCurrent = currentSince.toISOString().split('T')[0];
    const cutoffPrev = prevSince.toISOString().split('T')[0];
    let anyPrevData = false;
    for (const { day, cnt } of dailyPosts) {
      const n = Number(cnt);
      if (day >= cutoffCurrent) {
        postsCurrent7d += n;
      } else if (day >= cutoffPrev) {
        postsPrev7d = (postsPrev7d ?? 0) + n;
        anyPrevData = true;
      }
    }
    if (!anyPrevData) postsPrev7d = null;
  }

  // 3. Research findings count + 14-day sparkline
  const insightsRes = await db
    .select({ count: count() })
    .from(researchFindings)
    .where(inArray(researchFindings.projectId, projectIds));

  const insightsDay = sql<string>`date_trunc('day', ${researchFindings.foundAt})::date::text`;
  const dailyInsights = await db
    .select({ day: insightsDay, cnt: count() })
    .from(researchFindings)
    .where(
      and(
        inArray(researchFindings.projectId, projectIds),
        gte(researchFindings.foundAt, thirtyDaysAgo)
      )
    )
    .groupBy(insightsDay)
    .orderBy(insightsDay);
  const insightsSparkline = dailyToSparkline(
    dailyInsights.map((r) => ({ day: r.day, cnt: Number(r.cnt) })),
    14
  );

  // PR #83 — period-over-period for research findings.
  let insightsCurrent7d = 0;
  let insightsPrev7d: number | null = null;
  {
    const cutoffCurrent = currentSince.toISOString().split('T')[0];
    const cutoffPrev = prevSince.toISOString().split('T')[0];
    let anyPrevData = false;
    for (const { day, cnt } of dailyInsights) {
      const n = Number(cnt);
      if (day >= cutoffCurrent) {
        insightsCurrent7d += n;
      } else if (day >= cutoffPrev) {
        insightsPrev7d = (insightsPrev7d ?? 0) + n;
        anyPrevData = true;
      }
    }
    if (!anyPrevData) insightsPrev7d = null;
  }

  const activePagesCount = pageIds.length;
  const responseRate =
    activePagesCount > 0
      ? Math.round((totalSignups / activePagesCount) * 10) / 10
      : 0;

  // Suppress the unused 7d-current locals when the consumer only
  // reads `value` + `previous`. We track current7d separately from
  // the lifetime/30d `value` because the delta math compares
  // current-window vs prior-window, while the prominent number on
  // the widget stays as the founder's headline metric (lifetime
  // signups, 30d posts, all-time research).
  void signupsCurrent7d;
  void postsCurrent7d;
  void insightsCurrent7d;

  return {
    totalSignups: {
      value: totalSignups,
      sparkline: signupsSparkline,
      previous: signupsPrev7d,
      period: '7d',
    },
    postsPublished: {
      value: Number(postsPublishedRes[0]?.count ?? 0),
      sparkline: postsSparkline,
      previous: postsPrev7d,
      period: '7d',
    },
    researchInsights: {
      value: Number(insightsRes[0]?.count ?? 0),
      sparkline: insightsSparkline,
      previous: insightsPrev7d,
      period: '7d',
    },
    validateResponseRate: {
      value: responseRate,
      total: totalSignups,
      activePages: activePagesCount,
    },
  };
}
