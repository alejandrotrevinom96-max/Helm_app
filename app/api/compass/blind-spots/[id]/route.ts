// PR #70 — Sprint 7.1C: per-spot PATCH (status + notes).
//
// The founder can:
//   - acknowledge ("open" → "acknowledged"): "yes, valid call, I see it"
//   - dismiss   ("open" → "dismissed"):     "false positive, ignore"
//   - resolve   ("open"/"acknowledged" → "resolved"): "fixed"
//
// Notes are free-form and persist across re-scans (which DELETE +
// re-insert) only if the row id is the same — practically, notes
// are tied to the current scan generation. That's the right level
// of friction; a re-scan resets the audit trail.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassBlindSpots, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set([
  'open',
  'acknowledged',
  'dismissed',
  'resolved',
]);

export async function PATCH(
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

  let body: { userStatus?: unknown; userNotes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Ownership-join through projects.
  const [owned] = await db
    .select({ id: compassBlindSpots.id })
    .from(compassBlindSpots)
    .innerJoin(projects, eq(projects.id, compassBlindSpots.projectId))
    .where(
      and(eq(compassBlindSpots.id, id), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!owned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updates: {
    updatedAt: Date;
    userStatus?: string;
    userNotes?: string | null;
  } = {
    updatedAt: new Date(),
  };

  if (body.userStatus !== undefined) {
    if (
      typeof body.userStatus !== 'string' ||
      !VALID_STATUSES.has(body.userStatus)
    ) {
      return NextResponse.json(
        {
          error: `Invalid userStatus. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
        },
        { status: 400 },
      );
    }
    updates.userStatus = body.userStatus;
  }

  if (body.userNotes !== undefined) {
    if (body.userNotes === null) {
      updates.userNotes = null;
    } else if (typeof body.userNotes === 'string') {
      updates.userNotes = body.userNotes.slice(0, 2000);
    } else {
      return NextResponse.json(
        { error: 'userNotes must be a string or null' },
        { status: 400 },
      );
    }
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: 'No update fields provided' },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(compassBlindSpots)
    .set(updates)
    .where(eq(compassBlindSpots.id, id))
    .returning();

  return NextResponse.json({ success: true, blindSpot: updated });
}
