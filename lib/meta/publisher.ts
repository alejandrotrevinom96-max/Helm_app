// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// Publishes a single scheduled_posts row to Meta. Called by:
//   - the cron worker when scheduledFor passes
//   - the /retry-publish endpoint when the user retries manually
//
// IMPORTANT: scheduled_posts.platform is a single string in this
// schema (not an array). We branch on that string:
//   'facebook'  → post to FB Page
//   'instagram' → post to IG Business (requires image)
//   anything else (linkedin, threads, reddit) → "platform not yet
//     supported" — those land in a future sprint.
//
// We also ping any non-FB/IG platform back to caller as a permanent
// failure (isTransient: false) so the retry loop doesn't waste
// budget on unsupported types.
import { db } from '@/lib/db';
import { scheduledPosts, metaIntegrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { MetaGraphClient, MetaApiError } from './graph-client';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { isXConfigured, postTweet, postThread } from '@/lib/x/client';

export interface PublishResult {
  success: boolean;
  metaPostId?: string;
  permalink?: string;
  error?: string;
  // Used by the retry scheduler — only retry when the failure looks
  // recoverable (rate limits, transient outages). Auth failures and
  // content-policy rejections shouldn't be retried.
  isTransient?: boolean;
  // PR #32 — Sprint 5.3: Reels create a container synchronously but
  // need polling before /media_publish. publishPost returns
  // pendingPolling=true after creating the container; the cron
  // worker won't mark the row as failed and the dedicated poll-reels
  // cron picks it up. The first round of Reel creation isn't a
  // "publish failure" — it's "publish delayed", so we need a flag.
  pendingPolling?: boolean;
  // Set by publishReelAfterProcessing when the container is still
  // processing. Tells the polling cron to leave the row in
  // meta_processing and reschedule, not flip to failed.
  stillProcessing?: boolean;
}

// Backoff schedule. Index = retry count we're about to enter (0-based:
// after first failure we go to delays[0], etc). Capped at 3 retries.
const RETRY_DELAYS_SECONDS = [60, 300, 1800]; // 1min · 5min · 30min
export const MAX_RETRIES = 3;

export function calculateNextRetry(retryCount: number): Date {
  const idx = Math.min(
    Math.max(retryCount - 1, 0),
    RETRY_DELAYS_SECONDS.length - 1
  );
  return new Date(Date.now() + RETRY_DELAYS_SECONDS[idx] * 1000);
}

// IG container processing is async on Meta's side. We poll briefly
// before calling /media_publish to avoid "container not ready" errors.
// Total wait capped at ~10s; if it's still not FINISHED we surrender.
async function waitForInstagramContainer(
  client: MetaGraphClient,
  containerId: string
): Promise<{ ready: boolean; reason?: string }> {
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 6;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const status = await client.getInstagramContainerStatus(containerId);
      if (status.status_code === 'FINISHED') {
        return { ready: true };
      }
      if (
        status.status_code === 'ERROR' ||
        status.status_code === 'EXPIRED'
      ) {
        return {
          ready: false,
          reason: `IG container ${status.status_code.toLowerCase()}`,
        };
      }
      // IN_PROGRESS / PUBLISHED → keep polling
    } catch {
      // Single failed poll isn't fatal; keep going. The /media_publish
      // call will surface a real error if the container is genuinely
      // broken.
    }
  }
  return { ready: false, reason: 'IG container did not finish in time' };
}

