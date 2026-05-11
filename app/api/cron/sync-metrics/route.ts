import { db } from '@/lib/db';
import {
  projects,
  integrations,
  metricSnapshots,
  scheduledPosts,
  researchConfig,
  users,
} from '@/lib/db/schema';
import { eq, and, lte, lt, isNull, or } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { getVercelAnalytics } from '@/lib/integrations/vercel';
import { getTableCount } from '@/lib/integrations/supabase-mgmt';
import { getAdAccountInsights } from '@/lib/integrations/meta';
import { generateWeeklyInsight } from '@/lib/research/generate-insight';
import { generateAndSendBrief } from '@/lib/research/brief';
import { cleanupExpiredCache } from '@/lib/research/cache';
import { sendWebhook } from '@/lib/webhooks/send';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // PR #39 Sprint 6.5: pre-PR-39 we compared the bearer header
  // against `Bearer ${process.env.CRON_SECRET}` directly. If the
  // env var was missing the comparison string was `Bearer
  // undefined`, and a request with that literal header would pass
  // — turning a config drift into a public endpoint. Refuse if
  // the secret is missing or empty before doing the comparison.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 }
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allProjects = await db.select().from(projects).where(eq(projects.isActive, true));
  const today = new Date().toISOString().split('T')[0];
  let synced = 0;

  for (const project of allProjects) {
    const userIntegrations = await db
      .select()
      .from(integrations)
      .where(eq(integrations.userId, project.userId));

    // Vercel sync
    const vercel = userIntegrations.find((i) => i.provider === 'vercel');
    if (vercel && project.vercelProjectId) {
      try {
        const token = decrypt(vercel.encryptedAccessToken);
        const data = await getVercelAnalytics(
          token,
          project.vercelProjectId,
          project.vercelTeamId ?? undefined,
          1
        );
        if (data?.totalVisitors !== undefined) {
          // Same upsert pattern as /api/sync/trigger — see PR #15 fix.
          await db
            .insert(metricSnapshots)
            .values({
              projectId: project.id,
              source: 'vercel',
              metric: 'visitors',
              value: String(data.totalVisitors),
              date: today,
            })
            .onConflictDoUpdate({
              target: [
                metricSnapshots.projectId,
                metricSnapshots.source,
                metricSnapshots.metric,
                metricSnapshots.date,
              ],
              set: {
                value: String(data.totalVisitors),
                syncedAt: new Date(),
              },
            });
          synced++;
        }
      } catch (err) {
        console.error('Vercel sync failed for project', project.id, err);
      }
    }

    // Supabase sync — PR #19: iterate per-project supabase_tables config.
    const supabase = userIntegrations.find((i) => i.provider === 'supabase');
    if (supabase && project.supabaseProjectRef) {
      try {
        const token = decrypt(supabase.encryptedAccessToken);
        const configured = project.supabaseTables as
          | Array<{ tableName: string; metricLabel: string }>
          | null;
        const tables =
          configured && configured.length > 0
            ? configured
            : [{ tableName: 'auth.users', metricLabel: 'Signups' }];

        for (const t of tables) {
          const count = await getTableCount(
            token,
            project.supabaseProjectRef,
            t.tableName
          );
          await db
            .insert(metricSnapshots)
            .values({
              projectId: project.id,
              source: 'supabase',
              metric: t.tableName,
              value: String(count),
              date: today,
            })
            .onConflictDoUpdate({
              target: [
                metricSnapshots.projectId,
                metricSnapshots.source,
                metricSnapshots.metric,
                metricSnapshots.date,
              ],
              set: {
                value: String(count),
                syncedAt: new Date(),
              },
            });
        }
        synced++;
      } catch (err) {
        console.error('Supabase sync failed for project', project.id, err);
      }
    }

    // Meta sync
    const meta = userIntegrations.find((i) => i.provider === 'meta');
    if (meta && project.metaAdAccountId) {
      try {
        const token = decrypt(meta.encryptedAccessToken);
        const insights = await getAdAccountInsights(token, project.metaAdAccountId, 1);
        await db
          .insert(metricSnapshots)
          .values({
            projectId: project.id,
            source: 'meta',
            metric: 'spend',
            value: String(insights.totalSpend),
            date: today,
          })
          .onConflictDoUpdate({
            target: [
              metricSnapshots.projectId,
              metricSnapshots.source,
              metricSnapshots.metric,
              metricSnapshots.date,
            ],
            set: {
              value: String(insights.totalSpend),
              syncedAt: new Date(),
            },
          });
        synced++;
      } catch (err) {
        console.error('Meta sync failed for project', project.id, err);
      }
    }
  }

  // Mark scheduled posts that are due so the user knows it's time to post.
  // If the user has a webhook configured, fire that too — fire-and-forget,
  // so a slow/dead receiver doesn't block notification of other due posts.
  // TODO: when Resend (or similar) is wired up, send an email here with the
  // ready-to-paste content instead of just flipping the status flag.
  const due = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, 'scheduled'),
        lte(scheduledPosts.scheduledFor, new Date())
      )
    );

  // Cache webhook config per user so multiple due posts from the same user
  // don't trigger redundant DB reads.
  const webhookCache = new Map<
    string,
    { url: string | null; secret: string | null }
  >();
  let webhooksDelivered = 0;
  let webhooksFailed = 0;

  for (const post of due) {
    let cfg = webhookCache.get(post.userId);
    if (!cfg) {
      const [row] = await db
        .select({ url: users.webhookUrl, secret: users.webhookSecret })
        .from(users)
        .where(eq(users.id, post.userId))
        .limit(1);
      cfg = { url: row?.url ?? null, secret: row?.secret ?? null };
      webhookCache.set(post.userId, cfg);
    }

    if (cfg.url) {
      const result = await sendWebhook(cfg.url, cfg.secret, {
        event: 'scheduled_post.due',
        timestamp: new Date().toISOString(),
        data: {
          id: post.id,
          platform: post.platform,
          content: post.content,
          scheduledFor: post.scheduledFor.toISOString(),
        },
      });
      if (result.ok) {
        webhooksDelivered++;
      } else {
        webhooksFailed++;
        console.error(
          `[CRON] webhook failed for user ${post.userId}:`,
          result.error ?? `HTTP ${result.status}`
        );
      }
    }

    await db
      .update(scheduledPosts)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(eq(scheduledPosts.id, post.id));
  }

  // Auto-regenerate weekly research insight for projects whose last insight
  // is older than 7 days (or has never run). Each call hits Claude Opus
  // sequentially so we don't blast the rate limit; the loop is bounded by
  // researchConfig rows, which is one-per-project.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000);
  const stale = await db
    .select()
    .from(researchConfig)
    .where(
      or(
        isNull(researchConfig.weeklyInsightAt),
        lt(researchConfig.weeklyInsightAt, sevenDaysAgo)
      )
    );

  // Cap how many insights we generate per cron run. Each Opus call costs
  // real money and the cron is daily, so leftovers process tomorrow rather
  // than blowing the budget on a backlog.
  const MAX_INSIGHTS_PER_RUN = 10;
  const toProcess = stale.slice(0, MAX_INSIGHTS_PER_RUN);

  let insightsGenerated = 0;
  for (const cfg of toProcess) {
    try {
      const result = await generateWeeklyInsight(cfg.projectId);
      if (result.ok) insightsGenerated++;
    } catch (e) {
      console.error('[CRON] insight failed for', cfg.projectId, e);
    }
  }

  if (stale.length > MAX_INSIGHTS_PER_RUN) {
    console.log(
      `[CRON] insight cap hit: processed ${MAX_INSIGHTS_PER_RUN}/${stale.length}; rest defer to next run`
    );
  }

  // PR #58 — Sprint 7.0.2: piggyback the Monday Weekly Brief on
  // this daily cron so we stay within the Vercel Hobby 2-cron cap.
  // Brief fires only when:
  //   - today is Monday (UTC)
  //   - the user has weekly_brief_enabled = true
  //   - the latest research_insight has briefSent = false
  // The generator itself enforces idempotence, so a same-day re-run
  // of the cron can't double-mail anyone.
  let briefsSent = 0;
  let briefsSkipped = 0;
  let briefsFailed = 0;
  const isMonday = new Date().getUTCDay() === 1;
  if (isMonday) {
    const optedIn = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.weeklyBriefEnabled, true));

    // Iterate one user → one (oldest) active project at a time. A
    // founder with multiple projects only gets one brief per Monday
    // — the active project's. Multi-brief support is a Sprint 7.1
    // problem; first we want signal that briefs are valuable at all.
    for (const u of optedIn) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.userId, u.id), eq(projects.isActive, true)))
        .limit(1);
      if (!project) {
        briefsSkipped++;
        continue;
      }
      try {
        const res = await generateAndSendBrief({
          userId: u.id,
          projectId: project.id,
        });
        if (res.success) briefsSent++;
        else if (res.skipped) briefsSkipped++;
        else {
          briefsFailed++;
          console.error(
            `[CRON] brief failed for user=${u.id} project=${project.id}:`,
            res.error,
          );
        }
      } catch (e) {
        briefsFailed++;
        console.error(
          `[CRON] brief crashed for user=${u.id} project=${project.id}:`,
          e,
        );
      }
    }
  }

  // PR #59 — Sprint 7.0.3: cache cleanup. research_cache rows hold
  // RSS payloads with a 24h TTL; without this sweep they'd
  // accumulate indefinitely. The cache helper's getCached already
  // ignores expired rows, but stale storage still wastes disk.
  const cacheCleaned = await cleanupExpiredCache();
  if (cacheCleaned > 0) {
    console.log(`[CRON] cleaned ${cacheCleaned} expired cache rows`);
  }

  return NextResponse.json({
    synced,
    projects: allProjects.length,
    notifiedPosts: due.length,
    webhooksDelivered,
    webhooksFailed,
    insightsGenerated,
    insightsDeferred: Math.max(0, stale.length - MAX_INSIGHTS_PER_RUN),
    weeklyBrief: {
      ran: isMonday,
      sent: briefsSent,
      skipped: briefsSkipped,
      failed: briefsFailed,
    },
    cacheCleaned,
  });
}
