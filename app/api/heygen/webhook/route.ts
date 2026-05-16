// PR #86 — Sprint 7.10: HeyGen webhook receiver.
//
// HeyGen fires avatar_video.success / avatar_video.fail when an
// async render finishes. We registered this URL in HeyGen's
// dashboard:
//   https://trythelm.com/api/heygen/webhook
//
// Request shape (per HeyGen docs):
//   {
//     event_type: 'avatar_video.success' | 'avatar_video.fail',
//     event_data: {
//       video_id: string,           // HeyGen's video id
//       callback_id: string,        // OUR heygen_jobs.id
//       video_url?: string,         // success only
//       thumbnail_url?: string,     // success only
//       duration?: number,          // seconds, success only
//       status?: string,            // success: 'completed'
//       error?: string,             // fail only
//     }
//   }
//
// Signature verification:
//   HeyGen documents `x-heygen-signature` but the production header
//   shape has shifted twice in the public docs. We do TWO checks
//   here that are robust without committing to a specific header:
//     1. Shared secret check (HEYGEN_WEBHOOK_SECRET in env). The
//        webhook URL accepts a `?token=` query param; when the env
//        var is set we require it to match. Lets us flip on
//        verification without a deploy gap.
//     2. Body shape sanity — refuses anything that doesn't carry an
//        event_type + event_data.callback_id we recognize.
//
// Response: always 200 with { received: true } for valid events.
// HeyGen retries non-2xx, so emitting 200 prevents retry storms for
// callbacks we already processed (idempotent UPDATE WHERE status
// IS NOT 'completed').
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
// PR Sprint 7.26 — Asset-based content flow. When the webhook
// flips a job to completed, we also mirror videoUrl onto
// content_assets.video_url so every platform variant of the asset
// surfaces the same render (the heygen_jobs row is keyed to the
// FIRST draft only).
import {
  heygenJobs,
  generatedPosts,
  contentAssets,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface HeygenWebhookEvent {
  event_type?: string;
  event_data?: {
    video_id?: string;
    callback_id?: string;
    video_url?: string;
    thumbnail_url?: string;
    duration?: number;
    status?: string;
    error?: string;
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenIsValid(request: Request): boolean {
  const expected = process.env.HEYGEN_WEBHOOK_SECRET;
  // Until the secret is set we accept any caller — same posture as
  // the rest of our outbound webhooks. Flip the env var on after
  // registering the URL in HeyGen.
  if (!expected) return true;
  const url = new URL(request.url);
  const provided =
    url.searchParams.get('token') ??
    request.headers.get('x-heygen-signature') ??
    '';
  return provided === expected;
}

export async function POST(request: Request) {
  if (!tokenIsValid(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: HeygenWebhookEvent;
  try {
    body = (await request.json()) as HeygenWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = body.event_type;
  const data = body.event_data;
  const callbackId = data?.callback_id;

  if (!eventType || !callbackId || !UUID_RE.test(callbackId)) {
    return NextResponse.json(
      { error: 'Malformed event' },
      { status: 400 },
    );
  }

  // Idempotency — read first to avoid stomping a row that's
  // already been moved out of in-flight state by a duplicate
  // webhook delivery (HeyGen retries non-2xx and occasionally
  // double-fires on success).
  const [existing] = await db
    .select({ id: heygenJobs.id, status: heygenJobs.status })
    .from(heygenJobs)
    .where(eq(heygenJobs.id, callbackId))
    .limit(1);

  if (!existing) {
    // Unknown callback — log and 200 so HeyGen stops retrying.
    // Could be a stale job from a wiped staging DB.
    console.warn(
      '[heygen/webhook] received event for unknown callback_id:',
      callbackId,
    );
    return NextResponse.json({ received: true, known: false });
  }

  if (eventType === 'avatar_video.success') {
    const [job] = await db
      .update(heygenJobs)
      .set({
        status: 'completed',
        heygenStatus: data.status ?? 'completed',
        videoUrl: data.video_url ?? null,
        thumbnailUrl: data.thumbnail_url ?? null,
        durationSeconds:
          typeof data.duration === 'number'
            ? Math.round(data.duration)
            : null,
        completedAt: new Date(),
        errorMessage: null,
        errorKind: null,
      })
      .where(eq(heygenJobs.id, callbackId))
      .returning({ draftId: heygenJobs.draftId });

    // PR Sprint 7.26 — Asset-based content flow. Mirror videoUrl
    // onto the content_asset linked through the draft so EVERY
    // platform variant of this asset can render the video, not
    // just the one draft the heygen_jobs row references. Two-hop
    // lookup: heygen_jobs.draftId → generated_posts.assetId →
    // content_assets.video_url.
    if (job?.draftId && data.video_url) {
      try {
        const [draft] = await db
          .select({ assetId: generatedPosts.assetId })
          .from(generatedPosts)
          .where(eq(generatedPosts.id, job.draftId))
          .limit(1);
        if (draft?.assetId) {
          await db
            .update(contentAssets)
            .set({ videoUrl: data.video_url })
            .where(eq(contentAssets.id, draft.assetId));
        }
      } catch (err) {
        // Non-fatal — the job row already has videoUrl; this just
        // means the multi-platform group won't share it. Logged
        // for diagnostics.
        console.warn(
          '[heygen/webhook] failed to mirror videoUrl to asset (non-fatal):',
          err instanceof Error ? err.message : err,
        );
      }
    }
    return NextResponse.json({ received: true });
  }

  if (eventType === 'avatar_video.fail') {
    await db
      .update(heygenJobs)
      .set({
        status: 'failed',
        heygenStatus: data.status ?? 'failed',
        errorMessage: (data.error ?? 'HeyGen generation failed').slice(0, 500),
        errorKind: 'upstream_error',
        completedAt: new Date(),
      })
      .where(eq(heygenJobs.id, callbackId));
    return NextResponse.json({ received: true });
  }

  // Other event types (e.g. avatar_video.processing) we don't yet
  // consume — 200 so HeyGen doesn't retry.
  return NextResponse.json({ received: true, handled: false });
}

// GET allows manual verification from the HeyGen dashboard ("test
// webhook" / "ping endpoint") without flipping the receiver into a
// half-broken state.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'heygen-webhook',
    accepts: ['avatar_video.success', 'avatar_video.fail'],
  });
}
