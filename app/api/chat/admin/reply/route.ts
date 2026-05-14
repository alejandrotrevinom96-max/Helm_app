// PR Sprint 7.19 — admin posts a reply into a user's conversation.
//
// POST /api/chat/admin/reply
// Body: { conversationId: string, content: string }
// Returns: { message }
//
// Auth: caller email must be in the admin allowlist
// (lib/config.ts → ADMIN_EMAILS). The reply lands with
// role='agent' so the widget can distinguish founder replies
// from AI replies in the UI.
//
// Side effects:
//   - Inserts the agent message.
//   - Flips the conversation to mode='agent' if it was still in
//     'ai' mode. (A human reply implies the AI handoff
//     happened, even if the user didn't toggle.)
//   - Bumps updated_at so the inbox sorts the conversation to
//     the top.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  chatConversations,
  chatMessages,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/config';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  conversationId: z.string(),
  content: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  if (!UUID_RE.test(parsed.data.conversationId)) {
    return NextResponse.json(
      { error: 'Invalid conversationId' },
      { status: 400 },
    );
  }

  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, parsed.data.conversationId))
    .limit(1);
  if (!conversation) {
    return NextResponse.json(
      { error: 'Conversation not found' },
      { status: 404 },
    );
  }
  if (conversation.status !== 'active') {
    return NextResponse.json(
      { error: 'Conversation is closed' },
      { status: 409 },
    );
  }

  const [message] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      role: 'agent',
      content: parsed.data.content,
    })
    .returning();

  // Auto-flip to agent mode on first human reply. If the founder
  // wants to hand it back to AI, they toggle the mode from the
  // inbox header.
  const newMode = conversation.mode === 'ai' ? 'agent' : conversation.mode;
  await db
    .update(chatConversations)
    .set({ mode: newMode, updatedAt: new Date() })
    .where(eq(chatConversations.id, conversation.id));

  return NextResponse.json({
    message: {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    },
    mode: newMode,
  });
}
