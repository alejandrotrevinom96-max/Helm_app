// PR Sprint 7.19 — post a user message into a chat conversation.
//
// POST /api/chat/message
// Body: { conversationId: string, content: string }
// Returns: { userMessage, assistantMessage? }
//
// Routing rules:
//   - mode === 'ai'    → persist user message, call Claude Haiku,
//                        persist assistant reply, return both.
//   - mode === 'agent' → persist user message only and return an
//                        ack. The founder will reply from the
//                        admin inbox; Realtime delivers it back
//                        to the widget.
//
// Auth: the conversation's owner only. (Admins use
// /api/chat/admin/reply to post into a conversation they don't
// own.)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  chatConversations,
  chatMessages,
} from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { logger } from '@/lib/observability/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  conversationId: z.string(),
  content: z.string().trim().min(1).max(4000),
});

// System prompt for the AI-mode chat. Kept short — this is a
// support / nudge bot, not a content generator. The brand voice
// lives elsewhere (lib/ai/claude.ts buildBrandPrompt) and we
// don't want this assistant to drift into writing posts.
const CHAT_SYSTEM = `You are "Helm AI", the in-product assistant for Helm (trythelm.com).

Helm is a marketing assistant for founders: it helps them define a brand voice, generate social posts (Instagram, LinkedIn, X, Threads, Reddit), run research, and publish via integrations.

Your job here is to help the user inside the product:
- Answer "how do I do X" questions about Helm features.
- Help them think through positioning, audience, or content strategy.
- If the user wants to talk to a human, tell them they can switch the chat to "Agent" mode using the toggle at the top of the widget — the founder (Alejandro) will reply.

Style:
- Concise. 2-4 short paragraphs max. No walls of text.
- First person, calm, founder-to-founder tone.
- No emojis unless the user uses them first.
- If you don't know something Helm-specific, say so plainly and suggest switching to Agent mode.

Never invent features. If asked about something that doesn't exist in Helm yet, say it's not built and offer to log feedback.`;

// Limit the rolling history we feed Claude. Anthropic accepts
// much more, but the support chat doesn't need deep memory and
// this keeps tokens predictable.
const HISTORY_TURN_LIMIT = 20;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // Verify conversation + ownership.
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
  if (conversation.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (conversation.status !== 'active') {
    return NextResponse.json(
      { error: 'Conversation is closed' },
      { status: 409 },
    );
  }

  // Persist the user's message first so it survives even if
  // Claude errors below.
  const [userMessage] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      role: 'user',
      content: parsed.data.content,
    })
    .returning();

  // Touch the conversation so the inbox sorts it to the top.
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversation.id));

  // Agent mode: don't call Claude. The founder will reply from
  // the inbox; Realtime delivers the reply to the widget.
  if (conversation.mode === 'agent') {
    return NextResponse.json({
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString(),
      },
      assistantMessage: null,
      mode: 'agent' as const,
    });
  }

  // AI mode: build rolling history for context.
  const history = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(asc(chatMessages.createdAt));

  // Anthropic expects strict alternating user/assistant. Map
  // 'agent' → 'assistant' (when a human took over earlier the
  // model should treat those as prior assistant turns), and drop
  // the trailing user message duplicate if any.
  const recent = history.slice(-HISTORY_TURN_LIMIT);
  const messagesForClaude = recent.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));

  let assistantText = '';
  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 600,
      system: cachedSystem(CHAT_SYSTEM),
      messages: messagesForClaude,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    assistantText = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  } catch (e) {
    logger.error('chat/message', 'Claude inference failed', {
      userId: user.id,
      conversationId: conversation.id,
      historyTurns: recent.length,
      error: e,
    });
    // Fall back to a graceful message so the user isn't left
    // staring at a spinner. Their message is already saved.
    assistantText =
      "Sorry — I'm having trouble responding right now. You can switch to Agent mode at the top of the widget and Alejandro will get back to you.";
  }

  if (!assistantText) {
    assistantText =
      "Sorry — I couldn't generate a reply. Try rephrasing, or switch to Agent mode for a human reply.";
  }

  const [assistantMessage] = await db
    .insert(chatMessages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantText,
    })
    .returning();

  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversation.id));

  return NextResponse.json({
    userMessage: {
      id: userMessage.id,
      role: userMessage.role,
      content: userMessage.content,
      createdAt: userMessage.createdAt.toISOString(),
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt.toISOString(),
    },
    mode: 'ai' as const,
  });
}
