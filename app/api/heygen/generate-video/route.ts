// PR #76 — Sprint 7.3: HeyGen video generation placeholder.
//
// This route is shipped INTENTIONALLY non-functional. The schema
// (heygen_jobs) is ready, the wire shape is defined, the queue
// inserts happen from /api/ai/generate-structured — but the
// actual call to HeyGen's API is gated behind two prerequisites:
//
//   1. process.env.HEYGEN_ENABLED === 'true'
//   2. process.env.HEYGEN_API_KEY set
//
// Without both, POST returns 503 with a feature_disabled errorKind
// so the UI can render "Video queued — coming soon" rather than a
// scary failure. GET works regardless and returns whatever the
// queue ledger says about the job.
//
// When the integration ships:
//   - The POST body will accept { jobId } (claiming a queued row).
//   - The handler will call HeyGen's /v2/video/generate, store
//     heygenJobId for polling, flip status to 'processing'.
//   - A separate cron will poll active jobs and write videoUrl
//     + thumbnailUrl + durationSeconds when they complete.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { heygenJobs, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEnabled(): boolean {
  return (
    process.env.HEYGEN_ENABLED === 'true' &&
    Boolean(process.env.HEYGEN_API_KEY)
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'HeyGen integration not enabled yet.',
        errorKind: 'feature_disabled',
        retry: false,
        hint: 'Tu video está en cola. Cuando habilitemos la integración con HeyGen te notificamos y se procesa automáticamente.',
      },
      { status: 503 },
    );
  }

  // Unreachable today — kept so the wire shape is documented for
  // when the integration ships.
  let body: { jobId?: unknown };
  try {
    body = (await request.json()) as { jobId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.jobId !== 'string' || !UUID_RE.test(body.jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  // Ownership check via the project — heygen_jobs.userId is set
  // at insert time but defense-in-depth here.
  const [joined] = await db
    .select({ job: heygenJobs })
    .from(heygenJobs)
    .innerJoin(projects, eq(projects.id, heygenJobs.projectId))
    .where(
      and(eq(heygenJobs.id, body.jobId), eq(projects.userId, user.id)),
    )
    .limit(1);
  if (!joined) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    {
      success: false,
      error: 'HeyGen worker not implemented in this sprint.',
      errorKind: 'unknown',
      retry: false,
      hint: 'Architecture is ready, awaiting integration shipping.',
    },
    { status: 501 },
  );
}

// GET /api/heygen/generate-video?jobId=<uuid>
// Job-status read. Always available (no feature flag) so the UI
// can render badges without checking enablement first.
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
    .select({ job: heygenJobs })
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
    enabled: isEnabled(),
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
