// PR Sprint D-4 — Lipsync re-render entry point.
//
// POST /api/heygen/lipsync
//   Body: { sourceJobId, editedScript, mode? }
//
// Re-renders a UGC video with a new spoken script while keeping
// the original avatar pass intact (5-10x cheaper than a full
// Avatar IV render). Pipeline:
//
//   1. Load the source heygen_jobs row + its project.
//   2. TTS the new script via /v3/voices/speech using the
//      project's voice_id.
//   3. Submit to /v3/lipsyncs with the original video_url +
//      the new audio_url.
//   4. Persist a heygen_lipsync_jobs row tracking the
//      heygen_lipsync_id.
//
// The client polls GET /api/heygen/lipsync/[id] to surface
// status updates. When status='completed', the row's
// resultVideoUrl + resultCaptionUrl are populated and the
// Library modal can swap in the re-rendered video.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenJobs, heygenLipsyncJobs, projects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { isHeygenEnvConfigured } from '@/lib/heygen/gate';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  createLipsync,
  generateSpeech,
  type LipsyncMode,
} from '@/lib/heygen/v3-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

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
  // 12/hr cap — lipsync is cheaper than a full render but still
  // costs real HeyGen quota. Aligns with the heygen-worker's
  // attempt budget.
  const limit = checkRateLimit(
    `lipsync:${user.id}`,
    12,
    60 * 60 * 1000,
  );
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
    sourceJobId?: string;
    editedScript?: string;
    mode?: LipsyncMode;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const sourceJobId = body.sourceJobId;
  const editedScript = (body.editedScript ?? '').trim();
  if (!sourceJobId || !UUID_RE.test(sourceJobId)) {
    return NextResponse.json(
      { error: 'sourceJobId required' },
      { status: 400 },
    );
  }
  if (editedScript.length < 5 || editedScript.length > 10_000) {
    return NextResponse.json(
      { error: 'editedScript must be 5–10,000 chars' },
      { status: 400 },
    );
  }
  const mode: LipsyncMode =
    body.mode === 'precision' ? 'precision' : 'speed';

  // Load the source job + project, check ownership.
  const [row] = await db
    .select({ job: heygenJobs, project: projects })
    .from(heygenJobs)
    .innerJoin(projects, eq(projects.id, heygenJobs.projectId))
    .where(
      and(eq(heygenJobs.id, sourceJobId), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { error: 'Source render not found or forbidden' },
      { status: 403 },
    );
  }
  if (row.job.status !== 'completed') {
    return NextResponse.json(
      {
        error:
          'Source render is not completed yet. Re-rendering needs a finished base video.',
      },
      { status: 409 },
    );
  }
  if (!row.job.videoUrl) {
    return NextResponse.json(
      { error: 'Source render has no video URL on file.' },
      { status: 409 },
    );
  }
  if (!row.project.heygenVoiceId) {
    return NextResponse.json(
      {
        error:
          'No voice configured for this project. Pick a voice in Settings before re-rendering.',
      },
      { status: 409 },
    );
  }

  // Step 1: TTS the new script.
  const tts = await generateSpeech({
    script: editedScript,
    voiceId: row.project.heygenVoiceId,
    locale: row.project.heygenVoiceLocale ?? undefined,
    speed: row.project.heygenVoiceSpeed
      ? Number(row.project.heygenVoiceSpeed)
      : undefined,
  });
  if (!tts.ok) {
    return NextResponse.json(
      { error: `Speech generation failed: ${tts.error}` },
      { status: 502 },
    );
  }

  // Step 2: lipsync the new audio onto the existing video.
  const lip = await createLipsync({
    videoUrl: row.job.videoUrl,
    audioUrl: tts.result.audio_url,
    mode,
    title: `Re-render of ${sourceJobId.slice(0, 8)}`,
    enableCaption: true,
    enableSpeechEnhancement: true,
  });
  if (!lip.ok) {
    return NextResponse.json(
      { error: `Lipsync submission failed: ${lip.error}` },
      { status: 502 },
    );
  }

  const [inserted] = await db
    .insert(heygenLipsyncJobs)
    .values({
      userId: user.id,
      projectId: row.project.id,
      sourceJobId,
      heygenLipsyncId: lip.lipsyncId,
      mode,
      editedScript,
      status: 'processing',
    })
    .returning();

  return NextResponse.json({ lipsync: serialize(inserted) });
}

function serialize(row: typeof heygenLipsyncJobs.$inferSelect) {
  return {
    id: row.id,
    sourceJobId: row.sourceJobId,
    heygenLipsyncId: row.heygenLipsyncId,
    mode: row.mode,
    editedScript: row.editedScript,
    status: row.status,
    resultVideoUrl: row.resultVideoUrl,
    resultCaptionUrl: row.resultCaptionUrl,
    durationSec: row.durationSec,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
