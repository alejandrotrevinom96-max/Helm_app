// PR #58 — Sprint 7.0.2: Reddit OAuth helper.
//
// Reddit's public JSON API (https://www.reddit.com/...) blocks
// requests from cloud IPs (Vercel/AWS) silently — they return 200
// with an empty listing. The OAuth endpoint (https://oauth.reddit.com)
// accepts authenticated traffic from any IP, which is what we need
// for production discovery.
//
// We reuse the existing `integrations` table (PR #15) with
// `provider='reddit'` rather than adding a new table — same encrypted
// token shape, same auto-refresh affordance.
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/crypto';

export interface RedditTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope?: string;
  token_type?: string;
}

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

function getBasicAuth(): string {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      '[reddit-oauth] REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set',
    );
  }
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

export function getUserAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT ?? 'Helm/1.0 (indie-hacker marketing tool)'
  );
}

/**
 * Exchange an authorization code for tokens during the OAuth callback.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<RedditTokens> {
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as RedditTokens;
}

/**
 * Refresh an expired access token using the stored refresh_token.
 * Reddit's refresh response does NOT always return a new
 * refresh_token — only the access half.
 */
async function refreshTokens(refreshToken: string): Promise<RedditTokens> {
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as RedditTokens;
}

/**
 * Return a valid access token for the user, refreshing if needed.
 * Returns null when the user hasn't connected Reddit at all.
 *
 * Refresh window: 60s before declared expiry so a slow downstream
 * request doesn't fail with a token that expires mid-flight.
 */
export async function getRedditAccessToken(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(eq(integrations.userId, userId), eq(integrations.provider, 'reddit')),
    )
    .limit(1);

  if (!row) return null;

  const expiresSoon =
    row.expiresAt &&
    new Date(row.expiresAt).getTime() < Date.now() + 60_000;

  if (expiresSoon && row.encryptedRefreshToken) {
    try {
      const refreshToken = decrypt(row.encryptedRefreshToken);
      const fresh = await refreshTokens(refreshToken);
      const newAccessEnc = encrypt(fresh.access_token);
      // Reddit may rotate the refresh token. When it does, keep the
      // new one; when it doesn't (`refresh_token` absent), keep what
      // we have.
      const newRefreshEnc = fresh.refresh_token
        ? encrypt(fresh.refresh_token)
        : row.encryptedRefreshToken;
      await db
        .update(integrations)
        .set({
          encryptedAccessToken: newAccessEnc,
          encryptedRefreshToken: newRefreshEnc,
          expiresAt: new Date(Date.now() + (fresh.expires_in - 30) * 1000),
          scope: fresh.scope ?? row.scope,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, row.id));
      return fresh.access_token;
    } catch (err) {
      console.error('[reddit-oauth] refresh failed:', err);
      return null;
    }
  }

  try {
    return decrypt(row.encryptedAccessToken);
  } catch (err) {
    console.error('[reddit-oauth] decrypt failed:', err);
    return null;
  }
}

/**
 * Persist freshly-issued tokens after a successful OAuth callback.
 * Upserts on (userId, provider='reddit').
 */
export async function saveRedditTokens(
  userId: string,
  tokens: RedditTokens,
): Promise<void> {
  const encryptedAccess = encrypt(tokens.access_token);
  const encryptedRefresh = tokens.refresh_token
    ? encrypt(tokens.refresh_token)
    : null;
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000);

  const [existing] = await db
    .select()
    .from(integrations)
    .where(
      and(eq(integrations.userId, userId), eq(integrations.provider, 'reddit')),
    )
    .limit(1);

  if (existing) {
    await db
      .update(integrations)
      .set({
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh ?? existing.encryptedRefreshToken,
        expiresAt,
        scope: tokens.scope ?? existing.scope,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, existing.id));
    return;
  }

  await db.insert(integrations).values({
    userId,
    provider: 'reddit',
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    expiresAt,
    scope: tokens.scope ?? 'read',
  });
}

/**
 * Tiny fetch wrapper that handles the auth header + UA. Caller is
 * responsible for building the URL path.
 */
export async function redditApiFetch(
  accessToken: string,
  pathAndQuery: string,
): Promise<Response> {
  const base = 'https://oauth.reddit.com';
  return fetch(`${base}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': getUserAgent(),
    },
  });
}
