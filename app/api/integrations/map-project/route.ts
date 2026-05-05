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
    supabaseTables,
    metaAdAccountId,
  } = body as {
    projectId?: string;
    vercelProjectId?: string | null;
    vercelTeamId?: string | null;
    supabaseProjectRef?: string | null;
    supabaseTables?: Array<{ tableName: string; metricLabel: string }>;
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
  const update: Record<string, unknown> = {};
  if (vercelProjectId !== undefined) update.vercelProjectId = vercelProjectId || null;
  if (vercelTeamId !== undefined) update.vercelTeamId = vercelTeamId || null;
  if (supabaseProjectRef !== undefined) update.supabaseProjectRef = supabaseProjectRef || null;
  if (metaAdAccountId !== undefined) update.metaAdAccountId = metaAdAccountId || null;

  // PR #19: validate the supabase_tables list before persisting. Each
  // entry must have a tableName matching a safe identifier so the sync
  // step doesn't have to re-validate at SQL-build time.
  const TABLE_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*|auth\.users)$/;
  if (supabaseTables !== undefined) {
    if (!Array.isArray(supabaseTables)) {
      return NextResponse.json(
        { error: 'supabaseTables must be an array' },
        { status: 400 }
      );
    }
    const sanitized = supabaseTables
      .filter(
        (t): t is { tableName: string; metricLabel: string } =>
          !!t &&
          typeof t === 'object' &&
          typeof t.tableName === 'string' &&
          typeof t.metricLabel === 'string'
      )
      .filter((t) => TABLE_NAME_RE.test(t.tableName))
      .slice(0, 10);
    update.supabaseTables = sanitized;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true, noop: true });
  }

  await db.update(projects).set(update).where(eq(projects.id, projectId));

  return NextResponse.json({ success: true });
}
