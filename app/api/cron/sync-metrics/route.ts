import { db } from '@/lib/db';
import { projects, integrations, metricSnapshots, scheduledPosts } from '@/lib/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { getVercelAnalytics } from '@/lib/integrations/vercel';
import { getAuthUsersCount } from '@/lib/integrations/supabase-mgmt';
import { getAdAccountInsights } from '@/lib/integrations/meta';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Verify cron secret
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
          await db
            .insert(metricSnapshots)
            .values({
              projectId: project.id,
              source: 'vercel',
              metric: 'visitors',
              value: String(data.totalVisitors),
              date: today,
            })
            .onConflictDoNothing();
          synced++;
        }
      } catch (err) {
        console.error('Vercel sync failed for project', project.id, err);
      }
    }

    // Supabase sync
    const supabase = userIntegrations.find((i) => i.provider === 'supabase');
    if (supabase && project.supabaseProjectRef) {
      try {
        const token = decrypt(supabase.encryptedAccessToken);
        const count = await getAuthUsersCount(token, project.supabaseProjectRef, 1);
        await db
          .insert(metricSnapshots)
          .values({
            projectId: project.id,
            source: 'supabase',
            metric: 'signups',
            value: String(count),
            date: today,
          })
          .onConflictDoNothing();
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
        await db.insert(metricSnapshots).values({
          projectId: project.id,
          source: 'meta',
          metric: 'spend',
          value: String(insights.totalSpend),
          date: today,
        });
        synced++;
      } catch (err) {
        console.error('Meta sync failed for project', project.id, err);
      }
    }
  }

  // Mark scheduled posts that are due so the user knows it's time to post.
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

  for (const post of due) {
    await db
      .update(scheduledPosts)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(eq(scheduledPosts.id, post.id));
  }

  return NextResponse.json({
    synced,
    projects: allProjects.length,
    notifiedPosts: due.length,
  });
}
