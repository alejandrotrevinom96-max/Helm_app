// PR #68 — Sprint 7.1B: per-item update endpoint.
//
// Two things the founder can change:
//   - userStatus: 'pending' | 'in_progress' | 'done' | 'dismissed'
//   - userOverrideQuadrant: manually re-bucket without re-running Opus
//
// Both optional in the body; we apply only what's provided. Ownership
// gate is the standard inner-join on projects.userId.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { priorityItems, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(['pending', 'in_progress', 'done', 'dismissed']);
const VALID_QUADRANTS = new Set(['do_now', 'scheduled', 'fillers', 'avoid']);

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

  let body: {
    userStatus?: unknown;
    userOverrideQuadrant?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Ownership-join.
  const [row] = await db
    .select({ id: priorityItems.id })
    .from(priorityItems)
    .innerJoin(projects, eq(projects.id, priorityItems.projectId))
    .where(and(eq(priorityItems.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updates: {
    updatedAt: Date;
    userStatus?: string;
    userOverrideQuadrant?: string | null;
  } = {
    updatedAt: new Date(),
  };

  if (body.userStatus !== undefined) {
    if (typeof body.userStatus !== 'string' || !VALID_STATUSES.has(body.userStatus)) {
      return NextResponse.json(
        { error: `Invalid userStatus. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}` },
        { status: 400 },
      );
    }
    updates.userStatus = body.userStatus;
  }

  // userOverrideQuadrant can be explicitly set OR cleared with null.
  if (body.userOverrideQuadrant !== undefined) {
    if (body.userOverrideQuadrant === null) {
      updates.userOverrideQuadrant = null;
    } else if (
      typeof body.userOverrideQuadrant !== 'string' ||
      !VALID_QUADRANTS.has(body.userOverrideQuadrant)
    ) {
      return NextResponse.json(
        {
          error: `Invalid userOverrideQuadrant. Must be one of: ${Array.from(VALID_QUADRANTS).join(', ')} or null`,
        },
        { status: 400 },
      );
    } else {
      updates.userOverrideQuadrant = body.userOverrideQuadrant;
    }
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: 'No update fields provided' },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(priorityItems)
    .set(updates)
    .where(eq(priorityItems.id, id))
    .returning({
      id: priorityItems.id,
      userStatus: priorityItems.userStatus,
      userOverrideQuadrant: priorityItems.userOverrideQuadrant,
    });

  return NextResponse.json({ success: true, item: updated });
}
