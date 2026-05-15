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
// PR Sprint 7.25 Phase 11 — fire-once helper extracted into
// lib/heygen/fire.ts so the cron worker shares the same dual-
// API-call dance, voice-fallback recovery, and DB transitions.
import { fireHeygenForJob } from '@/lib/heygen/fire';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PR Sprint 7.25 Phase 11 — the HeyGen payload build, voice-fallback
// dance, and DB transitions moved to lib/heygen/fire.ts so the new
// cron worker shares the same logic. The route below only handles
// auth/ownership and shaping the user-facing response.

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

  // PR Sprint 7.25 Phase 11 — payload build + voice fallback + DB
  // transitions live in the shared fireHeygenForJob helper so the
  // cron worker behaves identically. This route only owns the
  // user-driven authentication, ownership, and response shape.
  const fire = await fireHeygenForJob(job, project);
  if (!fire.ok) {
    const isVoice = fire.errorKind === 'voice_config';
    return NextResponse.json(
      {
        success: false,
        error: isVoice
          ? 'Video generation failed: voice configuration issue.'
          : fire.error,
        errorKind: fire.errorKind,
        retry: fire.retry,
        // PR Sprint 7.25 Phase 11.10 — surface the actual upstream
        // HeyGen error string. The mapped `error` is the friendly
        // UI copy; `upstreamError` is the raw HeyGen message
        // ("Avatar XYZ not found", "Invalid voice_id", "Talking
        // photo URL must be 1024x1024", etc.). The card renders it
        // as small mono text so the founder knows what HeyGen
        // actually objected to instead of seeing the generic
        // mapped string forever.
        upstreamError: fire.error,
        ...(isVoice
          ? {
              hint:
                'If you just changed your avatar in Settings, give the queue ~60s — it auto-retries. If the same error keeps coming back, the upstream message below has the actual reason.',
            }
          : {}),
      },
      { status: isVoice ? 400 : 502 },
    );
  }
  return NextResponse.json({
    success: true,
    heygenVideoId: fire.heygenVideoId,
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
