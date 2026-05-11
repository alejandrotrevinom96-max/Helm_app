// PR #66 — Sprint 7.0.9: LinkedIn OAuth 2.0 / OpenID Connect.
//
// Scopes:
//   - openid + profile + email — OpenID Connect basic identity
//   - w_member_social — post on the member's behalf (required for
//     /v2/ugcPosts). Approval is typically instant once the
//     "Share on LinkedIn" product is added to the app.
//
// Token + endpoint shapes are pinned to the canonical LinkedIn v2
// API. State is signed via lib/security/oauth-state (same HMAC
// helper Meta + Reddit use); the callback verifies + checks
// freshness before token exchange.
export const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
];

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface LinkedInProfile {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: { country?: string; language?: string };
}

export function buildAuthUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    throw new Error('LINKEDIN_CLIENT_ID env var missing');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: LINKEDIN_SCOPES.join(' '),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  redirectUri: string;
}): Promise<LinkedInTokenResponse> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET must both be set',
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as LinkedInTokenResponse;
}

export async function fetchUserinfo(
  accessToken: string,
): Promise<LinkedInProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `LinkedIn userinfo failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as LinkedInProfile;
}

// Derive the OAuth callback URL from the current request. Mirrors
// the pattern Reddit uses (Sprint 7.0.2) — `LINKEDIN_REDIRECT_URL`
// env wins if set, otherwise we use the request origin so
// localhost dev works without per-env setup.
export function getRedirectUri(req: Request): string {
  const envUri = process.env.LINKEDIN_REDIRECT_URL;
  if (envUri) return envUri;
  const url = new URL(req.url);
  return `${url.origin}/api/integrations/linkedin/callback`;
}
