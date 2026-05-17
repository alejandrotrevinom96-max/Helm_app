// PR Sprint D-2 — single Studio session endpoint.
//
// GET  /api/heygen/studio/sessions/[id]
//   Polls HeyGen for the latest status, persists the snapshot
//   locally, and returns the merged view. The Studio UI hits
//   this every 5s while status is 'thinking' / 'reviewing' /
//   'generating'.
//
//   When status flips to 'generating' AND a video_id is
//   assigned, we ALSO poll /v3/videos/{video_id} so we can
//   surface the final_video_url + captioned_video_url +
//   subtitle_url on the same response.
//
// POST /api/heygen/studio/sessions/[id]
//   Body: { message, autoProceed? }
//   Sends a follow-up message to HeyGen ("add a scene about
//   pricing", "approve and render", etc.). Then polls once so
//   the agent's response shows up on the same round-trip.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  heygenAgentSessions,
  type HeygenAgentSessionRow,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  getAgentSession,
  sendAgentMessage,
  getFinalVideo,
  type SessionStatus,
} from '@/lib/heygen/v3-client';
import * as Sentry from '@sentry/nextjs';

// PR Sprint D-7 — message-shape guard for the unapproved-render
// telemetry below. HeyGen's messages array is loose-typed (`unknown[]`
// on the row), so we narrow before we touch it.
interface AgentMessageShape {
  role?: string;
}
function isAgentMessageArray(v: unknown): v is AgentMessageShape[] {
  return Array.isArray(v);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function loadOwned(
  userId: string,
  rowId: string,
): Promise<HeygenAgentSessionRow | null> {
  const [row] = await db
    .select()
    .from(heygenAgentSessions)
    .where(
      and(
        eq(heygenAgentSessions.id, rowId),
        eq(heygenAgentSessions.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Pull the latest HeyGen state + persist it locally. Used by
// both GET (poll) and POST (after sending a message). Returns
// the refreshed local row.
async function refreshSession(
  row: HeygenAgentSessionRow,
): Promise<HeygenAgentSessionRow> {
  const sess = await getAgentSession(row.heygenSessionId);
  if (!sess.ok) {
    // Soft failure — keep the existing row, mark error_message
    // so the UI can surface "agent unreachable".
    await db
      .update(heygenAgentSessions)
      .set({
        errorMessage: sess.error.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(heygenAgentSessions.id, row.id));
    return { ...row, errorMessage: sess.error.slice(0, 500) };
  }

  const fresh = sess.session;
  const updates: Partial<HeygenAgentSessionRow> = {
    status: fresh.status,
    title: fresh.title ?? row.title,
    messages: (fresh.messages ?? []) as unknown[],
    updatedAt: new Date(),
    errorMessage: null,
  };

  // Capture the video_id once HeyGen assigns it.
  if (fresh.video_id && !row.finalVideoId) {
    updates.finalVideoId = fresh.video_id;
  }

  // Once we have a video_id AND the session has advanced to
  // generating / completed, ALSO poll the final video so the
  // founder gets video_url + captioned_video_url + subtitle_url
  // without a second client round-trip.
  const videoIdToPoll = fresh.video_id ?? row.finalVideoId;
  if (
    videoIdToPoll &&
    (fresh.status === 'generating' || fresh.status === 'completed')
  ) {
    const vid = await getFinalVideo(videoIdToPoll);
    if (vid.ok) {
      updates.finalVideoUrl = vid.video.video_url ?? null;
      updates.finalVideoThumbnailUrl = vid.video.thumbnail_url ?? null;
      updates.finalVideoCaptionedUrl =
        vid.video.captioned_video_url ?? null;
      updates.finalVideoSubtitleUrl = vid.video.subtitle_url ?? null;
      if (vid.video.duration != null) {
        updates.finalVideoDurationSec = vid.video.duration.toFixed(2);
      }
      if (vid.video.status === 'failed') {
        updates.status = 'failed' as SessionStatus;
        updates.errorMessage =
          vid.video.failure_message ?? vid.video.failure_code ?? null;
      }
    }
  }

  if (
    (updates.status === 'completed' || updates.status === 'failed') &&
    !row.completedAt
  ) {
    updates.completedAt = new Date();
  }

  // PR Sprint D-7 — unapproved-render telemetry.
  //
  // Fire ONCE when a session first transitions into 'generating'
  // (HeyGen has started the render). Check if the user ever sent
  // a follow-up message — if not, the agent auto-proceeded after
  // its own "Ready to bring this to life?" prompt without our
  // approval. This is the bug we're trying to stamp out; logging
  // it lets us measure how often it still leaks through after
  // the auto_proceed=false explicit contract lands.
  //
  // Gated on row.status (previous local state) so we don't re-fire
  // on every poll once the session is already generating.
  if (
    updates.status === 'generating' &&
    row.status !== 'generating' &&
    row.status !== 'completed' &&
    row.status !== 'failed'
  ) {
    const messages = isAgentMessageArray(updates.messages)
      ? updates.messages
      : isAgentMessageArray(row.messages)
        ? row.messages
        : [];
    const userMessages = messages.filter(
      (m) => m && typeof m === 'object' && m.role === 'user',
    );
    if (userMessages.length === 0) {
      Sentry.captureMessage('studio_render_without_approval', {
        level: 'warning',
        tags: {
          area: 'studio',
          kind: 'auto_render_without_approval',
        },
        extra: {
          rowId: row.id,
          heygenSessionId: row.heygenSessionId,
          prompt: row.prompt.slice(0, 200),
          totalMessages: messages.length,
        },
      });
    }
  }

  await db
    .update(heygenAgentSessions)
    .set(updates)
    .where(eq(heygenAgentSessions.id, row.id));

  return { ...row, ...updates } as HeygenAgentSessionRow;
}

// ─── GET: poll ───────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const row = await loadOwned(user.id, id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Skip the HeyGen round-trip when the session is already in a
  // terminal state — saves quota + speeds up the UI when the
  // founder scrolls back to an old session.
  const terminal = row.status === 'completed' || row.status === 'failed';
  const fresh = terminal ? row : await refreshSession(row);
  return NextResponse.json({ session: serialize(fresh) });
}

// ─── POST: send a follow-up message ──────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const row = await loadOwned(user.id, id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status === 'completed' || row.status === 'failed') {
    return NextResponse.json(
      { error: 'Session already finished; start a new one.' },
      { status: 409 },
    );
  }

  let body: { message?: string; autoProceed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const message = (body.message ?? '').trim();
  if (message.length < 1 || message.length > 10_000) {
    return NextResponse.json(
      { error: 'message must be 1–10,000 chars' },
      { status: 400 },
    );
  }

  const send = await sendAgentMessage(row.heygenSessionId, {
    message,
    autoProceed: Boolean(body.autoProceed),
  });
  if (!send.ok) {
    return NextResponse.json({ error: send.error }, { status: 502 });
  }
  // Poll once so the agent's response (or "thinking" state)
  // surfaces on the same response.
  const refreshed = await refreshSession(row);
  return NextResponse.json({ session: serialize(refreshed) });
}
