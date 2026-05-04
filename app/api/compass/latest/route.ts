import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassReadings, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { bandLabel } from '@/lib/compass/scoring';
import type { CompassBand } from '@/lib/types/compass';

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

  const [latest] = await db
    .select()
    .from(compassReadings)
    .where(eq(compassReadings.projectId, projectId))
    .orderBy(desc(compassReadings.createdAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json({ reading: null });
  }

  return NextResponse.json({
    reading: {
      ...latest,
      bandLabel: bandLabel(latest.band as CompassBand),
    },
  });
}
