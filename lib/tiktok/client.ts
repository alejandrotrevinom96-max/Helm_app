// PR #87 — Sprint 7.11: TikTok API client with auto-refresh.
//
// Single entrypoint `getValidAccessToken(userId)` that:
//   1. Reads the encrypted tokens from tiktok_integrations.
//   2. If access_token_expires_at is < now() + 5min, refreshes it
//      using the refresh_token (TikTok rotates aggressively;
//      24h is the standard access TTL).
//   3. If refresh_token_expires_at is past, flips the row to
//      status='expired' and surfaces an explicit error so the UI
//      can prompt re-auth.
//   4. Returns the decrypted access token ready to use.
//
// =====================================================================
// IMPORTANT — TikTok platform rules (Content Posting API):
//
//   • Do NOT add watermarks, logos, or promotional overlays to the
//     video. Helm sends videos to the inbox EXACTLY as HeyGen
//     produced them. Branding violates §2.6 of TikTok's developer
//     TOS and gets the app suspended.
//   • Videos must come from HeyGen clean (no Helm overlays).
//   • Rate limit: 6 requests / minute per user access token.
//     Callers are responsible for backing off — this helper does
//     NOT auto-throttle.
//   • Access tokens expire in 24h. Always go through
//     getValidAccessToken() — never decrypt + use the row's token
//     directly, you'll burn an upload after the first day.
// =====================================================================
import { db } from '@/lib/db';
import { tiktokIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  decryptToken,
  encryptToken,
} from '@/lib/crypto/token-encryption';
import { refreshAccessToken } from './oauth';

const REFRESH_SAFETY_MS = 5 * 60 * 1000;

export interface ValidTokenResult {
  accessToken: string;
  openId: string;
  expiresAt: Date;
}

export class TikTokAuthError extends Error {
  constructor(
    public code:
      | 'not_connected'
      | 'refresh_expired'
      | 'refresh_failed',
    message: string,
  ) {
    super(message);
    this.name = 'TikTokAuthError';
  }
}

export async function getValidAccessToken(
  userId: string,
): Promise<ValidTokenResult> {
  const [row] = await db
    .select()
    .from(tiktokIntegrations)
    .where(eq(tiktokIntegrations.userId, userId))
    .limit(1);

  if (!row) {
    throw new TikTokAuthError(
      'not_connected',
      'No TikTok connection for this user. Connect at /integrations.',
    );
  }

  if (row.status === 'expired' || row.status === 'disconnected') {
    throw new TikTokAuthError(
      'refresh_expired',
      'TikTok connection is expired or disconnected. Re-authorize at /integrations.',
    );
  }

  const now = Date.now();
  const accessExpiresMs = row.accessTokenExpiresAt.getTime();
  const refreshExpiresMs = row.refreshTokenExpiresAt.getTime();

  // Refresh token already expired → user must re-auth from
  // scratch. Mark the row so the UI doesn't keep trying.
  if (refreshExpiresMs <= now) {
    await db
      .update(tiktokIntegrations)
      .set({
        status: 'expired',
        lastError: 'Refresh token expired',
        updatedAt: new Date(),
      })
      .where(eq(tiktokIntegrations.id, row.id));
    throw new TikTokAuthError(
      'refresh_expired',
      'TikTok refresh token expired (>1 year). Re-authorize at /integrations.',
    );
  }

  // Access token still good (with a safety margin).
  if (accessExpiresMs - REFRESH_SAFETY_MS > now) {
    return {
      accessToken: decryptToken(row.accessTokenEncrypted),
      openId: row.openId,
      expiresAt: row.accessTokenExpiresAt,
    };
  }

  // Access token near or past expiry → refresh.
  const refreshToken = decryptToken(row.refreshTokenEncrypted);
  let refreshed;
  try {
    refreshed = await refreshAccessToken({ refreshToken });
  } catch (err) {
    await db
      .update(tiktokIntegrations)
      .set({
        status: 'failed',
        lastError:
          err instanceof Error
            ? err.message.slice(0, 500)
            : 'Refresh failed',
        updatedAt: new Date(),
      })
      .where(eq(tiktokIntegrations.id, row.id));
    throw new TikTokAuthError(
      'refresh_failed',
      err instanceof Error ? err.message : 'TikTok token refresh failed',
    );
  }

  const newAccessExpiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000 - 30000, // -30s clock skew
  );
  const newRefreshExpiresAt = new Date(
    Date.now() + refreshed.refresh_expires_in * 1000,
  );

  await db
    .update(tiktokIntegrations)
    .set({
      accessTokenEncrypted: encryptToken(refreshed.access_token),
      refreshTokenEncrypted: encryptToken(refreshed.refresh_token),
      accessTokenExpiresAt: newAccessExpiresAt,
      refreshTokenExpiresAt: newRefreshExpiresAt,
      scope: refreshed.scope ?? row.scope,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(tiktokIntegrations.id, row.id));

  return {
    accessToken: refreshed.access_token,
    openId: row.openId,
    expiresAt: newAccessExpiresAt,
  };
}

// ===== TikTok Content Posting API helpers =====

const TIKTOK_API = 'https://open.tiktokapis.com';

export interface InboxInitResponse {
  data?: {
    publish_id?: string;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

export interface PublishStatusResponse {
  data?: {
    status?: string; // 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'FAILED' | 'PUBLISH_COMPLETE'
    publicaly_available_post_id?: string[];
    uploaded_bytes?: number;
    fail_reason?: string;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

/**
 * Initialize an Upload-to-Inbox flow using PULL_FROM_URL.
 * TikTok fetches the video directly from `videoUrl` — we never
 * stream the bytes through Vercel.
 *
 * Requires the access token to have `video.upload` scope.
 */
export async function initInboxUpload(opts: {
  accessToken: string;
  videoUrl: string;
}): Promise<{ publishId: string }> {
  const res = await fetch(
    `${TIKTOK_API}/v2/post/publish/inbox/video/init/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: opts.videoUrl,
        },
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as InboxInitResponse;
  if (!res.ok || body.error?.code !== 'ok' || !body.data?.publish_id) {
    const msg =
      body.error?.message ??
      `TikTok inbox init returned HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { publishId: body.data.publish_id };
}

/**
 * Fetch the status of an in-flight or completed publish job.
 * Statuses we surface to the UI:
 *   PROCESSING_UPLOAD   → keep polling
 *   SEND_TO_USER_INBOX  → terminal success (video in inbox)
 *   FAILED              → terminal failure
 *   PUBLISH_COMPLETE    → user published from TikTok (we don't
 *                         transition to this; webhook-future)
 */
export async function fetchPublishStatus(opts: {
  accessToken: string;
  publishId: string;
}): Promise<{
  status: string;
  failReason: string | null;
}> {
  const res = await fetch(
    `${TIKTOK_API}/v2/post/publish/status/fetch/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: opts.publishId }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as PublishStatusResponse;
  if (!res.ok) {
    throw new Error(
      `TikTok status fetch returned HTTP ${res.status}: ${body.error?.message ?? ''}`,
    );
  }
  if (body.error?.code && body.error.code !== 'ok') {
    throw new Error(
      `TikTok status fetch error: ${body.error.code} - ${body.error.message ?? ''}`,
    );
  }
  return {
    status: body.data?.status ?? 'UNKNOWN',
    failReason: body.data?.fail_reason ?? null,
  };
}
