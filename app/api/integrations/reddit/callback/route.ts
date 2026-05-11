// PR #58 — Sprint 7.0.2: Reddit OAuth callback.
//
// Verifies the HMAC-signed state, enforces the 10-minute freshness
// window (mirrors the Meta callback in PR #39), exchanges the code
// for tokens, and persists them encrypted in the existing
// `integrations` table.
//
// On any failure we redirect back to /integrations with an `?error=`
// querystring so the UI can surface a banner without exposing the
// exception details.
import { NextResponse } from 'next/server';
import { verifyState } from '@/lib/security/oauth-state';
import {
  exchangeCodeForTokens,
  saveRedditTokens,
} from '@/lib/integrations/reddit-oauth';

const STATE_TTL_MS = 10 * 60 * 1000;

function getRedirectUri(req: Request): string {
  const envUri = process.env.REDDIT_REDIRECT_URL;
  if (envUri) return envUri;
  const url = new URL(req.url);
  return `${url.origin}/api/integrations/reddit/callback`;
}

interface OAuthState {
  userId: string;
  returnTo: string;
  timestamp: number;
  provider?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(
      new URL(
        `/integrations?error=${encodeURIComponent(oauthError)}`,
        request.url,
      ),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/integrations?error=missing_params', request.url),
    );
  }

  const parsed = verifyState<OAuthState>(state);
  if (!parsed) {
    return NextResponse.redirect(
      new URL('/integrations?error=invalid_state', request.url),
    );
  }
  if (parsed.provider && parsed.provider !== 'reddit') {
    return NextResponse.redirect(
      new URL('/integrations?error=wrong_provider', request.url),
    );
  }
  if (Date.now() - parsed.timestamp > STATE_TTL_MS) {
    return NextResponse.redirect(
      new URL('/integrations?error=state_expired', request.url),
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, getRedirectUri(request));
    await saveRedditTokens(parsed.userId, tokens);
  } catch (err) {
    console.error('[reddit-callback] failed:', err);
    return NextResponse.redirect(
      new URL('/integrations?error=token_exchange_failed', request.url),
    );
  }

  const returnTo = parsed.returnTo?.startsWith('/')
    ? parsed.returnTo
    : '/integrations';
  return NextResponse.redirect(
    new URL(`${returnTo}?reddit=connected`, request.url),
  );
}
