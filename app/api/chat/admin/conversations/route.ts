// PR Sprint 7.19 — list all chat conversations for the admin inbox.
//
// GET /api/chat/admin/conversations
// Returns: { conversations: [{ id, userId, userEmail, userName,
//   projectId, projectName, mode, status, lastMessage, lastMessageAt,
//   updatedAt }] }
//
// Auth: admin allowlist only.
//
// Sort order: most recently updated first (latest activity floats
// to the top of the inbox).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  chatConversations,
  chatMessages,
  users,
  projects,
} from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { isAdmin } from '@/lib/config';

export async function GET() {
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

  // Subquery: pick the most recent message per conversation. We
  // use a correlated subquery via `sql` since Drizzle doesn't
  // have a clean DISTINCT ON helper. With chat volumes in the
  // hundreds (early stage) this is fine; if it ever climbs we'll
  // materialize a `last_message_at` column on chat_conversations.
  const lastMessageSql = sql<string | null>`(
    SELECT content
    FROM ${chatMessages}
    WHERE ${chatMessages.conversationId} = ${chatConversations.id}
    ORDER BY ${chatMessages.createdAt} DESC
    LIMIT 1
  )`;
  const lastMessageAtSql = sql<Date | null>`(
    SELECT ${chatMessages.createdAt}
    FROM ${chatMessages}
    WHERE ${chatMessages.conversationId} = ${chatConversations.id}
    ORDER BY ${chatMessages.createdAt} DESC
    LIMIT 1
  )`;

  const rows = await db
    .select({
      id: chatConversations.id,
      userId: chatConversations.userId,
      userEmail: users.email,
      userName: users.name,
      projectId: chatConversations.projectId,
      projectName: projects.name,
      mode: chatConversations.mode,
      status: chatConversations.status,
      updatedAt: chatConversations.updatedAt,
      lastMessage: lastMessageSql,
      lastMessageAt: lastMessageAtSql,
    })
    .from(chatConversations)
    .leftJoin(users, eq(users.id, chatConversations.userId))
    .leftJoin(projects, eq(projects.id, chatConversations.projectId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(200);

  return NextResponse.json({
    conversations: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail ?? null,
      userName: r.userName ?? null,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      mode: r.mode,
      status: r.status,
      updatedAt: r.updatedAt.toISOString(),
      lastMessage: r.lastMessage ?? null,
      lastMessageAt: r.lastMessageAt
        ? new Date(r.lastMessageAt).toISOString()
        : null,
    })),
  });
}
