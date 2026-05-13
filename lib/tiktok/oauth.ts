// PR #87 — Sprint 7.11: TikTok OAuth 2.0 (Login Kit + Content Posting API).
//
// Two scopes we request:
//   - user.info.basic — open_id, display_name, avatar_url
//   - video.upload    — Upload to Inbox (does NOT require TikTok
//                       audit; videos land in the founder's drafts
//                       inbox to publish manually from the app)
//
// We deliberately do NOT request video.publish — that's the
// Direct Post scope which requires TikTok's audit (4-8 weeks
// approval). Upload to Inbox is the unaudited, ship-today path
// for solo founders.
//
// Token + endpoint shapes are pinned to TikTok's v2 Content
// Posting API. State is signed via lib/security/oauth-state (same
// HMAC helper Meta + LinkedIn use). Re-using OAUTH_STATE_KEY so
// the founder doesn't need yet another env var.

export const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL =
  'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_USERINFO_URL =
  'https://open.tiktokapis.com/v2/user/info/';

export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload'];

export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number; // seconds, typically 86400 (24h)
  open_id: string;
  refresh_token: string;
  refresh_expires_in: number; // seconds, typically 31536000 (365d)
  scope: string;
  token_type: string; // 'Bearer'
  // Error shape (when the call fails): error + error_description.
  error?: string;
  error_description?: string;
  log_id?: string;
}

export interface TikTokUserInfoResponse {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
    };
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

export function getClientCredentials(): {
  clientKey: string;
  clientSecret: string;
} {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error(
      'TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET must both be set',
    );
  }
  return { clientKey, clientSecret };
}

export function isTikTokConfigured(): boolean {
  return Boolean(
    process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET,
  );
}

// Derive the OAuth callback URL from the request. The env var
// TIKTOK_REDIRECT_URI wins when set (production), and we fall
// back to a request-origin path so localhost dev works without
// per-env setup. The redirect_uri sent to TikTok in /authorize/
// MUST byte-match the one sent to /token/, hence the helper.
export function getRedirectUri(req: Request): string {
  const envUri = process.env.TIKTOK_REDIRECT_URI;
  if (envUri) return envUri;
  const url = new URL(req.url);
  return `${url.origin}/api/integrations/tiktok/callback`;
}

export function buildAuthUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  const { clientKey } = getClientCredentials();
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: TIKTOK_SCOPES.join(','),
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  redirectUri: string;
}): Promise<TikTokTokenResponse> {
  const { clientKey, clientSecret } = getClientCredentials();
  // TikTok's token endpoint expects application/x-www-form-
  // urlencoded — JSON returns 400.
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: opts.code,
      grant_type: 'authorization_code',
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `TikTok token exchange failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as TikTokTokenResponse;
  if (body.error) {
    throw new Error(
      `TikTok token exchange error: ${body.error} - ${body.error_description ?? 'no description'}`,
    );
  }
  if (!body.access_token || !body.refresh_token || !body.open_id) {
    throw new Error(
      'TikTok token response missing access_token / refresh_token / open_id',
    );
  }
  return body;
}

export async function refreshAccessToken(opts: {
  refreshToken: string;
}): Promise<TikTokTokenResponse> {
  const { clientKey, clientSecret } = getClientCredentials();
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `TikTok token refresh failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as TikTokTokenResponse;
  if (body.error) {
    throw new Error(
      `TikTok token refresh error: ${body.error} - ${body.error_description ?? 'no description'}`,
    );
  }
  return body;
}

export async function fetchUserInfo(
  accessToken: string,
): Promise<NonNullable<TikTokUserInfoResponse['data']>['user']> {
  // TikTok's user/info endpoint requires the fields= query param;
  // omitting it returns a generic envelope without `user`.
  const url = new URL(TIKTOK_USERINFO_URL);
  url.searchParams.set('fields', 'open_id,union_id,avatar_url,display_name');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `TikTok user/info failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as TikTokUserInfoResponse;
  if (body.error?.code && body.error.code !== 'ok') {
    throw new Error(
      `TikTok user/info error: ${body.error.code} - ${body.error.message ?? 'no message'}`,
    );
  }
  return body.data?.user ?? {};
}
