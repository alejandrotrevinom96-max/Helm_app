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

// PR Sprint 7.25 Phase 11.12 / PR Sprint C — voice_id is mandatory
// on every HeyGen V2 generate call. We persist the founder's
// chosen voice on the project row (heygen_voice_id) when they
// pick an avatar, and we capture the gender pair (avatar +
// voice) so the upstream-error fallback can pick a gender-
// correct safety net instead of silently flipping male →
// female (the uncanny-valley bug that motivated Sprint C).
//
// Two defaults — one per gender — so a failed render never
// produces a male avatar with a female voice (or vice versa).
// Env overrides exist so the founder can swap to any voice in
// HeyGen's catalog at deploy time without re-deploying code.
const DEFAULT_HEYGEN_VOICE_ID_MALE =
  process.env.HEYGEN_DEFAULT_VOICE_ID_MALE ??
  // Adam — stable en-US male voice from HeyGen's public catalog.
  // Update via env when HeyGen rotates the public catalog.
  '5403a745860347beae34c80a8bbfe24c';
const DEFAULT_HEYGEN_VOICE_ID_FEMALE =
  process.env.HEYGEN_DEFAULT_VOICE_ID_FEMALE ??
  process.env.HEYGEN_DEFAULT_VOICE_ID ??
  // Existing deploy-wide default. Kept as the female fallback
  // so projects that already worked don't regress.
  '2d5b0e6cf36f460aa7fc47e3eee4ba54';

