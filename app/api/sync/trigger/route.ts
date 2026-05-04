import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, integrations, metricSnapshots } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { getVercelAnalytics } from '@/lib/integrations/vercel';
import { getAuthUsersCount } from '@/lib/integrations/supabase-mgmt';
import { NextResponse } from 'next/server';

type SyncedItem = {
  project: string;
  source: string;
  visitors?: number;
  signups?: number;
};

// Manual on-demand counterpart of /api/cron/sync-metrics. The cron uses the
// CRON_SECRET bearer; this endpoint uses the logged-in user's session and
// only touches their own projects.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const projectId = body?.projectId as string | undefined;

  const userProjects =
    projectId && projectId !== 'all'
      ? await db
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      : await db.select().from(projects).where(eq(projects.userId, user.id));

  if (userProjects.length === 0) {
    return NextResponse.json({ error: 'No projects found' }, { status: 404 });
  }

  // Load this user's integrations once instead of per project.
  const userInts = await db
    .select()
    .from(integrations)
    .where(eq(integrations.userId, user.id));
  const intsByProvider = Object.fromEntries(
    userInts.map((i) => [i.provider, i])
  );

  const today = new Date().toISOString().split('T')[0];
  const synced: SyncedItem[] = [];
  const errors: string[] = [];

  for (const project of userProjects) {
    if (project.vercelProjectId && intsByProvider['vercel']) {
      try {
        const token = decrypt(intsByProvider['vercel'].encryptedAccessToken);
        const data = await getVercelAnalytics(
          token,
          project.vercelProjectId,
          project.vercelTeamId ?? undefined,
          30
        );
        if (data && data.totalVisitors !== undefined && data.totalVisitors !== null) {
          // Snapshot semantics: each (project, source, metric, date) tuple
          // holds ONE current value, not an append log. UPSERT replaces the
          // existing value so multiple syncs per day collapse correctly.
          // Pre-PR-15 this used onConflictDoNothing(), but the table had no
          // unique constraint so every sync inserted a new row, triple-
          // counting visitors/signups in /analytics aggregates.
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
          synced.push({
            project: project.name,
            source: 'vercel',
            visitors: data.totalVisitors,
          });
        } else {
          errors.push(
            `${project.name}/vercel: no analytics data (Web Analytics may need Pro plan)`
          );
        }
      } catch (e) {
        errors.push(
          `${project.name}/vercel: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    if (project.supabaseProjectRef && intsByProvider['supabase']) {
      try {
        const token = decrypt(intsByProvider['supabase'].encryptedAccessToken);
        const count = await getAuthUsersCount(token, project.supabaseProjectRef);
        await db
          .insert(metricSnapshots)
          .values({
            projectId: project.id,
            source: 'supabase',
            metric: 'signups',
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
        synced.push({
          project: project.name,
          source: 'supabase',
          signups: count,
        });
      } catch (e) {
        errors.push(
          `${project.name}/supabase: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  return NextResponse.json({ synced, errors });
}
