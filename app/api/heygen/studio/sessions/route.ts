// PR Sprint D-2 — Studio session collection endpoint.
//
// POST /api/heygen/studio/sessions
//   Body: { projectId, prompt, styleId?, avatarId?, voiceId?,
//           orientation? }
//   Creates a HeyGen V3 Video Agent session in chat mode +
//   stores the local row. Returns the new row's id (Helm's PK).
//
// GET /api/heygen/studio/sessions?projectId=...
//   Lists the project's sessions, newest first. For the Studio
//   sidebar.
//
// Why chat mode by default: founders want to review the
// storyboard before HeyGen burns a render. Approval is now
// dispatched via the native /v3/video-agents/{id}/approve
// endpoint on the per-session POST handler — see the [id]
// route — so we don't need a create-time autoProceed flag.

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
  // PR Sprint D-bugs-2 (UGC fix v2) — match the [id] route's
  // serializer shape exactly: approval-gate fields + the server-
  // built viewInHeygenUrl, plus the gated status / videoUrl
  // overrides so a session that's freshly created with the gate
  // already set lands at the right UI state from message zero.
  //
  // Pre-fix this serializer omitted approvalGateActive entirely
  // and the create POST returned a session shape that didn't
  // match the polling GET. The UGC client read undefined and
  // never showed the approval flow.
  const gated = row.approvalGateActive === true;
  const surfacedStatus = gated ? 'reviewing' : row.status;
  return {
    id: row.id,
    heygenSessionId: row.heygenSessionId,
    viewInHeygenUrl: row.heygenSessionId
      ? `https://app.heygen.com/video-agent/${encodeURIComponent(
          row.heygenSessionId,
        )}`
      : null,
    status: surfacedStatus,
    approvalGateActive: gated,
    approvalGateAt: row.approvalGateAt?.toISOString() ?? null,
    prompt: row.prompt,
    title: row.title,
    styleId: row.styleId,
    avatarId: row.avatarId,
    voiceId: row.voiceId,
    orientation: row.orientation,
    messages: row.messages ?? [],
    lastResources: row.lastResources ?? [],
    finalVideoId: row.finalVideoId,
    finalVideoUrl: gated ? null : row.finalVideoUrl,
    finalVideoThumbnailUrl: gated ? null : row.finalVideoThumbnailUrl,
    finalVideoCaptionedUrl: gated ? null : row.finalVideoCaptionedUrl,
    finalVideoSubtitleUrl: gated ? null : row.finalVideoSubtitleUrl,
    finalVideoDurationSec: gated ? null : row.finalVideoDurationSec,
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

  // PR Sprint D-final — chat mode + native HeyGen draft/approve
  // flow. auto_proceed removed (HeyGen V3 doesn't accept it);
  // approval lives on /v3/video-agents/{id}/approve and is fired
  // from the per-session POST handler when the founder clicks
  // Approve & render.
  const result = await createAgentSession({
    prompt,
    mode: 'chat',
    styleId: body.styleId ?? null,
    avatarId: body.avatarId ?? null,
    voiceId: body.voiceId ?? null,
    orientation: body.orientation ?? undefined,
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
