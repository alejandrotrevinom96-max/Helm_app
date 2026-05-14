// PR Sprint 7.19 — GET a single conversation's message history.
//
// GET /api/chat/conversation/[conversationId]
// Returns: { conversationId, mode, status, messages }
//
// Used by the widget's "refetch on focus" and by the admin
// inbox's right pane. Ownership rules:
//   - Regular users can read only their own conversations.
//   - Admins can read any conversation.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  chatConversations,
  chatMessages,
} from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/config';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
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

  // Ownership check — bypassed for admins so the inbox can
  // read any conversation.
  if (conversation.userId !== user.id && !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(asc(chatMessages.createdAt));

  return NextResponse.json({
    conversationId: conversation.id,
    userId: conversation.userId,
    projectId: conversation.projectId,
    mode: conversation.mode,
    status: conversation.status,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
