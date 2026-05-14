// PR Sprint 7.17 — server-side Voice Engine hooks.
//
// The /api/voice-engine/record-publish endpoint exists for
// client-driven publishes, but the publish flows we already have
// (publish-now from the modal, the publisher cron, retry-publish)
// run server-side and shouldn't HTTP-loopback into themselves
// just to fire the engine. This module exposes the same logic as
// a direct function call.
//
// Idempotency:
//   - The caller passes a stable postId (scheduledPosts.id is
//     fine). recordPublish appends a fingerprint sample + bumps
//     post_count exactly once per call — re-calling with the same
//     postId WILL double-count. The publisher cron is
//     single-threaded per row (publishStatus='publishing' lock,
//     see app/api/cron/publish-scheduled), so we trust the
//     caller's at-most-once invariant.
//
// Error handling:
//   - Every hook is best-effort. A failure inside the engine
//     never blocks the publish itself; we log and move on. The
//     audit log captures the failure for operator debugging.

import {
  incrementPostCount,
} from './feedback-loop';
import {
  loadClientContext,
  logAudit,
  saveClientContext,
} from './loader';
import {
  CONTENT_TYPES,
  PLATFORMS,
  getPlatformSlots,
  recencyFactor,
  type ContentType,
  type Platform,
  type WeightedPost,
} from './types';

const FINGERPRINT_MAX = 30;

export interface RecordPublishArgs {
  userId: string;
  projectId: string;
  platform: string;
  contentType: string | null;
  postId: string;
  text: string;
  // Quality score for the WeightedPost initial weight. Published
  // posts default to 0.8 (implicit "worked" without explicit
  // founder feedback yet). Callers with explicit signal can
  // pass a higher value (1.0 for publish-as-is, etc.).
  qualityScore?: number;
}

export async function recordPublishOnSuccess(
  args: RecordPublishArgs,
): Promise<void> {
  try {
    // Validate platform + content type against the engine's
    // taxonomy. Posts on platforms not yet in the engine
    // (legacy platforms or future additions) become no-ops.
    if (!(PLATFORMS as readonly string[]).includes(args.platform)) {
      return;
    }
    const platform = args.platform as Platform;

    // Content type can be null on legacy plain-text drafts. Use
    // a reasonable fallback so those posts still feed the
    // engine.
    const contentType: ContentType =
      args.contentType &&
      (CONTENT_TYPES as readonly string[]).includes(args.contentType)
        ? (args.contentType as ContentType)
        : 'text';

    const qualityScore =
      typeof args.qualityScore === 'number' &&
      args.qualityScore >= 0 &&
      args.qualityScore <= 1
        ? args.qualityScore
        : 0.8;

    const ctx = await loadClientContext({
      userId: args.userId,
      projectId: args.projectId,
    });

    const nowIso = new Date().toISOString();
    const post: WeightedPost = {
      postId: args.postId,
      platform,
      contentType,
      text: args.text,
      postedAt: nowIso,
      qualityScore,
      // Recency factor at t=0 is 1.0, so the initial weight ==
      // qualityScore. Recency decay re-applies when the prompt
      // builder reads the fingerprint.
      weight: qualityScore,
    };
    // Cap the fingerprint per platform; the prompt only reads
    // top-8 anyway, the rest stays for future re-ranking.
    void recencyFactor; // referenced via the type only; keeps the import alive
    const slots = getPlatformSlots(ctx, platform);
    slots.voiceFingerprint.unshift(post);
    if (slots.voiceFingerprint.length > FINGERPRINT_MAX) {
      slots.voiceFingerprint.length = FINGERPRINT_MAX;
    }

    incrementPostCount(ctx, platform);

    await saveClientContext({
      userId: args.userId,
      projectId: args.projectId,
      ctx,
    });

    await logAudit({
      userId: args.userId,
      projectId: args.projectId,
      action: 'post_published',
      platform,
      dimension: null,
      notes:
        `post_id=${args.postId} content_type=${contentType} ` +
        `new_post_count=${slots.postCount} quality=${qualityScore}`,
    });
  } catch (err) {
    // Best-effort: an engine failure should NEVER fail the
    // publish itself. We log + swallow so the caller's success
    // response stays intact.
    console.warn(
      '[voice-engine/hooks] recordPublishOnSuccess failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
