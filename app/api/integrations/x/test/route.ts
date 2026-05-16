// PR #65 — Sprint 7.0.8: verify X credentials are live.
// PR Sprint B-finish: surface per-user soft-disconnect state.
//
// Authed founder-only endpoint. Calls the X /me endpoint via the
// stored env credentials and surfaces the username if it works,
// or the underlying error string if it doesn't. Useful for the
// Integrations page card ("✓ Connected as @foo") and for debugging
// after rotating credentials.
//
// `optedOut` is true when the founder has soft-disconnected via
// /api/integrations/x/disconnect — the deploy-wide creds may
// still be live, but the founder has explicitly chosen to not
// have Helm publish on their behalf. The card uses this to show
// a "Connect X" CTA instead of the green CONNECTED chip.
import { createClient } from '@/lib/supabase/server';
import { isXConfigured, whoAmI } from '@/lib/x/client';
import { isUserOptedOut } from '@/lib/integrations/opt-outs';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check the soft-disconnect flag BEFORE hitting the X API —
  // saves an unnecessary upstream call when the founder has
  // already opted out.
  const optedOut = await isUserOptedOut(user.id, 'x');

  if (!isXConfigured()) {
    return NextResponse.json({
      configured: false,
      optedOut,
      hint: 'Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in Vercel env vars.',
    });
  }

  // Deploy-wide creds ARE set but this founder opted out — skip
  // the upstream check and let the UI render the Connect-X CTA.
  if (optedOut) {
    return NextResponse.json({
      configured: true,
      optedOut: true,
    });
  }

  try {
    const me = await whoAmI();
    return NextResponse.json({
      configured: true,
      optedOut: false,
      username: me.username,
      id: me.id,
    });
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        optedOut: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
}
