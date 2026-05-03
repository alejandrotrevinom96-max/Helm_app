import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    projectId,
    vercelProjectId,
    vercelTeamId,
    supabaseProjectRef,
    metaAdAccountId,
  } = body as {
    projectId?: string;
    vercelProjectId?: string | null;
    vercelTeamId?: string | null;
    supabaseProjectRef?: string | null;
    metaAdAccountId?: string | null;
  };

  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Anti-tampering: only allow updating projects owned by the calling user.
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Build a partial update so callers can clear a mapping by sending null,
  // leave it untouched by omitting the key, or set a value by sending the value.
  const update: Record<string, string | null> = {};
  if (vercelProjectId !== undefined) update.vercelProjectId = vercelProjectId || null;
  if (vercelTeamId !== undefined) update.vercelTeamId = vercelTeamId || null;
  if (supabaseProjectRef !== undefined) update.supabaseProjectRef = supabaseProjectRef || null;
  if (metaAdAccountId !== undefined) update.metaAdAccountId = metaAdAccountId || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true, noop: true });
  }

  await db.update(projects).set(update).where(eq(projects.id, projectId));

  return NextResponse.json({ success: true });
}
