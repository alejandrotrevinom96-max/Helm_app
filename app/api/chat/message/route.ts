// PR Sprint 7.15 — native Helm AI chat endpoint.
//
// POST /api/chat/message
// Body: {
//   message: string,
//   projectId?: string | null,
//   history: { role: 'user' | 'assistant', content: string }[],
// }
//
// Architecture
// ------------
//   - Haiku 4.5, not Opus. This is a casual chat assistant, not
//     content generation — the cost / latency profile of Opus
//     would be wrong (we want fast, cheap, conversational).
//   - Rate-limited 20 messages / hour / user so a runaway loop
//     can't burn through budget (cap ~$0.10 / hour worst-case
//     at Haiku rates).
//   - System prompt is short by design: Helm context + concision
//     directive. The page chrome around the widget is the visual
//     branding; the prompt doesn't need to repeat it.
//   - History is sent verbatim from the client. The widget keeps
//     it in useState for the active session — DB is the
//     persistent ledger but not the read source for the next
//     call, so the same conversation can continue without
//     waiting on a SELECT.
//   - We persist BOTH the user message and the assistant reply
//     to chat_messages so analytics / support / future "resume
//     last conversation" features have the data ready.
//
// Auth: any logged-in Helm user. Project ownership is OPTIONAL
// — when projectId is provided we verify the user owns it
// (so a malicious client can't tag messages onto someone else's
// project). When null, we accept it (mid-onboarding case).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { chatMessages, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { anthropic, MODELS } from '@/lib/ai/claude';
import { checkRateLimit } from '@/lib/rate-limit';
import { trackUsage } from '@/lib/ai/usage-tracker';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_HISTORY_MESSAGES = 20; // hard cap on tokens we send up
const MAX_MESSAGE_CHARS = 4000;

const SYSTEM_PROMPT = `You are Helm's built-in assistant. Helm is a marketing OS for founders and small teams. You help users think through their marketing strategy, content ideas, and how to get the most out of Helm. Be concise, direct, and founder-friendly. Never be corporate. Max 3 sentences per response unless the user explicitly asks for more detail.`;

export const maxDuration = 30;

type Role = 'user' | 'assistant';
interface HistoryItem {
  role: Role;
  content: string;
}

function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const role = obj.role;
    const content = obj.content;
    if (
      (role === 'user' || role === 'assistant') &&
      typeof content === 'string' &&
      content.length > 0
    ) {
      out.push({
        role,
        // Cap each message so a hostile client can't inflate the
        // prompt; the Anthropic API will still error on truly
        // pathological inputs but this softens the worst case.
        content: content.slice(0, MAX_MESSAGE_CHARS),
      });
    }
  }
  // Keep only the tail — recent context matters more than ancient
  // context, and the rate-limited 20/hr is a per-call cap not a
  // per-turn cap.
  return out.slice(-MAX_HISTORY_MESSAGES);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 20 messages / hour / user. Haiku at $0.80/M input
  // + $4/M output keeps the worst case under ~$0.20/hour even at
  // the max. Plenty of headroom for casual chat without inviting
  // a loop bug to drain the budget.
  const limit = checkRateLimit(
    `chat-message:${user.id}`,
    20,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Chat caps at 20 messages / hour. Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: {
    message?: unknown;
    projectId?: unknown;
    history?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    typeof body.message !== 'string' ||
    body.message.trim().length === 0
  ) {
    return NextResponse.json(
      { error: 'message required' },
      { status: 400 },
    );
  }
  const message = body.message.slice(0, MAX_MESSAGE_CHARS).trim();

  // projectId is optional. When present, verify ownership before
  // tagging messages onto a project the founder doesn't own.
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

  const history = sanitizeHistory(body.history);
  const messages: HistoryItem[] = [
    ...history,
    { role: 'user' as const, content: message },
  ];

  // Call Haiku. Keep the system prompt short + uncached — at
  // ~80 tokens it doesn't reach Anthropic's 1024-token minimum
  // cacheable prefix anyway.
  let reply: string;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    reply =
      textBlock?.type === 'text'
        ? textBlock.text.trim()
        : "Sorry, I couldn't generate a reply. Try rephrasing?";

    // Best-effort usage telemetry; matches the pattern other
    // endpoints in this codebase use.
    void trackUsage({
      endpoint: 'chat-message',
      model: MODELS.HAIKU,
      usage: response.usage,
      userId: user.id,
      projectId: projectId ?? undefined,
    }).catch(() => {
      /* non-fatal */
    });
  } catch (err) {
    console.error(
      '[chat/message] anthropic call failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Chat service temporarily unavailable',
      },
      { status: 502 },
    );
  }

  // Persist both messages. Best-effort — if the insert fails the
  // founder still gets the reply, we just lose the ledger row.
  try {
    await db.insert(chatMessages).values([
      {
        userId: user.id,
        projectId,
        role: 'user',
        content: message,
      },
      {
        userId: user.id,
        projectId,
        role: 'assistant',
        content: reply,
      },
    ]);
  } catch (persistErr) {
    console.warn(
      '[chat/message] persist failed (non-fatal):',
      persistErr instanceof Error ? persistErr.message : persistErr,
    );
  }

  return NextResponse.json({ reply });
}
