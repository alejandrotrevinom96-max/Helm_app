// PR Sprint B-finish — X (Twitter) soft reconnect.
//
// POST /api/integrations/x/reconnect
//
// Counterpart to /api/integrations/x/disconnect. Deletes the
// (userId, 'x') row from user_integration_opt_outs so the
// deploy-wide credentials become usable for this user again.
// Idempotent — re-running on an already-connected user is a
// no-op.
//
// We use POST (not PATCH or PUT) to match the established
// convention used by reddit/connect, linkedin/connect, etc. —
// "reconnect" is just "ensure connected for this user".

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { clearOptOut } from '@/lib/integrations/opt-outs';
import { logger } from '@/lib/observability/logger';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await clearOptOut(user.id, 'x');
  } catch (err) {
    logger.error('integrations/x/reconnect', 'opt-out delete failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Could not reconnect' },
      { status: 500 },
    );
  }

  logger.info('integrations/x/reconnect', 'user reconnected to X', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
