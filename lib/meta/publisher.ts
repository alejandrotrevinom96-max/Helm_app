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

export interface PublishResult {
  success: boolean;
  metaPostId?: string;
  permalink?: string;
  error?: string;
  // Used by the retry scheduler — only retry when the failure looks
  // recoverable (rate limits, transient outages). Auth failures and
  // content-policy rejections shouldn't be retried.
  isTransient?: boolean;
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
      if (!post.visualUrl) {
        return {
          success: false,
          error:
            'Instagram requires an image. Add a visual to this post before retrying.',
          isTransient: false,
        };
      }

      // Reuse a previously-created container if a prior attempt got
      // that far — saves a call on retry and avoids burning the
      // 24h container window twice.
      let containerId = post.metaContainerId ?? null;
      if (!containerId) {
        const container = await client.createInstagramContainer(
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

      const published = await client.publishInstagramContainer(
        integration.instagramBusinessId,
        containerId
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
