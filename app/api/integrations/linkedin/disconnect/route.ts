// PR Sprint 7.19 — LinkedIn disconnect.
//
// DELETE /api/integrations/linkedin/disconnect
// Body: { projectId: string }   (LinkedIn is project-scoped —
// each project has its own corporate LinkedIn page)
//
// LinkedIn has a revocation endpoint at /oauth/v2/revoke. Same
// fire-and-forget pattern as the Reddit disconnect: try to
// revoke remotely, then drop the row regardless.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { linkedinIntegrations } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/observability/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function revokeAtLinkedIn(accessToken: string): Promise<void> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;
  try {
    await fetch('https://www.linkedin.com/oauth/v2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: accessToken,
      }).toString(),
    });
  } catch (e) {
    logger.warn('integrations/linkedin/disconnect', 'revocation call failed', {
      error: e,
    });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Project id can come from the JSON body OR the query string.
  // Query string is the more conventional shape for DELETE
  // requests, but the DisconnectButton sends JSON-shaped
  // `body` for consistency with other endpoints — accept both.
  const url = new URL(request.url);
  let projectId = url.searchParams.get('projectId');
  if (!projectId) {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        projectId?: unknown;
      };
      if (typeof body.projectId === 'string') projectId = body.projectId;
    } catch {
      /* no-op */
    }
  }
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(linkedinIntegrations)
    .where(
      and(
        eq(linkedinIntegrations.userId, user.id),
        eq(linkedinIntegrations.projectId, projectId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  try {
    const accessToken = decrypt(row.accessTokenEncrypted);
    await revokeAtLinkedIn(accessToken);
  } catch (e) {
    logger.warn('integrations/linkedin/disconnect', 'decrypt failed', {
      error: e,
    });
  }

  await db
    .delete(linkedinIntegrations)
    .where(
      and(
        eq(linkedinIntegrations.userId, user.id),
        eq(linkedinIntegrations.projectId, projectId),
      ),
    );

  logger.info('integrations/linkedin/disconnect', 'integration deleted', {
    userId: user.id,
    projectId,
  });
  return NextResponse.json({ success: true });
}
