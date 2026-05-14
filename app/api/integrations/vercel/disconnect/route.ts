// PR Sprint 7.19 — Vercel disconnect.
//
// DELETE /api/integrations/vercel/disconnect
//
// Drops the user's row from `integrations` where provider='vercel'.
// Vercel tokens are simple API keys (not OAuth) — there's no
// remote revocation endpoint we'd want to call; the user can
// rotate the token in their Vercel dashboard if they need to
// fully invalidate the credential.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { logger } from '@/lib/observability/logger';

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await db
    .delete(integrations)
    .where(
      and(
        eq(integrations.userId, user.id),
        eq(integrations.provider, 'vercel'),
      ),
    )
    .returning({ id: integrations.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  logger.info('integrations/vercel/disconnect', 'token deleted', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
