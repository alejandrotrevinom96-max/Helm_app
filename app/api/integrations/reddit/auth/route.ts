// PR #58 — Sprint 7.0.2: kick off Reddit OAuth.
//
// Mirrors the Meta OAuth flow (PR #39): we issue an HMAC-signed
// state cookie containing userId + returnTo + timestamp, then 302
// the user to Reddit's authorization page. The callback verifies
// the state and exchanges the code for tokens.
//
// Scope is just `read` — we never post on the founder's behalf.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signState } from '@/lib/security/oauth-state';

function getRedirectUri(req: Request): string {
  const envUri = process.env.REDDIT_REDIRECT_URL;
  if (envUri) return envUri;
  // Derive from the request URL so localhost dev still works without
  // requiring REDDIT_REDIRECT_URL to be set per-environment.
  const url = new URL(req.url);
  return `${url.origin}/api/integrations/reddit/callback`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!process.env.REDDIT_CLIENT_ID) {
    return NextResponse.redirect(
      new URL(
        '/integrations?error=reddit_not_configured',
        request.url,
      ),
    );
  }

  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return') || '/integrations';

  const state = signState({
    userId: user.id,
    returnTo,
    timestamp: Date.now(),
    provider: 'reddit' as const,
  });

  // Reddit's authorize endpoint requires `duration=permanent` to get
  // back a refresh_token. Without it the access token expires after
  // 1h and we'd need to re-prompt the founder constantly.
  const authUrl = new URL('https://www.reddit.com/api/v1/authorize');
  authUrl.searchParams.set('client_id', process.env.REDDIT_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', getRedirectUri(request));
  authUrl.searchParams.set('duration', 'permanent');
  authUrl.searchParams.set('scope', 'read');

  return NextResponse.redirect(authUrl.toString());
}
