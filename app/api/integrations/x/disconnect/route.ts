// PR Sprint B-finish — X (Twitter) soft disconnect.
//
// DELETE /api/integrations/x/disconnect
//
// X publishes via deploy-wide OAuth 1.0a credentials in env vars
// (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN /
// X_ACCESS_TOKEN_SECRET). There's no per-user token to drop, so
// "disconnect" is a SOFT signal: we record an opt-out row scoped
// to (userId, 'x') and downstream surfaces (status check +
// publisher) consult it before reporting connected / firing API
// calls.
//
// Mirrors the Vercel disconnect endpoint shape (DELETE method,
// 401/404/200 contract) so DisconnectButton — which is shared
// across every integration card — works without provider-
// specific branching.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { setOptOut } from '@/lib/integrations/opt-outs';
import { logger } from '@/lib/observability/logger';

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await setOptOut(user.id, 'x');
  } catch (err) {
    logger.error('integrations/x/disconnect', 'opt-out insert failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Could not record disconnect' },
      { status: 500 },
    );
  }

  logger.info('integrations/x/disconnect', 'user opted out of X', {
    userId: user.id,
  });
  return NextResponse.json({ success: true });
}