export async function publishPost(postId: string): Promise<PublishResult> {
  const [post] = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.id, postId))
    .limit(1);
  if (!post) {
    return { success: false, error: 'Post not found', isTransient: false };
  }

  // PR #65 — Sprint 7.0.8: X (Twitter) publishes outside Meta —
  // dispatch BEFORE loading the Meta integration so projects
  // without an FB Page can still post tweets. The schedule
  // endpoint validated content shape; we just call the API here.
  if (post.platform === 'x') {
    return await publishToX(post);
  }

  const [integration] = await db
    .select()
    .from(metaIntegrations)
    .where(
      and(
        eq(metaIntegrations.projectId, post.projectId),
        eq(metaIntegrations.status, 'connected')
      )
    )
    .limit(1);
  if (!integration) {
    return {
      success: false,
      error: 'No active Meta integration for this project',
      isTransient: false,
    };
  }
  if (!integration.facebookPageAccessToken) {
    return {
      success: false,
      error: 'Integration has no access token',
      isTransient: false,
    };
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decryptToken(integration.facebookPageAccessToken);
  } catch {
    return {
      success: false,
      error: 'Token decryption failed — re-connect the integration',
      isTransient: false,
    };
  }

  const client = new MetaGraphClient(pageAccessToken);
  const platform = post.platform;

  // PR #64 — Sprint 7.0.7: structured-draft contentType dispatch.
  //
  // The schedule endpoint already refuses to schedule contentTypes
  // we can't auto-publish (Carousel without slide images, UGC video,
  // LinkedIn/Reddit/Threads/X, etc.) — but defense-in-depth: if a
  // row slips through (e.g. legacy schedule from before the
  // validation, or a contentType we add later), fail PERMANENT here
  // so the founder sees a clear reason instead of cryptic Meta
  // errors after each retry.
  // PR #65 — Sprint 7.0.8: dispatch refuses tightened. Carousel + X
  // now have real handlers (below for Carousel; lib/x/client.ts for
  // X — invoked from the X branch further down). LinkedIn / Reddit /
  // Threads / UGC remain refused with concrete reasons until each
  // platform's integration lands.
  const ct = post.contentType;
  if (ct === 'ugc') {
    return {
      success: false,
      error:
        'UGC video auto-publish needs HeyGen integration (planned). Copy the script and record manually.',
      isTransient: false,
    };
  }
  if (ct === 'self_post' || ct === 'link_post') {
    return {
      success: false,
      error:
        'Reddit publishing isn\'t wired yet. Copy the title + body and post manually.',
      isTransient: false,
    };
  }
  if (
    (ct === 'text_post' && platform === 'linkedin') ||
    ct === 'single_image'
  ) {
    return {
      success: false,
      error:
        'LinkedIn auto-publish isn\'t wired yet. Sprint 7.0.9 will add this. Copy the post and paste manually.',
      isTransient: false,
    };
  }
  // Reel / Photo / FB-photo / FB text / Carousel / X flow through
  // to the platform-specific paths below. Anything else with
  // contentType=null is the legacy pillar-variant flow — passes
  // through as well.

  try {
    // ===== FACEBOOK =====
    if (platform === 'facebook') {
      if (!integration.facebookPageId) {
        return {
          success: false,
          error: 'Integration is missing a Facebook Page id',
          isTransient: false,
        };
      }
      let resultId: string;
      if (post.visualUrl) {
        const r = await client.postImageToPage(
          integration.facebookPageId,
          post.visualUrl,
          post.content
        );
        resultId = r.post_id ?? r.id;
      } else {
        const r = await client.postTextToPage(
          integration.facebookPageId,
          post.content
        );
        resultId = r.id;
      }
      let permalink: string | undefined;
      try {
        const link = await client.getFacebookPostPermalink(resultId);
        permalink = link.permalink_url;
      } catch {
        // Permalink fetch is best-effort; the post exists either way.
      }
      return { success: true, metaPostId: resultId, permalink };
    }

    // ===== INSTAGRAM =====
    if (platform === 'instagram') {
      if (!integration.instagramBusinessId) {
        return {
          success: false,
          error:
            'No Instagram Business account is linked to this Meta integration. Connect IG to your FB Page first.',
          isTransient: false,
        };
      }

      // PR #32 — Sprint 5.3: Reels. Async flow — we ONLY create the
      // container here, then hand off to the polling cron. The cron
      // (poll-reels) waits for status_code=FINISHED before calling
      // /media_publish. Returning pendingPolling=true tells the
      // outer cron worker not to flip publishStatus to failed.
      if (post.isReel === true) {
        if (!post.videoUrl) {
          return {
            success: false,
            error:
              'Reels require a video. Upload one in Generate before scheduling.',
            isTransient: false,
          };
        }
        // Reuse a container if a previous attempt already created
        // one — saves a Graph API call on retry and avoids burning
        // the 24h container window twice.
        let containerId = post.metaContainerId ?? null;
        if (!containerId) {
          const container = await client.createInstagramReelContainer(
            integration.instagramBusinessId,
            post.videoUrl,
            post.content
          );
          containerId = container.id;
          await db
            .update(scheduledPosts)
            .set({
              metaContainerId: containerId,
              metaTargetType: 'instagram_reel',
              reelProcessingStatus: 'meta_processing',
              reelPollingAttempts: 0,
              // First poll in 30s — Meta typically needs at least
              // that long to start processing.
              reelPollingNextAt: new Date(Date.now() + 30 * 1000),
            })
            .where(eq(scheduledPosts.id, postId));
        }
        return {
          success: true,
          pendingPolling: true,
        };
      }

      // PR #65 — Sprint 7.0.8: Carousel branch. Sits between Reel
      // and the single-image Photo/Story branch because it short-
      // circuits the visualUrl check (carousels use visualUrls).
      // Three-step posting per IG's API:
      //   1. Create one child container per slide image with
      //      is_carousel_item=true.
      //   2. Create a parent CAROUSEL container referencing the
      //      child IDs.
      //   3. /media_publish on the parent.
      // We persist the parent containerId in metaContainerId so
      // retries within the 24h container window skip steps 1+2.
      if (post.contentType === 'carousel') {
        const urls = (post.visualUrls as string[] | null) ?? [];
        if (urls.length < 2) {
          return {
            success: false,
            error:
              'Carousel needs at least 2 slide images. Generate them first ("Generate slides" button on the draft).',
            isTransient: false,
          };
        }
        if (urls.length > 10) {
          return {
            success: false,
            error:
              'Instagram supports a maximum of 10 carousel slides.',
            isTransient: false,
          };
        }
        if (urls.some((u) => typeof u !== 'string' || u.length === 0)) {
          return {
            success: false,
            error:
              'One or more slide image URLs are empty. Regenerate the slides.',
            isTransient: false,
          };
        }

        let parentContainerId = post.metaContainerId ?? null;
        if (!parentContainerId) {
          // Step 1: child containers (one per slide).
          const childIds: string[] = [];
          for (const imageUrl of urls) {
            const child = await client.createInstagramCarouselItemContainer(
              integration.instagramBusinessId,
              imageUrl,
            );
            childIds.push(child.id);
          }
          // Step 2: parent carousel container.
          const parent = await client.createInstagramCarouselContainer(
            integration.instagramBusinessId,
            childIds,
            post.content,
          );
          parentContainerId = parent.id;
          await db
            .update(scheduledPosts)
            .set({
              metaContainerId: parentContainerId,
              metaTargetType: 'instagram_feed',
            })
            .where(eq(scheduledPosts.id, postId));
        }

        // Wait for the parent to finish processing. The same
        // helper used for single-image posts; carousel containers
        // share the status_code lifecycle.
        const wait = await waitForInstagramContainer(client, parentContainerId);
        if (!wait.ready) {
          return {
            success: false,
            error: wait.reason ?? 'Carousel container not ready',
            isTransient: !(wait.reason ?? '').includes('expired'),
          };
        }

        // Step 3: publish.
        const published = await client.publishInstagramContainer(
          integration.instagramBusinessId,
          parentContainerId,
        );

        let permalink: string | undefined;
        try {
          const link = await client.getInstagramMediaPermalink(published.id);
          permalink = link.permalink;
        } catch {
          // best-effort
        }
        return { success: true, metaPostId: published.id, permalink };
      }

      if (!post.visualUrl) {
        return {
          success: false,
          error:
            'Instagram requires an image. Add a visual to this post before retrying.',
          isTransient: false,
        };
      }

      // PR #30 — Sprint 5.2: Stories. When isStory is true we hit
      // the STORIES container path, otherwise the regular feed
      // path (Sprint 5.1 behaviour). Both flows share the
      // 2-step container + media_publish + permalink-fetch shape;
      // the differences are baked into the Graph client methods.
      const isStory = post.isStory === true;

      let containerId = post.metaContainerId ?? null;
      if (!containerId) {
        const container = isStory
          ? await client.createInstagramStoryContainer(
              integration.instagramBusinessId,
              post.visualUrl
            )
          : await client.createInstagramContainer(
              integration.instagramBusinessId,
              post.visualUrl,
              post.content
            );
        containerId = container.id;
        // Persist immediately so a crash mid-publish doesn't lose it.
        await db
          .update(scheduledPosts)
          .set({ metaContainerId: containerId })
          .where(eq(scheduledPosts.id, postId));
      }

      const wait = await waitForInstagramContainer(client, containerId);
      if (!wait.ready) {
        return {
          success: false,
          error: wait.reason ?? 'IG container not ready',
          // EXPIRED is permanent; other reasons we treat as transient
          // so the retry loop tries again with a fresh container.
          isTransient: !(wait.reason ?? '').includes('expired'),
        };
      }

      const published = isStory
        ? await client.publishInstagramStory(
            integration.instagramBusinessId,
            containerId
          )
        : await client.publishInstagramContainer(
            integration.instagramBusinessId,
            containerId
          );

      let permalink: string | undefined;
      try {
        const link = isStory
          ? await client.getInstagramStoryPermalink(published.id)
          : await client.getInstagramMediaPermalink(published.id);
        permalink = link.permalink;
      } catch {
        // best-effort
      }

      // For Stories we also stamp the row with the 24h expiration
      // and the targetType so the Library + cron can distinguish.
      if (isStory) {
        const storyExpiresAt = new Date(
          Date.now() + 24 * 60 * 60 * 1000
        );
        await db
          .update(scheduledPosts)
          .set({
            storyExpiresAt,
            metaTargetType: 'instagram_story',
          })
          .where(eq(scheduledPosts.id, postId));
      }

      return { success: true, metaPostId: published.id, permalink };
    }

    // ===== UNSUPPORTED =====
    return {
      success: false,
      error: `Platform "${platform}" is not yet supported for auto-publishing. Only facebook and instagram are wired up in Sprint 5.1.`,
      isTransient: false,
    };
  } catch (e) {
    if (e instanceof MetaApiError) {
      return {
        success: false,
        error: e.message,
        isTransient: e.isTransient,
      };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      isTransient: false,
    };
  }
}

