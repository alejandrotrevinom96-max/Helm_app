// PR Sprint 7.19 — TikTok disconnect.
//
// DELETE /api/integrations/tiktok/disconnect
//
// TikTok is user-scoped (one tiktok_integrations row per user)
// and supports remote revocation via /v2/oauth/revoke/. Same
// fire-and-forget pattern as the LinkedIn + Reddit endpoints:
// best-effort revoke, then drop the DB row regardless.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { tiktokIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/observability/logger';

async function revokeAtTikTok(accessToken: string): Promise<void> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return;
  try {
    await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        token: accessToken,
      }).toString(),
    });
  } catch (e) {
    logger.warn('integrations/tiktok/disconnect', 'revocation call failed', {
      error: e,
    });
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [row] = await db
    .select()
    .from(tiktokIntegrations)
    .where(eq(tiktokIntegrations.userId, user.id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  try {
    const accessToken = decrypt(row.accessTokenEncrypted);
    await revokeAtTikTok(accessToken);
  } catch (e) {
    logger.warn('integrations/tiktok/disconnect', 'decrypt failed', {
      error: e,
    });
  }

  await db
    .delete(tiktokIntegrations)
    .where(eq(tiktokIntegrations.userId, user.id));

  logger.info('integrations/tiktok/disconnect', 'integration deleted', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
