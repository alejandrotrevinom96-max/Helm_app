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
//   Body shapes (PR Sprint D-final):
//     { kind: 'feedback', message: '...' }
//       → POST /v3/video-agents/{id}, agent iterates on draft
//     { kind: 'approve' }
//       → POST /v3/video-agents/{id}/approve, fires final render
//   Legacy back-compat: { message, autoProceed: true } still
//   accepted (mapped to kind:'approve').

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
  approveAgentSession,
  getFinalVideo,
  type SessionStatus,
} from '@/lib/heygen/v3-client';
import * as Sentry from '@sentry/nextjs';

// PR Sprint D-7 — message-shape guard for the unapproved-render
// telemetry below. HeyGen's messages array is loose-typed (`unknown[]`
// on the row), so we narrow before we touch it.
interface AgentMessageShape {
  role?: string;
  content?: string;
}
function isAgentMessageArray(v: unknown): v is AgentMessageShape[] {
  return Array.isArray(v);
}

// PR Sprint D-bugs (UGC fix) — approval-checkpoint detector.
//
// HeyGen V3 chat agent fires a "Take a look at the blueprint…"
// style message right before it auto-proceeds to render.
// Detecting that message lets us flip the local approvalGateActive
// flag + freeze the surfaced status at 'reviewing' until the
// founder explicitly approves or sends feedback.
//
// Detection is keyword-based and intentionally generous — false
// positives just produce an extra "confirm to proceed" beat,
// which is the right default. Missing the checkpoint produces
// the auto-render bug, which is the wrong default.
function looksLikeApprovalCheckpoint(content: string | undefined): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    /\b(take a look|blueprint|storyboard|let me know|looks? good|ready to (bring|render)|approve|review the (plan|script|concept|storyboard)|sound (good|right)|shall i (proceed|render)|here'?s the (plan|outline|script))\b/.test(
      lower,
    )
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

