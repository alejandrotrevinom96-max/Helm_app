// PR Sprint D-2 — stop an in-progress Studio session.
//
// POST /api/heygen/studio/sessions/[id]/stop
//   Halts the agent at its next checkpoint. Partial results are
//   preserved on HeyGen's side; the founder can revisit the
//   session in the Studio sidebar to read the chat history.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenAgentSessions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { stopAgentSession } from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
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
  const [row] = await db
    .select()
    .from(heygenAgentSessions)
    .where(
      and(
        eq(heygenAgentSessions.id, id),
        eq(heygenAgentSessions.userId, user.id),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const r = await stopAgentSession(row.heygenSessionId);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 502 });
  }
  // Flip the local row to a terminal state so the poll loop
  // stops hammering. The chat history is preserved.
  await db
    .update(heygenAgentSessions)
    .set({
      status: 'failed',
      errorMessage: 'Stopped by user',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(heygenAgentSessions.id, row.id));
  return NextResponse.json({ success: true });
}
