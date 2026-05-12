// PR #71 — Sprint 7.1E: per-decision PATCH (status / confidence /
// description) + DELETE.
//
// Status transitions are validated against the closed set:
// 'decided' | 'executing' | 'reversed' | 'evaluated'. The /evaluate
// sibling endpoint owns the transition to 'evaluated' because it
// also requires outcome + AI retrospective fields — we don't allow
// reaching 'evaluated' through this PATCH to keep that contract
// clean. Founders flip to 'executing' or 'reversed' here.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, compassDecisions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 'evaluated' is excluded here — only /evaluate can set it.
const PATCH_STATUSES = new Set(['decided', 'executing', 'reversed']);

async function assertOwnership(
  userId: string,
  decisionId: string,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select({ id: compassDecisions.id })
    .from(compassDecisions)
    .innerJoin(projects, eq(projects.id, compassDecisions.projectId))
    .where(
      and(eq(compassDecisions.id, decisionId), eq(projects.userId, userId)),
    )
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
    founderConfidence?: unknown;
    description?: unknown;
    title?: unknown;
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
    founderConfidence?: number;
    description?: string | null;
    title?: string;
  } = {
    updatedAt: new Date(),
  };

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !PATCH_STATUSES.has(body.status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${Array.from(PATCH_STATUSES).join(', ')}. Use /evaluate to mark a decision as evaluated.`,
        },
        { status: 400 },
      );
    }
    updates.status = body.status;
  }

  if (body.founderConfidence !== undefined) {
    const n = Number(body.founderConfidence);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: 'founderConfidence must be a number 0-100' },
        { status: 400 },
      );
    }
    updates.founderConfidence = Math.max(0, Math.min(100, Math.round(n)));
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      updates.description = null;
    } else if (typeof body.description === 'string') {
      updates.description = body.description.slice(0, 2000);
    } else {
      return NextResponse.json(
        { error: 'description must be a string or null' },
        { status: 400 },
      );
    }
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

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: 'No update fields provided' },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(compassDecisions)
    .set(updates)
    .where(eq(compassDecisions.id, id))
    .returning();

  return NextResponse.json({ success: true, decision: updated });
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

  await db.delete(compassDecisions).where(eq(compassDecisions.id, id));
  return NextResponse.json({ success: true });
}
