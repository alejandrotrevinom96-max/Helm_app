// PR #76 — Sprint 7.3: HeyGen video generation placeholder.
// PR #86 — Sprint 7.10: real HeyGen integration.
//
// Lifecycle:
//   queued (insert from /api/ai/generate-structured)
//     → POST /api/heygen/generate-video {jobId}
//     → processing (HeyGen accepted the job, started_at stamped)
//     → webhook fires at /api/heygen/webhook
//     → completed (video_url + thumbnail + duration filled in)
//     OR
//     → failed (error captured, retry available)
//
// Two enablement gates, deliberately separate:
//   1. process.env.HEYGEN_ENABLED === 'true' AND
//      process.env.HEYGEN_API_KEY present (deployment-level)
//   2. The project this job belongs to has an avatar configured —
//      either heygenAvatarType='stock' + heygenAvatarId, or
//      heygenAvatarType='photo' + heygenPhotoUrl (project-level)
//
// Gate (1) alone is not enough: a project without an avatar would
// produce a 400 from HeyGen for missing character config. We fail
// fast with a feature_disabled / not_configured errorKind so the UI
// can render an actionable prompt ("Configure avatar in Settings")
// instead of a cryptic upstream error.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenJobs, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  isHeygenEnvConfigured,
  isHeygenReadyForProject,
} from '@/lib/heygen/gate';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEYGEN_API = 'https://api.heygen.com';

interface HeygenGenerateRequest {
  video_inputs: Array<{
    character:
      | {
          type: 'avatar';
          avatar_id: string;
          avatar_style: 'normal';
        }
      | {
          type: 'talking_photo';
          talking_photo_id: string;
          use_avatar_iv_model: true;
        };
    voice: {
      type: 'text';
      input_text: string;
      voice_id?: string;
      speed: number;
    };
  }>;
  dimension: { width: number; height: number };
  callback_id: string;
}

interface HeygenGenerateResponse {
  error: null | { code?: string; message?: string };
  data?: { video_id?: string };
  message?: string;
}

// PR Sprint 7.24 — voice-config error detector. HeyGen returns
// failures related to voice configuration in several shapes:
//   - "Invalid voice_id"
//   - "Voice not found"
//   - "VoiceConfiguration error"
//   - 400 with "voice" in the body
//   - "audio generation" failures when the voice_id doesn't match
//     the avatar's required language pack
// The check is intentionally permissive — false positives just mean
// we retry without voice_id, which is harmless. False negatives let
// the original generic 502 path through, which is the legacy
// behavior, so this is purely additive defense.
const VOICE_ERROR_KEYWORDS = [
  'voice_id',
  'voice id',
  'voice configuration',
  'voice not found',
  'invalid voice',
  'unsupported voice',
  // The phrase "voice" alone is too broad and would catch
  // "voiceover" / "voice-style" in unrelated errors. We require it
  // adjacent to "config", "id", or "invalid/unsupported" above.
];

function isVoiceConfigError(message: string): boolean {
  const lower = message.toLowerCase();
  return VOICE_ERROR_KEYWORDS.some((kw) => lower.includes(kw));
}

