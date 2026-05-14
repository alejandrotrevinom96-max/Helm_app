// PR Sprint 7.19 — Reddit disconnect.
//
// DELETE /api/integrations/reddit/disconnect
//
// Reddit IS an OAuth provider so we make a best-effort
// revocation call before dropping the DB row. Reddit's
// /api/v1/revoke_token endpoint accepts the access token + the
// app's client credentials (Basic auth) and returns 204 on
// success.
//
// The revocation is fire-and-forget: if it fails (network blip,
// expired token, Reddit returning 401) we still proceed with
// the DB delete so the user isn't left in a half-connected
// state.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/observability/logger';

async function revokeAtReddit(accessToken: string): Promise<void> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  try {
    await fetch('https://www.reddit.com/api/v1/revoke_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'helm-app/1.0',
      },
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: 'access_token',
      }).toString(),
    });
  } catch (e) {
    logger.warn('integrations/reddit/disconnect', 'revocation call failed', {
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

  // Load the row first so we can decrypt the access token for
  // the revocation call.
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.userId, user.id),
        eq(integrations.provider, 'reddit'),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  // Best-effort revocation. We don't await the result blocking
  // anything else — but we DO await it before deleting so the
  // call has a chance to authenticate with the token still
  // mapped in the DB (some providers cross-check by user).
  try {
    const accessToken = decrypt(row.encryptedAccessToken);
    await revokeAtReddit(accessToken);
  } catch (e) {
    // Decrypt failure shouldn't block the delete — the row is
    // stale either way. Log and proceed.
    logger.warn('integrations/reddit/disconnect', 'decrypt failed', {
      error: e,
    });
  }

  await db
    .delete(integrations)
    .where(
      and(
        eq(integrations.userId, user.id),
        eq(integrations.provider, 'reddit'),
      ),
    );

  logger.info('integrations/reddit/disconnect', 'token deleted', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
