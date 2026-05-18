// PR Sprint D-8 Phase 2 — Photo Studio session collection endpoint.
//
// POST /api/photo-agent/sessions
//   Body: { projectId, prompt, painPointId? }
//   Creates a new session row, snapshots the brand bible, fetches
//   the pain point (if any), generates the agent's first message,
//   and returns the hydrated session. The session starts in
//   state='awaiting_type_choice' so the chat input is enabled the
//   moment the founder sees the page.
//
// GET /api/photo-agent/sessions?projectId=…
//   Lists the project's sessions, newest first.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  users,
  photoAgentSessions,
  researchInsights,
  type PhotoAgentSessionRow,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';
import {
  buildFirstMessage,
  refineConcept,
} from '@/lib/photo-agent/conceptBuilder';
import { inferAssetTypeFromText } from '@/lib/photo-agent/intentClassifier';
import * as Sentry from '@sentry/nextjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  kind: 'text' | 'system' | 'visual' | 'platforms' | 'copies';
  createdAt: number;
}

interface PainPointShape {
  id?: string;
  theme?: string;
  sampleQuote?: string;
  actionableAngle?: string;
}

function serialize(row: PhotoAgentSessionRow) {
  // PR Sprint UGC+Photo paridad — mirror the [id] route shape
  // so the create POST response matches the polling GET. Pre-
  // fix the create endpoint omitted approval-gate fields and
  // the client read undefined on its first round-trip.
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    painPointId: row.painPointId,
    state: row.state,
    approvalGateActive: row.approvalGateActive === true,
    approvalGateAt: row.approvalGateAt?.toISOString() ?? null,
    assetType: row.assetType,
    uploadedAssetUrl: row.uploadedAssetUrl,
    concept: row.concept,
    visualUrl: row.visualUrl,
    visualWidth: row.visualWidth,
    visualHeight: row.visualHeight,
    platforms: row.platforms ?? [],
    copies: row.copies ?? [],
    messages: row.messages ?? [],
    contentAssetId: row.contentAssetId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// Look up a pain point by id across the user's research_insights.
// Same scan-the-jsonb pattern as /api/research/pain-points/[id]
// but kept inline here to avoid a self-fetch round-trip.
async function findPainPoint(
  userId: string,
  painPointId: string,
): Promise<{ theme: string; sampleQuote: string; actionableAngle: string } | null> {
  const rows = await db
    .select({
      painPoints: researchInsights.painPoints,
    })
    .from(researchInsights)
    .innerJoin(projects, eq(projects.id, researchInsights.projectId))
    .where(eq(projects.userId, userId))
    .limit(200);
  for (const row of rows) {
    const arr = Array.isArray(row.painPoints)
      ? (row.painPoints as PainPointShape[])
      : [];
    const hit = arr.find((p) => p?.id === painPointId);
    if (hit) {
      return {
        theme: hit.theme ?? '',
        sampleQuote: hit.sampleQuote ?? '',
        actionableAngle: hit.actionableAngle ?? '',
      };
    }
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 20 new sessions / hour / user — same shape as other Studio
  // rate limits. Generous enough for an iteration-heavy day,
  // tight enough to catch a runaway script.
  const limit = checkRateLimit(`photo-agent:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: {
    projectId?: string;
    prompt?: string;
    painPointId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const projectId = body.projectId;
  const prompt = (body.prompt ?? '').trim();
  const painPointId = body.painPointId ?? null;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 },
    );
  }
  if (prompt.length === 0 && !painPointId) {
    return NextResponse.json(
      { error: 'Either prompt or painPointId is required' },
      { status: 400 },
    );
  }
  if (prompt.length > 10_000) {
    return NextResponse.json(
      { error: 'prompt must be ≤10,000 chars' },
      { status: 400 },
    );
  }

  // Ownership check + brand bible fetch.
  const [project] = await db
    .select({
      id: projects.id,
      brandContext: projects.brandContext,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  // First name for the greeting — pull from users.name (best-
  // effort; some accounts only have email).
  const [dbUser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // Pain-point fetch (optional).
  const painPoint = painPointId ? await findPainPoint(user.id, painPointId) : null;

  const bibleSnapshot = (project.brandContext as BrandBible | null) ?? null;
  const inferredAssetType = inferAssetTypeFromText(prompt);

  // PR Sprint UGC+Photo polish — fast path: if the founder's
  // initial prompt already implies a format (e.g. "carousel
  // about productivity"), skip the picker entirely. Run
  // refineConcept directly; if it produces a render-ready
  // concept, land the session in reviewing_concept with the
  // gate engaged. Founder goes straight from prompt → concept
  // review without an extra "pick a type" round-trip.
  //
  // Conditions:
  //   - prompt is non-empty AND ≥15 chars (must be meaty enough
  //     for the refiner to have something to work with)
  //   - inferAssetTypeFromText returns a non-null type
  //   - refineConcept comes back ready=true
  // Any miss → fall back to the existing buildFirstMessage flow.
  const promptLooksSpecific =
    prompt.length >= 15 && inferredAssetType !== null;

  if (promptLooksSpecific && inferredAssetType) {
    const userMsg: ChatMessage = {
      role: 'user',
      content: prompt,
      kind: 'text',
      createdAt: Date.now(),
    };
    const refined = await refineConcept({
      brandBible: bibleSnapshot,
      messages: [userMsg],
      currentConcept: null,
      assetType: inferredAssetType,
    });
    if (refined.ready && refined.concept) {
      const agentMsg: ChatMessage = {
        role: 'agent',
        content: refined.chatReply,
        kind: 'text',
        createdAt: Date.now() + 1,
      };
      Sentry.captureMessage('photo_agent_gate_engaged', {
        level: 'info',
        tags: { area: 'photo-studio', kind: 'approval-gate' },
        extra: {
          assetType: inferredAssetType,
          conceptSnippet: refined.concept.slice(0, 200),
          msgCreatedAtMs: Date.now(),
          fastPath: true,
        },
      });
      const [row] = await db
        .insert(photoAgentSessions)
        .values({
          userId: user.id,
          projectId,
          prompt,
          painPointId,
          brandSnapshot: bibleSnapshot,
          // PR Sprint UGC+Photo polish — direct to review.
          state: 'reviewing_concept',
          assetType: inferredAssetType,
          concept: refined.concept.slice(0, 280),
          messages: [userMsg, agentMsg],
          approvalGateActive: true,
          approvalGateAt: new Date(),
        })
        .returning();
      return NextResponse.json({ session: serialize(row) });
    }
    // Refiner couldn't ship a concept — fall through to the
    // existing buildFirstMessage flow so the founder gets the
    // conversational clarifier.
  }

  // Compose the agent's first message based on whichever context
  // we have. Falls back to a no-context greeting if neither
  // prompt nor painPoint produced anything usable.
  const firstMessage = await buildFirstMessage({
    founderFirstName: dbUser?.name ?? null,
    brandBible: bibleSnapshot,
    rawPrompt: prompt,
    painPoint,
  });

  const initialMessages: ChatMessage[] = [
    ...(prompt.length > 0
      ? [
          {
            role: 'user' as const,
            content: prompt,
            kind: 'text' as const,
            createdAt: Date.now(),
          },
        ]
      : []),
    {
      role: 'agent' as const,
      content: firstMessage,
      kind: 'text' as const,
      createdAt: Date.now() + 1,
    },
  ];

  const [row] = await db
    .insert(photoAgentSessions)
    .values({
      userId: user.id,
      projectId,
      prompt: prompt.length > 0 ? prompt : painPoint?.theme ?? '(no prompt)',
      painPointId,
      brandSnapshot: bibleSnapshot,
      // assetType might already be inferred (e.g. founder said
      // "carousel" but the prompt was too short to refine). We
      // persist the hint so the next turn's refiner picks it up.
      assetType: inferredAssetType,
      // Skip 'understanding' — buildFirstMessage already ran and
      // we have the agent's reply ready. Land directly on
      // awaiting_type_choice so the input is enabled.
      state: 'awaiting_type_choice',
      messages: initialMessages,
    })
    .returning();

  return NextResponse.json({ session: serialize(row) });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 },
    );
  }
  // Ownership defense — drop straight to 403 if the project
  // doesn't belong to the user instead of leaking an empty list.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }
  const rows = await db
    .select()
    .from(photoAgentSessions)
    .where(
      and(
        eq(photoAgentSessions.userId, user.id),
        eq(photoAgentSessions.projectId, projectId),
      ),
    )
    .orderBy(desc(photoAgentSessions.createdAt))
    .limit(50);
  return NextResponse.json({ sessions: rows.map(serialize) });
}
