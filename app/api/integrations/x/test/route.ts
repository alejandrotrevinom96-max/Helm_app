// PR #65 — Sprint 7.0.8: verify X credentials are live.
//
// Authed founder-only endpoint. Calls the X /me endpoint via the
// stored env credentials and surfaces the username if it works,
// or the underlying error string if it doesn't. Useful for the
// Integrations page card ("✓ Connected as @foo") and for debugging
// after rotating credentials.
import { createClient } from '@/lib/supabase/server';
import { isXConfigured, whoAmI } from '@/lib/x/client';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isXConfigured()) {
    return NextResponse.json({
      configured: false,
      hint: 'Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in Vercel env vars.',
    });
  }

  try {
    const me = await whoAmI();
    return NextResponse.json({
      configured: true,
      username: me.username,
      id: me.id,
    });
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
}
