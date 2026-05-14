// PR Sprint 7.19 — get-or-create the user's active chat conversation.
//
// POST /api/chat/conversation
// Body: { projectId?: string | null }
// Returns: { conversationId, mode, status, messages }
//
// Per Helm's model, there's at most ONE active conversation per
// (user, project) at a time. The widget calls this on mount —
// if a conversation already exists, we return it + its full
// history. Otherwise we create a fresh one in 'ai' mode.
//
// Auth: any logged-in user. projectId is optional — onboarding-
// stage founders without a project still get a conversation
// (scoped to project_id=NULL).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  chatConversations,
  chatMessages,
  projects,
} from '@/lib/db/schema';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: unknown };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  // Validate + verify ownership when projectId provided.
  let projectId: string | null = null;
  if (typeof body.projectId === 'string' && body.projectId.length > 0) {
    if (!UUID_RE.test(body.projectId)) {
      return NextResponse.json(
        { error: 'Invalid projectId' },
        { status: 400 },
      );
    }
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, body.projectId),
          eq(projects.userId, user.id),
        ),
      )
      .limit(1);
    if (!owned) {
      return NextResponse.json(
        { error: 'Project not found or forbidden' },
        { status: 403 },
      );
    }
    projectId = owned.id;
  }

  // Look up the active conversation for this (user, project).
  // The (user_id, project_id is null) case uses a separate
  // branch because Drizzle's `eq` against null doesn't match SQL
  // semantics (NULL != NULL).
  const activeFilter = projectId
    ? and(
        eq(chatConversations.userId, user.id),
        eq(chatConversations.projectId, projectId),
        eq(chatConversations.status, 'active'),
      )
    : and(
        eq(chatConversations.userId, user.id),
        isNull(chatConversations.projectId),
        eq(chatConversations.status, 'active'),
      );

  const [existing] = await db
    .select()
    .from(chatConversations)
    .where(activeFilter)
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);

  let conversation = existing ?? null;
  if (!conversation) {
    const [created] = await db
      .insert(chatConversations)
      .values({
        userId: user.id,
        projectId,
        mode: 'ai',
        status: 'active',
      })
      .returning();
    conversation = created;
  }

  // Fetch the message history (ascending so the widget can
  // render top-to-bottom without sorting client-side).
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
