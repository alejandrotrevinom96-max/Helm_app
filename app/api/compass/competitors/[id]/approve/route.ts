// PR #67 — Sprint 7.1A: toggle competitor approval (founder
// promotes a suggested row to "yes, scrape this" or un-approves an
// auto-approved one they don't care about).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { competitors, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: { approved?: unknown };
  try {
    body = (await request.json()) as { approved?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const approved = Boolean(body.approved);

  // Ownership-join: the competitor must belong to a project the
  // founder owns.
  const [row] = await db
    .select({ id: competitors.id })
    .from(competitors)
    .innerJoin(projects, eq(projects.id, competitors.projectId))
    .where(and(eq(competitors.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [updated] = await db
    .update(competitors)
    .set({ approvedByUser: approved, updatedAt: new Date() })
    .where(eq(competitors.id, id))
    .returning({
      id: competitors.id,
      approvedByUser: competitors.approvedByUser,
    });

  return NextResponse.json({ success: true, competitor: updated });
}
