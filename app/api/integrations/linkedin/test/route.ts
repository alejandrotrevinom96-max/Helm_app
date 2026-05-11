// PR #66 — Sprint 7.0.9: per-project LinkedIn status. Returns the
// connected handle + scopes + expiry so the LinkedInCard can
// surface "✓ Connected as <Name>" vs "Reconnect" with a concrete
// reason (missing scope, expired token).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { linkedinIntegrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  const hasWriteScope = scopes.includes('w_member_social');
  const expired = row.tokenExpiresAt
    ? new Date(row.tokenExpiresAt).getTime() < Date.now()
    : false;

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