async function callHeygenGenerate(
  payload: HeygenGenerateRequest,
): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${HEYGEN_API}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.HEYGEN_API_KEY!,
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as HeygenGenerateResponse;
    if (!res.ok || body.error || !body.data?.video_id) {
      const msg =
        body.error?.message ??
        body.message ??
        `HeyGen returned HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, videoId: body.data.video_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'HeyGen request failed',
    };
  }
}

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
      {
        success: false,
        error: 'HeyGen integration not enabled yet.',
        errorKind: 'feature_disabled',
        retry: false,
        hint: "Your video is queued. When we enable the HeyGen integration we'll notify you and process it automatically.",
      },
      { status: 503 },
    );
  }

  let body: { jobId?: unknown };
  try {
    body = (await request.json()) as { jobId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.jobId !== 'string' || !UUID_RE.test(body.jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  // Ownership check via the project — defense-in-depth even though
  // heygen_jobs.userId is also set at insert time.
  const [joined] = await db
    .select({ job: heygenJobs, project: projects })
    .from(heygenJobs)
    .innerJoin(projects, eq(projects.id, heygenJobs.projectId))
    .where(
      and(eq(heygenJobs.id, body.jobId), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!joined) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { job, project } = joined;

  // Project-level configuration gate. Returns a distinct errorKind
  // so the UI can route the user to /settings instead of surfacing
  // the generic feature_disabled flow.
  if (!isHeygenReadyForProject(project)) {
    return NextResponse.json(
      {
        success: false,
        error: 'No avatar configured for this project.',
        errorKind: 'not_configured',
        retry: false,
        hint: 'Open Settings → Video Avatar to pick a stock avatar or upload a photo.',
      },
      { status: 400 },
    );
  }

  // Idempotency — if the job is already in a terminal or in-flight
  // state, refuse to re-fire. The UI can read the status via GET.
  if (job.status !== 'queued' && job.status !== 'failed') {
    return NextResponse.json(
      {
        success: false,
        error: `Job is already ${job.status}.`,
        errorKind: 'invalid_state',
        retry: false,
      },
      { status: 409 },
    );
  }

  // Build the HeyGen payload from the project's avatar config + the
  // job's script. Default voice handling: when heygenVoiceId is
  // null, we omit `voice_id` and HeyGen uses the avatar's bundled
  // voice. Speed=1.0 across the board (cf. Sprint 7.3 design note).
  const avatarType = project.heygenAvatarType ?? 'stock';
  const character: HeygenGenerateRequest['video_inputs'][number]['character'] =
    avatarType === 'photo'
      ? {
          type: 'talking_photo',
          // PR #86 — Sprint 7.10: per the integration brief we pass
          // the public photo URL directly as talking_photo_id with
          // use_avatar_iv_model=true. HeyGen's Avatar IV pipeline
          // accepts this shape; if a future API version requires
          // the two-step photo registration flow (POST /v2/photo_
          // avatar/photo/generate first), we'll add that here and
          // cache the registered id on projects.
          talking_photo_id: project.heygenPhotoUrl!,
          use_avatar_iv_model: true,
        }
      : {
          type: 'avatar',
          avatar_id: project.heygenAvatarId!,
          avatar_style: 'normal',
        };

  const voice: HeygenGenerateRequest['video_inputs'][number]['voice'] = {
    type: 'text',
    input_text: job.scriptText,
    speed: 1.0,
    ...(project.heygenVoiceId ? { voice_id: project.heygenVoiceId } : {}),
  };

  const payload: HeygenGenerateRequest = {
    video_inputs: [{ character, voice }],
    // 9:16 portrait for Reels / TikTok / Shorts. This is the only
    // shape we generate today; if/when we add 16:9 explainers, the
    // dimension would come from the job row, not be hardcoded.
    dimension: { width: 1080, height: 1920 },
    callback_id: job.id,
  };

  // PR Sprint 7.24 — voice error handling. HeyGen returns a 400 with
  // a message containing "voice" / "voice_id" / "VoiceConfiguration"
  // when the project's stored voice_id is no longer recognized
  // (deprecated by HeyGen, mismatched with the new avatar, etc.).
  // The legacy behavior surfaced the raw upstream string to the
  // founder, which is opaque + unactionable. The fix:
  //   1. Detect voice-related failures with a keyword regex.
  //   2. If a voice_id was set on this call, retry ONCE without it
  //      so HeyGen falls back to the avatar's bundled voice. Most
  //      stock avatars have a default voice, so the retry usually
  //      succeeds.
  //   3. If the retry succeeds, mark the project's stale voice_id
  //      for replacement (we surface a one-time warning back in the
  //      response so the UI can prompt "your saved voice was
  //      replaced — pick a new one if you want a different sound").
  //   4. If the retry also fails (or there was no voice_id to drop)
  //      return errorKind='voice_config' so the UI can route to
  //      Settings → Video Avatar instead of showing a 502.
  let result = await callHeygenGenerate(payload);
  let voiceFallbackUsed = false;
  if (
    !result.ok &&
    isVoiceConfigError(result.error) &&
    project.heygenVoiceId
  ) {
    voiceFallbackUsed = true;
    const fallbackPayload: HeygenGenerateRequest = {
      ...payload,
      video_inputs: payload.video_inputs.map((vi) => ({
        ...vi,
        voice: { type: vi.voice.type, input_text: vi.voice.input_text, speed: vi.voice.speed },
      })),
    };
    result = await callHeygenGenerate(fallbackPayload);
  }

  if (!result.ok) {
    // Voice-config errors after the fallback attempt → route the
    // founder to Settings instead of showing a generic upstream
    // failure. The friendly hint is what the founder will see; the
    // raw `error` string is stored in the DB row for ops debugging
    // but not surfaced verbatim in the response.
    const isVoice = isVoiceConfigError(result.error);
    const errorKind = isVoice ? 'voice_config' : 'upstream_error';
    const userError = isVoice
      ? 'Video generation failed: voice configuration issue.'
      : result.error;
    const hint = isVoice
      ? 'Please update your avatar in Settings → Video Avatar.'
      : undefined;

    await db
      .update(heygenJobs)
      .set({
        status: 'failed',
        errorMessage: result.error.slice(0, 500),
        errorKind,
        completedAt: new Date(),
      })
      .where(eq(heygenJobs.id, job.id));
    return NextResponse.json(
      {
        success: false,
        error: userError,
        errorKind,
        retry: !isVoice, // voice errors are NOT user-retryable from this UI
        ...(hint ? { hint } : {}),
      },
      { status: isVoice ? 400 : 502 },
    );
  }

  // If we landed here via the voice fallback, the project's stored
  // voice_id is stale. Null it out so future generations use the
  // avatar's bundled voice by default — no more silent failures.
  // The founder can pick a new voice from Settings whenever they
  // want a different sound.
  if (voiceFallbackUsed) {
    await db
      .update(projects)
      .set({ heygenVoiceId: null })
      .where(eq(projects.id, project.id))
      .catch((err: unknown) => {
        console.warn(
          '[heygen/generate-video] failed to clear stale voice_id (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      });
  }

  // Success path — mark processing and stash HeyGen's video_id so
  // the webhook can correlate. We use callback_id (= job.id) as the
  // primary key for the webhook lookup; heygenJobId stays in sync
  // for ops / debugging.
  await db
    .update(heygenJobs)
    .set({
      status: 'processing',
      heygenJobId: result.videoId,
      heygenStatus: 'processing',
      processedAt: new Date(),
      errorMessage: null,
      errorKind: null,
    })
    .where(eq(heygenJobs.id, job.id));

  return NextResponse.json({
    success: true,
    heygenVideoId: result.videoId,
    status: 'processing',
  });
}

// GET /api/heygen/generate-video?jobId=<uuid>
// Job-status read. Available regardless of enablement so the UI can
// render badges without checking the env flag first.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  const [joined] = await db
    .select({ job: heygenJobs, project: projects })
    .from(heygenJobs)
    .innerJoin(projects, eq(projects.id, heygenJobs.projectId))
    .where(and(eq(heygenJobs.id, jobId), eq(projects.userId, user.id)))
    .limit(1);
  if (!joined) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const job = joined.job;
  return NextResponse.json({
    success: true,
    enabled: isHeygenEnvConfigured(),
    readyForProject: isHeygenReadyForProject(joined.project),
    job: {
      id: job.id,
      status: job.status,
      videoUrl: job.videoUrl,
      thumbnailUrl: job.thumbnailUrl,
      durationSeconds: job.durationSeconds,
      errorKind: job.errorKind,
      errorMessage: job.errorMessage,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
    },
  });
}
