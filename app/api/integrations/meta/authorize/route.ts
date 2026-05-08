// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// GET /api/integrations/meta/authorize?projectId=…
//
// Kicks off the Meta OAuth flow. Builds the redirect URL with the
// scopes we actually need (no over-requesting; Meta App Review
// rejects apps that ask for permissions they don't use), encodes a
// state blob carrying user_id + project_id + timestamp for CSRF +
// callback context, and 302s the browser to facebook.com.
//
// Returns 503 (not 500) when the operator hasn't set the Meta env
// vars — that's a configuration problem, not a server bug, and a
// dedicated status code lets the UI show a clearer "admin needs to
// set this up" message.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { signState } from '@/lib/security/oauth-state';

// Scopes — keep this list MINIMAL. Meta App Review explicitly rejects
// apps that request permissions they don't exercise.
const META_SCOPES = [
  'pages_show_list', // list user's pages
  'pages_read_engagement', // read page metadata
  'pages_manage_posts', // post on behalf of pages
  'instagram_basic', // basic IG info
  'instagram_content_publish', // publish IG media
  'business_management', // resolve IG Business ↔ FB Page
];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  // Project ownership — prevents a forged projectId from binding the
  // OAuth result to someone else's project on callback.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!process.env.META_APP_ID || !process.env.META_REDIRECT_URL) {
    return NextResponse.json(
      {
        error:
          'Meta integration is not configured on this server. The operator must set META_APP_ID, META_APP_SECRET, and META_REDIRECT_URL in the environment.',
      },
      { status: 503 }
    );
  }

  // PR #39 Sprint 6.5: HMAC-sign the state. Pre-PR-39 the state
  // was a plain base64-encoded JSON blob — defended by the
  // callback's userId / Supabase-session check, but unsigned. Now
  // we sign with HMAC-SHA256 so the callback refuses any state
  // that didn't come from this server.
  const state = signState({
    userId: user.id,
    projectId,
    timestamp: Date.now(),
  });

  const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  authUrl.searchParams.set('client_id', process.env.META_APP_ID);
  authUrl.searchParams.set('redirect_uri', process.env.META_REDIRECT_URL);
  authUrl.searchParams.set('scope', META_SCOPES.join(','));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(authUrl.toString());
}
