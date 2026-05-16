// PR Sprint D-2 — Studio session collection endpoint.
//
// POST /api/heygen/studio/sessions
//   Body: { projectId, prompt, styleId?, avatarId?, voiceId?,
//           orientation?, autoProceed? }
//   Creates a HeyGen V3 Video Agent session in chat mode +
//   stores the local row. Returns the new row's id (Helm's PK).
//
// GET /api/heygen/studio/sessions?projectId=...
//   Lists the project's sessions, newest first. For the Studio
//   sidebar.
//
// Why chat mode by default: founders want to review the
// storyboard before HeyGen burns a render. Set autoProceed=true
// to short-circuit straight to generation when they trust the
// agent.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  heygenAgentSessions,
  type HeygenAgentSessionRow,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';
import { createAgentSession } from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HeyGen V3 takes ~5s to return the session_id; cap the route at
// 30 so the client doesn't perceive a hang.
export const maxDuration = 30;

function serialize(row: HeygenAgentSessionRow) {
  return {
    id: row.id,
    heygenSessionId: row.heygenSessionId,
    status: row.status,
    prompt: row.prompt,
    title: row.title,
    styleId: row.styleId,
    avatarId: row.avatarId,
    voiceId: row.voiceId,
    orientation: row.orientation,
    messages: row.messages ?? [],
    lastResources: row.lastResources ?? [],
    finalVideoId: row.finalVideoId,
    finalVideoUrl: row.finalVideoUrl,
    finalVideoThumbnailUrl: row.finalVideoThumbnailUrl,
    finalVideoCaptionedUrl: row.finalVideoCaptionedUrl,
    finalVideoSubtitleUrl: row.finalVideoSubtitleUrl,
    finalVideoDurationSec: row.finalVideoDurationSec,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// ─── POST: create new session ────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isHeygenEnvConfigured()) {
    return NextResponse.json(
      { error: 'HeyGen is not configured for this deployment.' },
      { status: 503 },
    );
  }

  let body: {
    projectId?: string;
    prompt?: string;
    styleId?: string | null;
    avatarId?: string | null;
    voiceId?: string | null;
    orientation?: 'landscape' | 'portrait' | null;
    autoProceed?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const projectId = body.projectId;
  const prompt = (body.prompt ?? '').trim();
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 },
    );
  }
  if (prompt.length < 1 || prompt.length > 10_000) {
    return NextResponse.json(
      { error: 'prompt must be 1–10,000 chars' },
      { status: 400 },
    );
  }

  // Ownership check.
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

  // Hand off to HeyGen. Always chat mode unless the founder
  // explicitly opts in to one-shot via autoProceed=true.
  const result = await createAgentSession({
    prompt,
    mode: 'chat',
    styleId: body.styleId ?? null,
    avatarId: body.avatarId ?? null,
    voiceId: body.voiceId ?? null,
    orientation: body.orientation ?? undefined,
    autoProceed: Boolean(body.autoProceed),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 502 },
    );
  }

  const [row] = await db
    .insert(heygenAgentSessions)
    .values({
      userId: user.id,
      projectId,
      heygenSessionId: result.session.session_id,
      status: result.session.status,
      prompt,
      title: result.session.title ?? null,
      styleId: body.styleId ?? null,
      avatarId: body.avatarId ?? null,
      voiceId: body.voiceId ?? null,
      orientation: body.orientation ?? null,
      messages: (result.session.messages ?? []) as unknown[],
    })
    .returning();

  return NextResponse.json({ session: serialize(row) });
}

// ─── GET: list project sessions ──────────────────────────────

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
    .from(heygenAgentSessions)
    .where(
      and(
        eq(heygenAgentSessions.userId, user.id),
        eq(heygenAgentSessions.projectId, projectId),
      ),
    )
    .orderBy(desc(heygenAgentSessions.createdAt))
    .limit(50);
  return NextResponse.json({ sessions: rows.map(serialize) });
}
