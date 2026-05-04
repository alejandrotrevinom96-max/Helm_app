import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassReadings, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const HISTORY_LIMIT = 20;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const readings = await db
    .select({
      id: compassReadings.id,
      totalScore: compassReadings.totalScore,
      band: compassReadings.band,
      dataQuality: compassReadings.dataQuality,
      computedBy: compassReadings.computedBy,
      createdAt: compassReadings.createdAt,
    })
    .from(compassReadings)
    .where(eq(compassReadings.projectId, projectId))
    .orderBy(desc(compassReadings.createdAt))
    .limit(HISTORY_LIMIT);

  // The query returns newest-first; we serve oldest-first so the chart
  // can render left-to-right without reversing on the client.
  return NextResponse.json({ readings: readings.reverse() });
}
