// PR Sprint 7.19 — Supabase disconnect.
//
// DELETE /api/integrations/supabase/disconnect
//
// Same shape as the Vercel disconnect — drops the user's row
// from `integrations` where provider='supabase'. Supabase
// management tokens have no remote revocation endpoint either;
// the user rotates from supabase.com/dashboard/account/tokens
// if they need a hard invalidation.
//
// Side effect: every project mapped to this Supabase ref still
// has its `supabaseProjectRef` + `supabaseTables` columns set.
// We deliberately DON'T null them here — the user might be
// rotating tokens, not abandoning Supabase. If they re-connect
// with a different account, the analytics fetcher will surface
// a mismatch error and they can re-map.
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
        eq(integrations.provider, 'supabase'),
      ),
    )
    .returning({ id: integrations.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  logger.info('integrations/supabase/disconnect', 'token deleted', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
