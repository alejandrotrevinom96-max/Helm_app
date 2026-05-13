// PR #87 — Sprint 7.11: TikTok OAuth callback.
//
// Verifies the HMAC-signed state, enforces a 10-minute freshness
// window, exchanges the code for tokens, fetches the user profile
// so we can render "✓ Connected as @handle" in the UI, and
// upserts a row in `tiktok_integrations` keyed on userId.
//
// On any failure we redirect back to /integrations with a
// `?tiktok_error=` querystring so the TikTokCard banner can pick
// it up.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tiktokIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyState } from '@/lib/security/oauth-state';
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  getRedirectUri,
} from '@/lib/tiktok/oauth';
import { encryptToken } from '@/lib/crypto/token-encryption';
import { createClient } from '@/lib/supabase/server';

const STATE_TTL_MS = 10 * 60 * 1000;

interface TikTokOAuthState {
  userId: string;
  returnTo: string;
  timestamp: number;
  provider?: string;
}

function redirectErr(req: Request, code: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/integrations?tiktok_error=${encodeURIComponent(code)}`,
      req.url,
    ),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return redirectErr(request, oauthErr);
  if (!code || !state) return redirectErr(request, 'missing_params');

  const parsed = verifyState<TikTokOAuthState>(state);
  if (!parsed) return redirectErr(request, 'invalid_state');
  if (parsed.provider && parsed.provider !== 'tiktok') {
    return redirectErr(request, 'wrong_provider');
  }
  if (Date.now() - parsed.timestamp > STATE_TTL_MS) {
    return redirectErr(request, 'state_expired');
  }

  // Re-check the session — the state is HMAC-trusted but we want
  // to confirm the founder didn't sign out between authorize and
  // callback. Pre-PR-87 we trusted the state's userId alone; the
  // double-check is defense-in-depth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== parsed.userId) {
    return redirectErr(request, 'session_mismatch');
  }

  let tokens;
  let profile;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri: getRedirectUri(request),
    });
    profile = await fetchUserInfo(tokens.access_token);
  } catch (err) {
    console.error('[tiktok-callback] token/profile failed:', err);
    return redirectErr(request, 'token_exchange_failed');
  }

  if (!profile?.open_id) {
    return redirectErr(request, 'profile_missing_open_id');
  }

  const accessEnc = encryptToken(tokens.access_token);
  const refreshEnc = encryptToken(tokens.refresh_token);
  // TikTok returns expires_in in seconds. Stamp 30s early to
  // dodge clock skew on the client helper's "is it expired" check.
  const accessExpiresAt = new Date(
    Date.now() + (tokens.expires_in - 30) * 1000,
  );
  const refreshExpiresAt = new Date(
    Date.now() + tokens.refresh_expires_in * 1000,
  );

  await db
    .insert(tiktokIntegrations)
    .values({
      userId: parsed.userId,
      openId: profile.open_id,
      displayName: profile.display_name ?? null,
      avatarUrl: profile.avatar_url ?? null,
      accessTokenEncrypted: accessEnc,
      refreshTokenEncrypted: refreshEnc,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      scope: tokens.scope ?? null,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tiktokIntegrations.userId,
      set: {
        openId: profile.open_id,
        displayName: profile.display_name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        accessTokenExpiresAt: accessExpiresAt,
        refreshTokenExpiresAt: refreshExpiresAt,
        scope: tokens.scope ?? null,
        status: 'connected',
        lastError: null,
        updatedAt: new Date(),
      },
    });

  const returnTo = parsed.returnTo?.startsWith('/')
    ? parsed.returnTo
    : '/integrations';
  return NextResponse.redirect(
    new URL(`${returnTo}?tiktok=connected`, request.url),
  );
}
