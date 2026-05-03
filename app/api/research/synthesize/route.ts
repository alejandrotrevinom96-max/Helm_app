import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateWeeklyInsight } from '@/lib/research/generate-insight';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId } = await request.json();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Authorize first — generateWeeklyInsight assumes the caller already did this.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = await generateWeeklyInsight(projectId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, hint: result.hint },
      { status: result.error === 'Not enough findings yet' ? 400 : 500 }
    );
  }

  return NextResponse.json({ insight: result.insight });
}
