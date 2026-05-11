// PR #60 — Sprint 7.0.4: per-project content type preferences.
//
// GET returns every (platform, enabledTypes) row for the project.
// POST upserts the enabledTypes for a single platform.
//
// Strict isolation: ownership-join on projects.userId. 403 (not 404)
// for foreign projectId so we don't leak which IDs exist — same
// pattern as PR #57's research/insights endpoint.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, userContentPreferences } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertOwnership(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function GET(
  _request: Request,
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
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!(await assertOwnership(user.id, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db
    .select({
      platform: userContentPreferences.platform,
      enabledTypes: userContentPreferences.enabledTypes,
      updatedAt: userContentPreferences.updatedAt,
    })
    .from(userContentPreferences)
    .where(eq(userContentPreferences.projectId, id));

  return NextResponse.json({ preferences: rows });
}

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
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!(await assertOwnership(user.id, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { platform?: string; enabledTypes?: unknown };
  try {
    body = (await request.json()) as {
      platform?: string;
      enabledTypes?: unknown;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const platform = typeof body.platform === 'string' ? body.platform : '';
  if (!platform) {
    return NextResponse.json(
      { error: 'platform required' },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.enabledTypes)) {
    return NextResponse.json(
      { error: 'enabledTypes must be an array' },
      { status: 400 },
    );
  }
  const enabledTypes = body.enabledTypes.filter(
    (t): t is string => typeof t === 'string',
  );

  await db
    .insert(userContentPreferences)
    .values({
      projectId: id,
      userId: user.id,
      platform,
      enabledTypes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        userContentPreferences.projectId,
        userContentPreferences.platform,
      ],
      set: {
        enabledTypes,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true, platform, enabledTypes });
}