// PR #32 — Sprint 5.3: Reels post-processing publish.
//
// Called by /api/cron/poll-reels for rows with
// reelProcessingStatus='meta_processing'. Polls the container's
// status_code; if FINISHED, calls /media_publish and returns
// success+permalink. If still processing, returns
// stillProcessing=true so the cron can reschedule the next poll.
//
// Distinct entry point (vs publishPost) because:
//   - publishPost would re-create the container (bad — we'd waste
//     the existing one and confuse Meta).
//   - The polling logic + max-attempts cap belongs in this layer,
//     not the generic publishPost happy path.
export async function publishReelAfterProcessing(
  postId: string
): Promise<PublishResult> {
  const [post] = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.id, postId))
    .limit(1);
  if (!post) return { success: false, error: 'Post not found' };
  if (!post.metaContainerId) {
    return { success: false, error: 'No Meta container id on row' };
  }

  const [integration] = await db
    .select()
    .from(metaIntegrations)
    .where(
      and(
        eq(metaIntegrations.projectId, post.projectId),
        eq(metaIntegrations.status, 'connected')
      )
    )
    .limit(1);
  if (!integration?.facebookPageAccessToken) {
    return {
      success: false,
      error: 'No active Meta integration',
      isTransient: false,
    };
  }
  if (!integration.instagramBusinessId) {
    return {
      success: false,
      error: 'No Instagram Business id on integration',
      isTransient: false,
    };
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decryptToken(integration.facebookPageAccessToken);
  } catch {
    return { success: false, error: 'Token decryption failed' };
  }

  const client = new MetaGraphClient(pageAccessToken);

  try {
    const status = await client.getInstagramReelStatus(post.metaContainerId);

    if (status.status_code === 'IN_PROGRESS') {
      return {
        success: false,
        error: 'Reel still processing on Meta',
        isTransient: true,
        stillProcessing: true,
      };
    }
    if (status.status_code === 'ERROR') {
      return {
        success: false,
        error: status.status ?? 'Reel processing returned ERROR',
        isTransient: false,
      };
    }
    if (status.status_code === 'EXPIRED') {
      return {
        success: false,
        error:
          'Reel container expired (24h window). Re-upload the video and reschedule.',
        isTransient: false,
      };
    }
    if (
      status.status_code !== 'FINISHED' &&
      status.status_code !== 'PUBLISHED'
    ) {
      return {
        success: false,
        error: `Unexpected status: ${status.status_code}`,
        isTransient: true,
        stillProcessing: true,
      };
    }

    // FINISHED → publish.
    const published = await client.publishInstagramReel(
      integration.instagramBusinessId,
      post.metaContainerId
    );
    let permalink: string | undefined;
    try {
      const link = await client.getInstagramReelPermalink(published.id);
      permalink = link.permalink;
    } catch {
      // best-effort
    }
    return { success: true, metaPostId: published.id, permalink };
  } catch (e) {
    if (e instanceof MetaApiError) {
      return {
        success: false,
        error: e.message,
        isTransient: e.isTransient,
      };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      isTransient: false,
    };
  }
}