function defaultVoiceForGender(
  gender: 'male' | 'female' | 'neutral' | null | undefined,
): string {
  if (gender === 'male') return DEFAULT_HEYGEN_VOICE_ID_MALE;
  // 'female' AND 'neutral' AND null all land here. We bias toward
  // the female default because that's what shipped pre-Sprint-C
  // and we want backward compatibility for projects whose gender
  // is null (legacy rows that pre-date the migration).
  return DEFAULT_HEYGEN_VOICE_ID_FEMALE;
}

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
  // PR Sprint C — HeyGen V2 caption flag. When true the
  // rendered video gets hardcoded auto-captions overlaid (the
  // SRT-style on-screen text social-media UGC posts always
  // ship with). Helm flips this on for every UGC / Reel render
  // since captioned video lifts retention ~30% on muted-by-
  // default TikTok / IG Reels playback.
  caption?: boolean;
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
  // PR Sprint 7.25 Phase 11.15 — three character shapes now:
  //   - 'photo'          → founder-uploaded talking_photo, ID is
  //                        stored in project.heygenPhotoUrl
  //                        (legacy column name; pre-dates the
  //                        Instant Avatar catalog).
  //   - 'talking_photo'  → HeyGen catalog Instant/UGC avatar from
  //                        /v2/talking_photo, ID stored in
  //                        project.heygenAvatarId.
  //   - everything else  → 'stock' (legacy /v2/avatars), studio
  //                        avatar with avatar_style='normal'.
  // Both talking_photo branches need `use_avatar_iv_model: true`
  // so HeyGen renders the modern Instant Avatar pipeline (not the
  // older static-image lipsync).
  const character: HeygenGenerateRequest['video_inputs'][number]['character'] =
    avatarType === 'photo'
      ? {
          type: 'talking_photo',
          talking_photo_id: project.heygenPhotoUrl!,
          use_avatar_iv_model: true,
        }
      : avatarType === 'talking_photo'
        ? {
            type: 'talking_photo',
            talking_photo_id: project.heygenAvatarId!,
            use_avatar_iv_model: true,
          }
        : {
            type: 'avatar',
            avatar_id: project.heygenAvatarId!,
            avatar_style: 'normal',
          };

  // PR Sprint C — refuse to fire when the project has no
  // voice_id. Pre-fix we silently fell back to a deploy-wide
  // default voice; for projects whose avatar was male and whose
  // default was female that produced the "male avatar speaking
  // with female voice" uncanny-valley bug. Now: if the founder
  // hasn't picked a voice we bail with errorKind='voice_config'
  // so the Library surfaces the "fix it in Settings" affordance
  // instead of producing a broken video.
  const avatarGender = (project.heygenAvatarGender ??
    null) as 'male' | 'female' | 'neutral' | null;
  const voiceGender = (project.heygenVoiceGender ??
    null) as 'male' | 'female' | 'neutral' | null;

  if (!project.heygenVoiceId) {
    await db
      .update(heygenJobs)
      .set({
        status: 'failed',
        errorMessage:
          'No voice configured for this project. Pick an avatar in Settings — Helm now auto-matches a gender-appropriate voice.',
        errorKind: 'voice_config',
        attemptCount: sql`${heygenJobs.attemptCount} + 1`,
        completedAt: new Date(),
      })
      .where(eq(heygenJobs.id, job.id));
    return {
      ok: false,
      errorKind: 'voice_config',
      error: 'No voice configured for this project',
      retry: false,
    };
  }

  // PR Sprint C — gender-mismatch warning. Doesn't block the
  // render (the founder may have picked the mismatch on purpose,
  // and the picker UI already surfaces the same warning at
  // selection time) but loudly logs so we can attribute weird-
  // sounding output later.
  if (
    avatarGender &&
    voiceGender &&
    avatarGender !== voiceGender &&
    avatarGender !== 'neutral' &&
    voiceGender !== 'neutral'
  ) {
    console.warn('[heygen/fire] gender mismatch', {
      projectId: project.id,
      avatarGender,
      voiceGender,
    });
  }

  const voice: HeygenGenerateRequest['video_inputs'][number]['voice'] = {
    type: 'text',
    input_text: job.scriptText,
    speed: 1.0,
    voice_id: project.heygenVoiceId,
  };

  const payload: HeygenGenerateRequest = {
    video_inputs: [{ character, voice }],
    // 9:16 portrait — same default as the route handler. If we add
    // 16:9 explainers later, the dimension would come from a job
    // column.
    dimension: { width: 1080, height: 1920 },
    callback_id: job.id,
    // PR Sprint C — Helm-wide caption-on default. Muted autoplay
    // on TikTok / IG Reels / FB Reels makes captions table
    // stakes; opting out per-job can be a future column if we
    // ever ship a long-form explainer that doesn't want them.
    caption: true,
  };

  let result = await callHeygenGenerate(payload);
  let voiceFallbackUsed = false;
  // PR Sprint C — gender-aware voice fallback. When HeyGen
  // rejects the saved voice_id ("invalid voice", "voice not
  // found", etc.), we retry with our gender-matched DEFAULT.
  // Pre-fix we used a single deploy-wide default that was
  // female — so a male avatar with a broken voice_id silently
  // got a female voice on retry. Now: defaultVoiceForGender
  // picks the male OR female default based on the avatar's
  // saved gender, so the fallback NEVER flips gender.
  const fallbackVoiceId = defaultVoiceForGender(avatarGender);
  if (
    !result.ok &&
    isVoiceConfigError(result.error) &&
    project.heygenVoiceId &&
    project.heygenVoiceId !== fallbackVoiceId
  ) {
    voiceFallbackUsed = true;
    const fallbackPayload: HeygenGenerateRequest = {
      ...payload,
      video_inputs: payload.video_inputs.map((vi) => ({
        ...vi,
        voice: {
          ...vi.voice,
          voice_id: fallbackVoiceId,
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

  // Successful voice fallback → clear the stale voice_id +
  // voiceGender so the founder doesn't keep hitting the same
  // error every time. They'll re-pick a voice in Settings; the
  // picker's auto-match guarantees the new pair lands gender-
  // consistent.
  if (voiceFallbackUsed) {
    await db
      .update(projects)
      .set({ heygenVoiceId: null, heygenVoiceGender: null })
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
