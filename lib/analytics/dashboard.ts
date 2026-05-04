import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  scheduledPosts,
  waitlistResponses,
  waitlistPages,
  researchFindings,
} from '@/lib/db/schema';
import { eq, and, gte, sql, count, inArray } from 'drizzle-orm';

interface KPI {
  value: number;
  sparkline: number[];
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

// Aggregated KPIs across every project the user owns. Used both by the
// /analytics page (server-rendered) and the /api/analytics/dashboard route
// (for any client-side polling/refresh in the future).
export async function getDashboardData(): Promise<
  DashboardData | { error: string; status: number }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized', status: 401 };

  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, user.id));
  const projectIds = userProjects.map((p) => p.id);

  const empty: DashboardData = {
    totalSignups: { value: 0, sparkline: [] },
    postsPublished: { value: 0, sparkline: [] },
    researchInsights: { value: 0, sparkline: [] },
    validateResponseRate: { value: 0, total: 0, activePages: 0 },
  };

  if (projectIds.length === 0) return empty;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  // 1. Total signups + 14-day sparkline
  const userPages = await db
    .select({ id: waitlistPages.id })
    .from(waitlistPages)
    .where(inArray(waitlistPages.projectId, projectIds));
  const pageIds = userPages.map((p) => p.id);

  let totalSignups = 0;
  let signupsSparkline: number[] = [];

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

  const activePagesCount = pageIds.length;
  const responseRate =
    activePagesCount > 0
      ? Math.round((totalSignups / activePagesCount) * 10) / 10
      : 0;

  return {
    totalSignups: { value: totalSignups, sparkline: signupsSparkline },
    postsPublished: {
      value: Number(postsPublishedRes[0]?.count ?? 0),
      sparkline: postsSparkline,
    },
    researchInsights: {
      value: Number(insightsRes[0]?.count ?? 0),
      sparkline: insightsSparkline,
    },
    validateResponseRate: {
      value: responseRate,
      total: totalSignups,
      activePages: activePagesCount,
    },
  };
}