// PR #65 — Sprint 7.0.8: X (Twitter) publisher. Uses lib/x/client
// which wraps twitter-api-v2 with the founder's OAuth 1.0a creds.
// X publishing doesn't share state with the Meta integrations
// table — credentials live in env vars (X is one account per
// deployment for now; multi-account support is a follow-up).
async function publishToX(
  post: typeof scheduledPosts.$inferSelect,
): Promise<PublishResult> {
  if (!isXConfigured()) {
    return {
      success: false,
      error:
        'X (Twitter) credentials not configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.',
      isTransient: false,
    };
  }
  const ct = post.contentType;
  const sc = post.structuredContent as Record<string, unknown> | null;

  try {
    if (ct === 'single_tweet' || !ct) {
      const text =
        (typeof sc?.content === 'string' && sc.content) || post.content;
      if (!text || text.length > 280) {
        return {
          success: false,
          error: `Tweet body must be 1-280 chars (was ${text?.length ?? 0}).`,
          isTransient: false,
        };
      }
      const result = await postTweet(text);
      return { success: true, metaPostId: result.id, permalink: result.url };
    }

    if (ct === 'thread') {
      const tweetsRaw = (sc?.tweets ?? []) as unknown[];
      const tweets = tweetsRaw.filter(
        (t): t is string => typeof t === 'string' && t.length > 0,
      );
      if (tweets.length === 0) {
        return {
          success: false,
          error: 'Thread body is empty. Regenerate the draft.',
          isTransient: false,
        };
      }
      const tooLong = tweets.findIndex((t) => t.length > 280);
      if (tooLong !== -1) {
        return {
          success: false,
          error: `Thread tweet ${tooLong + 1} is over 280 chars.`,
          isTransient: false,
        };
      }
      const result = await postThread(tweets);
      return {
        success: true,
        metaPostId: result.rootId,
        permalink: result.rootUrl,
      };
    }

    return {
      success: false,
      error: `X contentType "${ct}" isn't supported yet.`,
      isTransient: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 429 == rate limit (transient); the cron's retry policy will
    // back off. Everything else (auth 401, malformed 400) is
    // permanent — surface the API error string to the founder.
    const isRateLimit = /\b429\b|rate.?limit/i.test(msg);
    return {
      success: false,
      error: `X publish failed: ${msg.slice(0, 200)}`,
      isTransient: isRateLimit,
    };
  }
}
