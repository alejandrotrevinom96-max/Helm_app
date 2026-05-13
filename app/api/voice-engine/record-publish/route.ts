// PR Sprint 7.16 — Voice Engine: record-publish endpoint.
//
// POST /api/voice-engine/record-publish
// Body: {
//   projectId: string,
//   platform: Platform,
//   contentType: ContentType,
//   postId: string,
//   text: string,
//   qualityScore?: number  // 0..1, defaults 0.8 (published without
//                          // explicit feedback ≈ implicit "worked")
// }
//
// Two side effects on the ClientContext:
//   1. increment post_count on the (platform) slots — drives the
//      maturity stage progression (new → early → growing → mature).
//   2. append the post to voice_fingerprint as a WeightedPost.
//      Weight starts at qualityScore × recencyFactor(post).
//
// Idempotent-ish: re-posting the same postId appends a second
// fingerprint sample + double-increments. Caller is responsible
// for calling exactly once per published post. Matches the
// Python contract.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { incrementPostCount } from '@/lib/voice-engine/feedback-loop';
import {
  loadClientContext,
  logAudit,
  saveClientContext,
} from '@/lib/voice-engine/loader';
import {
  CONTENT_TYPES,
  PLATFORMS,
  getPlatformSlots,
  recencyFactor,
  type ContentType,
  type Platform,
  type WeightedPost,
} from '@/lib/voice-engine/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cap the in-memory fingerprint at this many entries per platform.
// The prompt builder slices to 8 anyway; the rest are kept for
// re-ranking when better signals arrive (Phase 1.5 will trim
// stale entries explicitly).
const FINGERPRINT_MAX = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    projectId?: unknown;
    platform?: unknown;
    contentType?: unknown;
    postId?: unknown;
    text?: unknown;
    qualityScore?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.projectId !== 'string' || !UUID_RE.test(body.projectId)) {
    return NextResponse.json(
      { error: 'Invalid projectId' },
      { status: 400 },
    );
  }
  if (
    typeof body.platform !== 'string' ||
    !(PLATFORMS as readonly string[]).includes(body.platform)
  ) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }
  if (
    typeof body.contentType !== 'string' ||
    !(CONTENT_TYPES as readonly string[]).includes(body.contentType)
  ) {
    return NextResponse.json(
      { error: 'Invalid contentType' },
      { status: 400 },
    );
  }
  if (typeof body.postId !== 'string' || !UUID_RE.test(body.postId)) {
    return NextResponse.json({ error: 'Invalid postId' }, { status: 400 });
  }
  if (typeof body.text !== 'string' || body.text.length === 0) {
    return NextResponse.json(
      { error: 'text required (non-empty string)' },
      { status: 400 },
    );
  }
  const qualityScore =
    typeof body.qualityScore === 'number' &&
    body.qualityScore >= 0 &&
    body.qualityScore <= 1
      ? body.qualityScore
      : 0.8;

  const projectId = body.projectId;
  const platform = body.platform as Platform;
  const contentType = body.contentType as ContentType;
  const postId = body.postId;
  const text = body.text;

  const ctx = await loadClientContext({ userId: user.id, projectId });

  // Append to the voice fingerprint with initial weight =
  // qualityScore × recency factor (1.0 at t=0). Cap the array
  // so we don't grow unbounded over months of activity.
  const post: WeightedPost = {
    postId,
    platform,
    contentType,
    text,
    postedAt: new Date().toISOString(),
    qualityScore,
    weight: qualityScore * recencyFactor({
      postId,
      platform,
      contentType,
      text,
      postedAt: new Date().toISOString(),
      qualityScore,
      weight: 1,
    }),
  };
  const slots = getPlatformSlots(ctx, platform);
  slots.voiceFingerprint.unshift(post);
  if (slots.voiceFingerprint.length > FINGERPRINT_MAX) {
    slots.voiceFingerprint.length = FINGERPRINT_MAX;
  }

  // Bump post_count → may advance maturity stage.
  incrementPostCount(ctx, platform);

  await saveClientContext({ userId: user.id, projectId, ctx });

  // Audit (operator-visible).
  await logAudit({
    userId: user.id,
    projectId,
    action: 'post_published',
    platform,
    dimension: null,
    notes: `post_id=${postId} content_type=${contentType} new_post_count=${slots.postCount} maturity=${ctx.platforms[platform]!.postCount > 60 ? 'mature' : ctx.platforms[platform]!.postCount > 20 ? 'growing' : ctx.platforms[platform]!.postCount > 8 ? 'early' : 'new'}`,
  });

  return NextResponse.json({
    success: true,
    postCount: slots.postCount,
    fingerprintSize: slots.voiceFingerprint.length,
  });
}
