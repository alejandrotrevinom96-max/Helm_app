// PR #66 — Sprint 7.0.9: per-project LinkedIn status. Returns the
// connected handle + scopes + expiry so the LinkedInCard can
// surface "✓ Connected as <Name>" vs "Reconnect" with a concrete
// reason (missing scope, expired token).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { linkedinIntegrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { parseScopes } from '@/lib/linkedin/oauth';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [row] = await db
    .select({
      linkedinName: linkedinIntegrations.linkedinName,
      linkedinHandle: linkedinIntegrations.linkedinHandle,
      tokenExpiresAt: linkedinIntegrations.tokenExpiresAt,
      scopes: linkedinIntegrations.scopes,
      status: linkedinIntegrations.status,
      lastUsedAt: linkedinIntegrations.lastUsedAt,
    })
    .from(linkedinIntegrations)
    .where(eq(linkedinIntegrations.projectId, projectId))
    .limit(1);

  if (!row) {
    return NextResponse.json({
      configured: !!process.env.LINKEDIN_CLIENT_ID,
      connected: false,
      hint: process.env.LINKEDIN_CLIENT_ID
        ? 'Click Connect LinkedIn to authorize.'
        : 'Server missing LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET env vars.',
    });
  }

  // PR #79 — Sprint 7.5.1 hotfix: lazy-normalize the scopes column
  // for rows written by the pre-hotfix callback. Those rows stored
  // a single-element array like
  //   ['openid,profile,email,w_member_social']
  // instead of the parsed four-element array. parseScopes accepts
  // both shapes (string OR string[]) and re-splits, so existing
  // users get the correct hasWriteScope=true without having to
  // re-authorize. The write path is also fixed in the callback so
  // new auths land normalized.
  const scopes = parseScopes(row.scopes as string[] | string | null);
  const hasWriteScope = scopes.includes('w_member_social');
  const expired = row.tokenExpiresAt
    ? new Date(row.tokenExpiresAt).getTime() < Date.now()
    : false;

  // Best-effort: persist the normalized array back to the row so
  // the next read is a clean lookup, not a re-parse. Fire-and-
  // forget — a write failure here is non-fatal because the
  // response already carries the correct shape.
  const wasRawString =
    Array.isArray(row.scopes) &&
    row.scopes.length === 1 &&
    typeof row.scopes[0] === 'string' &&
    row.scopes[0].includes(',');
  if (wasRawString) {
    void db
      .update(linkedinIntegrations)
      .set({ scopes, updatedAt: new Date() })
      .where(eq(linkedinIntegrations.projectId, projectId))
      .catch(() => {
        /* non-fatal */
      });
  }

  return NextResponse.json({
    configured: !!process.env.LINKEDIN_CLIENT_ID,
    connected: true,
    name: row.linkedinName,
    handle: row.linkedinHandle,
    expiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    scopes,
    hasWriteScope,
    expired,
    healthy: !expired && hasWriteScope && row.status === 'connected',
  });
}
