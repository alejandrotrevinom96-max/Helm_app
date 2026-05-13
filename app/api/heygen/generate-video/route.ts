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

  const result = await callHeygenGenerate(payload);
  if (!result.ok) {
    await db
      .update(heygenJobs)
      .set({
        status: 'failed',
        errorMessage: result.error.slice(0, 500),
        errorKind: 'upstream_error',
        completedAt: new Date(),
      })
      .where(eq(heygenJobs.id, job.id));
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        errorKind: 'upstream_error',
        retry: true,
      },
      { status: 502 },
    );
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
