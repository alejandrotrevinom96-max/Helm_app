// PR #66 — Sprint 7.0.9: kick off LinkedIn OAuth.
//
// Same HMAC-signed state pattern as Reddit (Sprint 7.0.2) and Meta
// (Sprint 6.5). We embed projectId so the callback knows which
// project's linkedin_integrations row to upsert.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signState } from '@/lib/security/oauth-state';
import { buildAuthUrl, getRedirectUri } from '@/lib/linkedin/oauth';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!process.env.LINKEDIN_CLIENT_ID) {
    return NextResponse.redirect(
      new URL(
        '/integrations?error=linkedin_not_configured',
        request.url,
      ),
    );
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  if (!UUID_RE.test(projectId)) {
    return NextResponse.redirect(
      new URL(
        '/integrations?error=linkedin_missing_project',
        request.url,
      ),
    );
  }

  const returnTo = url.searchParams.get('return') ?? '/integrations';

  const state = signState({
    userId: user.id,
    projectId,
    returnTo,
    timestamp: Date.now(),
    provider: 'linkedin' as const,
  });

  return NextResponse.redirect(
    buildAuthUrl({ state, redirectUri: getRedirectUri(request) }),
  );
}
