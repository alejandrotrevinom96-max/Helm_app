// PR Sprint 7.25 Phase 11 — shared HeyGen fire-once helper.
//
// Used by:
//   - app/api/heygen/generate-video/route.ts (user-driven manual
//     fire from the Library detail modal).
//   - app/api/cron/heygen-worker/route.ts   (system-driven cron
//     that processes queued jobs server-side so videos render
//     even when no founder has the Generator card mounted).
//
// Pulls the HeyGen payload build + the dual-API-call dance (voice
// fallback) + the DB status transitions out of the route handler
// so both call sites stay short. Caller is responsible for:
//   - Authentication / ownership checks (the cron skips them; the
//     endpoint runs them before calling).
//   - Mapping the result to an HTTP response shape (or the cron's
//     batch summary).
//   - Confirming HEYGEN env is configured + the project has an
//     avatar (`isHeygenReadyForProject`).
//
// Returns a discriminated union so the caller doesn't have to
// inspect DB state after the call — the row IS updated either
// way (status='processing' on success, status='failed' on hard
// error) so re-querying just confirms what the helper already
// reported.

import { db } from '@/lib/db';
import { heygenJobs, projects } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

const HEYGEN_API = 'https://api.heygen.com';

type HeygenJob = typeof heygenJobs.$inferSelect;
type Project = typeof projects.$inferSelect;

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

// Keywords that mark a HeyGen failure as voice-related. Matches the
// extractor in app/api/heygen/generate-video/route.ts (PR Sprint 7.24).
const VOICE_ERROR_KEYWORDS = [
  'voice_id',
  'voice id',
  'voice configuration',
  'voice not found',
  'invalid voice',
  'unsupported voice',
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

export type HeygenFireResult =
  | {
      ok: true;
      heygenVideoId: string;
      voiceFallbackUsed: boolean;
    }
  | {
      ok: false;
      errorKind: 'voice_config' | 'upstream_error';
      error: string;
      retry: boolean;
    };

/**
 * Fire HeyGen for a job + project pair. Idempotent — the caller must
 * already have verified job.status is 'queued' or 'failed' (this
 * helper does NOT re-check). All DB state transitions live here so
 * the caller can be a thin wrapper.
 */
export async function fireHeygenForJob(
  job: HeygenJob,
  project: Project,
): Promise<HeygenFireResult> {
  const avatarType = project.heygenAvatarType ?? 'stock';
  const character: HeygenGenerateRequest['video_inputs'][number]['character'] =
    avatarType === 'photo'
      ? {
          type: 'talking_photo',
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
    // 9:16 portrait — same default as the route handler. If we add
    // 16:9 explainers later, the dimension would come from a job
    // column.
    dimension: { width: 1080, height: 1920 },
    callback_id: job.id,
  };

  let result = await callHeygenGenerate(payload);
  let voiceFallbackUsed = false;
  // Voice-error fallback: if a voice_id was set + HeyGen complained
  // about voice, retry once without it. Matches the original
  // endpoint's recovery path.
  if (!result.ok && isVoiceConfigError(result.error) && project.heygenVoiceId) {
    voiceFallbackUsed = true;
    const fallbackPayload: HeygenGenerateRequest = {
      ...payload,
      video_inputs: payload.video_inputs.map((vi) => ({
        ...vi,
        voice: {
          type: vi.voice.type,
          input_text: vi.voice.input_text,
          speed: vi.voice.speed,
        },
      })),
    };
    result = await callHeygenGenerate(fallbackPayload);
  }

  if (!result.ok) {
    const isVoice = isVoiceConfigError(result.error);
    const errorKind: 'voice_config' | 'upstream_error' = isVoice
      ? 'voice_config'
      : 'upstream_error';
    // PR Sprint 7.25 Phase 11.5 — bump attempt_count on every
    // HeyGen miss so the cron's retry-cap logic
    // (MAX_HEYGEN_ATTEMPTS) sees progress. We use a SQL increment
    // (attempt_count + 1) instead of reading-then-writing so
    // concurrent fires from cron + user-driven endpoint can't lose
    // a tick.
    await db
      .update(heygenJobs)
      .set({
        status: 'failed',
        errorMessage: result.error.slice(0, 500),
        errorKind,
        attemptCount: sql`${heygenJobs.attemptCount} + 1`,
        completedAt: new Date(),
      })
      .where(eq(heygenJobs.id, job.id));
    return {
      ok: false,
      errorKind,
      error: result.error,
      retry: !isVoice, // voice errors aren't user-retryable from this surface
    };
  }

  // Successful voice fallback → clear the stale voice_id so the
  // founder doesn't keep hitting the same error every time.
  if (voiceFallbackUsed) {
    await db
      .update(projects)
      .set({ heygenVoiceId: null })
      .where(eq(projects.id, project.id))
      .catch((err: unknown) => {
        console.warn(
          '[heygen/fire] failed to clear stale voice_id (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      });
  }

  await db
    .update(heygenJobs)
    .set({
      status: 'processing',
      heygenJobId: result.videoId,
      heygenStatus: 'processing',
      // Same SQL increment as the failure path so retries that
      // eventually succeed still accumulate the attempt history.
      // attemptCount becomes a "how many HeyGen requests did we
      // burn for this video" counter, which is useful telemetry.
      attemptCount: sql`${heygenJobs.attemptCount} + 1`,
      processedAt: new Date(),
      errorMessage: null,
      errorKind: null,
    })
    .where(eq(heygenJobs.id, job.id));

  return {
    ok: true,
    heygenVideoId: result.videoId,
    voiceFallbackUsed,
  };
}
