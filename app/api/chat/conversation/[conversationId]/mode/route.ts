// PR Sprint 7.19 — switch a conversation between 'ai' and 'agent'
// modes.
//
// PATCH /api/chat/conversation/[conversationId]/mode
// Body: { mode: 'ai' | 'agent' }
// Returns: { conversationId, mode, status }
//
// Who can call this:
//   - The conversation's owner (lets the end-user request a
//     human via the widget's AI/Agent toggle).
//   - Admins (lets the founder take over a conversation from
//     the inbox, or hand it back to AI).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { chatConversations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/config';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  mode: z.enum(['ai', 'agent']),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json(
      { error: 'Invalid conversationId' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1);

  if (!conversation) {
    return NextResponse.json(
      { error: 'Conversation not found' },
      { status: 404 },
    );
  }

  // Ownership: owner or admin.
  if (conversation.userId !== user.id && !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [updated] = await db
    .update(chatConversations)
    .set({ mode: parsed.data.mode, updatedAt: new Date() })
    .where(eq(chatConversations.id, conversation.id))
    .returning();

  return NextResponse.json({
    conversationId: updated.id,
    mode: updated.mode,
    status: updated.status,
  });
}
