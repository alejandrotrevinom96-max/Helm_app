// PR #87 — Sprint 7.11: kick off TikTok OAuth.
//
// Same HMAC-signed state pattern as LinkedIn (Sprint 7.0.9) and
// Meta (Sprint 6.5). TikTok is USER-scoped (not project-scoped)
// because a founder usually has one personal TikTok handle that
// applies across all their projects — see the schema header
// comment on tiktok_integrations for the rationale.
//
// Founder setup checklist (one-time, before connecting):
//   1. Create a TikTok Developer app at developers.tiktok.com
//   2. Add Login Kit + Content Posting API products.
//   3. Request `video.upload` scope (granted instantly — does
//      NOT require audit).
//   4. Set the Redirect URI in the app dashboard to:
//        https://trythelm.com/api/integrations/tiktok/callback
//   5. Set env vars on Vercel:
//        TIKTOK_CLIENT_KEY
//        TIKTOK_CLIENT_SECRET
//        TIKTOK_REDIRECT_URI=https://trythelm.com/api/integrations/tiktok/callback
//   6. Click "Connect TikTok" on /integrations.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signState } from '@/lib/security/oauth-state';
import {
  buildAuthUrl,
  getRedirectUri,
  isTikTokConfigured,
} from '@/lib/tiktok/oauth';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!isTikTokConfigured()) {
    return NextResponse.redirect(
      new URL(
        '/integrations?tiktok_error=tiktok_not_configured',
        request.url,
      ),
    );
  }

  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return') ?? '/integrations';

  const state = signState({
    userId: user.id,
    returnTo,
    timestamp: Date.now(),
    provider: 'tiktok' as const,
  });

  return NextResponse.redirect(
    buildAuthUrl({ state, redirectUri: getRedirectUri(request) }),
  );
}
