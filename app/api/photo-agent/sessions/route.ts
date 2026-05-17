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
import { buildFirstMessage } from '@/lib/photo-agent/conceptBuilder';

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
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    painPointId: row.painPointId,
    state: row.state,
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

  // Compose the agent's first message based on whichever context
  // we have. Falls back to a no-context greeting if neither
  // prompt nor painPoint produced anything usable.
  const bibleSnapshot = (project.brandContext as BrandBible | null) ?? null;
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
