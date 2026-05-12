// PR #69 — Sprint 7.1D: per-task PATCH (status, reschedule, edit
// title/description) + DELETE (founder removes a task entirely).
//
// Ownership-join on projects.userId; status transitions validated
// against the closed set so a malformed body can't put a row into
// an invalid state.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassTasks, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(['pending', 'in_progress', 'done', 'skipped']);

async function assertOwnership(
  userId: string,
  taskId: string,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select({ id: compassTasks.id })
    .from(compassTasks)
    .innerJoin(projects, eq(projects.id, compassTasks.projectId))
    .where(and(eq(compassTasks.id, taskId), eq(projects.userId, userId)))
    .limit(1);
  return { ok: Boolean(row) };
}

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

  let body: {
    status?: unknown;
    scheduledFor?: unknown;
    title?: unknown;
    description?: unknown;
    generatedDraftId?: unknown;
    linkedScheduledPostId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const owned = await assertOwnership(user.id, id);
  if (!owned.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updates: {
    updatedAt: Date;
    status?: string;
    completedAt?: Date | null;
    scheduledFor?: Date;
    title?: string;
    description?: string;
    generatedDraftId?: string | null;
    linkedScheduledPostId?: string | null;
  } = {
    updatedAt: new Date(),
  };

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
        },
        { status: 400 },
      );
    }
    updates.status = body.status;
    // Stamp completedAt on transition to done; clear it if reopening.
    if (body.status === 'done') {
      updates.completedAt = new Date();
    } else {
      updates.completedAt = null;
    }
  }

  if (body.scheduledFor !== undefined) {
    if (typeof body.scheduledFor !== 'string') {
      return NextResponse.json(
        { error: 'scheduledFor must be an ISO string' },
        { status: 400 },
      );
    }
    const d = new Date(body.scheduledFor);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduledFor' },
        { status: 400 },
      );
    }
    updates.scheduledFor = d;
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json(
        { error: 'title must be a non-empty string' },
        { status: 400 },
      );
    }
    updates.title = body.title.trim().slice(0, 240);
  }

  if (body.description !== undefined) {
    updates.description =
      typeof body.description === 'string'
        ? body.description.slice(0, 1000)
        : '';
  }

  if (body.generatedDraftId !== undefined) {
    if (body.generatedDraftId === null) {
      updates.generatedDraftId = null;
    } else if (
      typeof body.generatedDraftId === 'string' &&
      UUID_RE.test(body.generatedDraftId)
    ) {
      updates.generatedDraftId = body.generatedDraftId;
    } else {
      return NextResponse.json(
        { error: 'Invalid generatedDraftId' },
        { status: 400 },
      );
    }
  }

  if (body.linkedScheduledPostId !== undefined) {
    if (body.linkedScheduledPostId === null) {
      updates.linkedScheduledPostId = null;
    } else if (
      typeof body.linkedScheduledPostId === 'string' &&
      UUID_RE.test(body.linkedScheduledPostId)
    ) {
      updates.linkedScheduledPostId = body.linkedScheduledPostId;
    } else {
      return NextResponse.json(
        { error: 'Invalid linkedScheduledPostId' },
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
    .update(compassTasks)
    .set(updates)
    .where(eq(compassTasks.id, id))
    .returning();

  return NextResponse.json({ success: true, task: updated });
}

export async function DELETE(
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
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const owned = await assertOwnership(user.id, id);
  if (!owned.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.delete(compassTasks).where(eq(compassTasks.id, id));
  return NextResponse.json({ success: true });
}