function serialize(row: HeygenAgentSessionRow) {
  // PR Sprint D-bugs (UGC fix) — when the approval gate is
  // active, the client should see status='reviewing' (the
  // existing waiting-for-feedback enum) and NO video URLs,
  // regardless of what HeyGen has actually done in the
  // background. The local row keeps the real values; we just
  // don't surface them until the founder approves.
  const gated = row.approvalGateActive === true;
  const surfacedStatus = gated ? 'reviewing' : row.status;
  // PR Sprint UGC+Photo paridad — anti-naming. Removed
  // viewInHeygenUrl from the client-facing payload. The DB
  // still stores heygenSessionId for internal use (Sentry
  // breadcrumbs, debugging), and the column heygen_session_id
  // remains on the row for joins, but the founder never sees
  // the provider name in the UI.
  return {
    id: row.id,
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
    // PR Sprint D-bugs (UGC fix) — gate ALL final-video fields
    // while approvalGateActive=true. If HeyGen completed the
    // render in the background (which it will, since chat mode
    // doesn't actually pause), we don't expose the URL to the
    // client until the founder approves. finalVideoId stays
    // surfaced so the UI can debug if needed.
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

  // PR Sprint D-bugs-2 (UGC fix v2) — approval-gate detection,
  // rewritten.
  //
  // The original Sprint D-bugs logic required userMessageCount===0
  // to engage — but HeyGen V3 counts the founder's create-time
  // prompt as a 'user' message in the thread, so that gate
  // condition was permanently false and the detector NEVER
  // engaged on real sessions. That's why videos were
  // auto-rendering past the gate in test sessions like "Solo
  // Founders: Ship It!".
  //
  // The new rule uses MESSAGE TIMESTAMP, not user count:
  //
  //   Engage iff:
  //     - row.approvalGateActive is currently false, AND
  //     - the latest agent message matches the checkpoint regex,
  //       AND
  //     - that message's created_at is NEWER than the last gate
  //       transition (approvalGateAt). The POST handler updates
  //       approvalGateAt when it clears the gate, so we can
  //       distinguish "stale checkpoint we already saw" from
  //       "new checkpoint after iteration".
  //
  // Net result: gate engages on the FIRST checkpoint regardless
  // of how many user messages preceded it, and RE-engages after
  // user iteration when HeyGen produces a new checkpoint.
  if (!row.approvalGateActive) {
    const mergedMessages = isAgentMessageArray(updates.messages)
      ? updates.messages
      : isAgentMessageArray(row.messages)
        ? row.messages
        : [];
    const lastAgentMsg = [...mergedMessages]
      .reverse()
      .find((m) => m && typeof m === 'object' && m.role === 'model');
    if (looksLikeApprovalCheckpoint(lastAgentMsg?.content)) {
      // HeyGen returns created_at as a ms-since-epoch number on
      // each AgentMessage. Cast through unknown so we don't have
      // to widen the AgentMessageShape interface in this file.
      const msgCreatedAtMs =
        typeof (lastAgentMsg as { created_at?: unknown })?.created_at ===
        'number'
          ? ((lastAgentMsg as { created_at?: number }).created_at ?? 0)
          : 0;
      const lastTransitionMs = row.approvalGateAt?.getTime() ?? 0;
      const isFreshCheckpoint =
        msgCreatedAtMs === 0 || msgCreatedAtMs > lastTransitionMs;
      if (isFreshCheckpoint) {
        updates.approvalGateActive = true;
        updates.approvalGateAt = new Date();
        // Sentry breadcrumb for visibility — lets us tune the
        // detector's keyword list against what HeyGen actually
        // says in production.
        Sentry.captureMessage('heygen_agent_gate_engaged', {
          level: 'info',
          tags: { area: 'heygen-v3', kind: 'approval-gate' },
          extra: {
            rowId: row.id,
            heygenStatus: fresh.status,
            triggerSnippet: (lastAgentMsg?.content ?? '').slice(0, 200),
            msgCreatedAtMs,
            lastTransitionMs,
          },
        });
      }
    }
  }

  // PR Sprint D-7 — unapproved-render telemetry.
  //
  // Fire ONCE when a session first transitions into 'generating'
  // (HeyGen has started the render). Check if the user ever sent
  // a follow-up message — if not, the agent auto-proceeded after
  // its own "Ready to bring this to life?" prompt without our
  // approval. This is the bug we're trying to stamp out; logging
  // it lets us measure how often it still leaks through after
  // the approval-gate + native /approve endpoint lands.
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
  // PR Sprint D-bugs (UGC fix) — allow follow-up even when the
  // LOCAL row reads as 'completed'. If the gate is active, the
  // surfaced status is 'reviewing' but the underlying row.status
  // could be 'completed' (HeyGen finished the render in the
  // background). The founder is still expected to approve /
  // iterate before the video is exposed.
  if (
    !row.approvalGateActive &&
    (row.status === 'completed' || row.status === 'failed')
  ) {
    return NextResponse.json(
      { error: 'Session already finished; start a new one.' },
      { status: 409 },
    );
  }

  // PR Sprint D-final — explicit action contract.
  //
  // Old shape: { message, autoProceed? } — autoProceed=true was
  // sent as `auto_proceed` to HeyGen, which 400s ("Extra inputs
  // are not permitted"). New shape distinguishes the two intents
  // by their dedicated upstream endpoints:
  //
  //   { kind: 'feedback', message: '...' }
  //     → POST /v3/video-agents/{id}     (sendAgentMessage)
  //     → agent iterates on the draft, status stays at draft
  //
  //   { kind: 'approve' }
  //     → POST /v3/video-agents/{id}/approve  (approveAgentSession)
  //     → HeyGen confirms the draft, render fires, status flips
  //       to generating then completed
  //
  // Backward compat: callers that still send the old shape are
  // mapped automatically (autoProceed=true → approve, otherwise
  // feedback). The UGC Studio client is updated in the same PR
  // but external callers might still be on the old contract.
  let body: {
    kind?: 'feedback' | 'approve';
    message?: string;
    autoProceed?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Resolve the action. Explicit `kind` wins; legacy `autoProceed`
  // falls back to approve|feedback semantics.
  const isApprove =
    body.kind === 'approve' || body.autoProceed === true;
  const message = (body.message ?? '').trim();

  // Feedback path requires a non-empty message; approve doesn't.
  if (!isApprove && (message.length < 1 || message.length > 10_000)) {
    return NextResponse.json(
      { error: 'feedback requires message (1–10000 chars)' },
      { status: 400 },
    );
  }

  // PR Sprint D-bugs (UGC fix) — clear the approval gate on any
  // founder action. After this point the serializer exposes the
  // real HeyGen state, which is what the founder is about to
  // act on (approve → trigger render, or feedback → wait for
  // re-draft).
  const wasGated = row.approvalGateActive === true;
  if (wasGated) {
    // PR Sprint D-bugs-2 — bump approvalGateAt on clear so the
    // re-engagement detector (above) knows "this checkpoint
    // message is stale, don't re-engage on it". Only NEW agent
    // messages (created_at > approvalGateAt) re-trigger the
    // gate.
    await db
      .update(heygenAgentSessions)
      .set({
        approvalGateActive: false,
        approvalGateAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(heygenAgentSessions.id, row.id));
  }

  const sendResult = isApprove
    ? await approveAgentSession(row.heygenSessionId)
    : await sendAgentMessage(row.heygenSessionId, { message });

  if (!sendResult.ok) {
    return NextResponse.json(
      {
        error: `${sendResult.error} (Gate released — refresh to see HeyGen's actual state.)`,
        gateCleared: wasGated,
        action: isApprove ? 'approve' : 'feedback',
      },
      { status: 502 },
    );
  }
  // Poll once so the agent's response (or "thinking" state)
  // surfaces on the same response.
  const refreshed = await refreshSession({
    ...row,
    approvalGateActive: false,
  } as HeygenAgentSessionRow);
  return NextResponse.json({ session: serialize(refreshed) });
}
