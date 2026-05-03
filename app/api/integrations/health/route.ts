import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { listVercelProjects } from '@/lib/integrations/vercel';
import { listUserProjects } from '@/lib/integrations/supabase-mgmt';
import { listAdAccounts } from '@/lib/integrations/meta';
import { NextResponse } from 'next/server';

const HINTS: Record<string, string> = {
  vercel:
    'Use an Account Token from vercel.com/account/tokens with Full Account scope.',
  supabase:
    'Use a Personal Access Token from supabase.com/dashboard/account/tokens — NOT a service_role key, anon key, or DB connection string.',
  meta: 'Use a long-lived token from a Meta System User with ads_read scope. Short-lived user tokens expire after ~1 hour.',
};

const VALID_PROVIDERS = new Set(['vercel', 'supabase', 'meta']);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? '';
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid provider', hint: 'provider must be vercel, supabase, or meta' },
      { status: 400 }
    );
  }

  const [int] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, provider)))
    .limit(1);
  if (!int) {
    return NextResponse.json({
      ok: false,
      error: 'Not connected',
      hint: `Connect ${provider} in the Account credentials section first.`,
    });
  }

  let token: string;
  try {
    token = decrypt(int.encryptedAccessToken);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[HEALTH DECRYPT ERROR]', { provider, userId: user.id, error: detail });
    return NextResponse.json({
      ok: false,
      error: 'Stored token could not be decrypted',
      detail,
      hint:
        'ENCRYPTION_KEY may differ between environments. Replace the token to re-encrypt under the current key.',
    });
  }

  // Hit a cheap "list" endpoint per provider as the liveness probe — same call
  // the dropdowns use, so a green health check guarantees the dropdown will load.
  try {
    if (provider === 'vercel') {
      const list = await listVercelProjects(token);
      return NextResponse.json({ ok: true, count: list.length });
    }
    if (provider === 'supabase') {
      const list = (await listUserProjects(token)) as unknown[];
      return NextResponse.json({ ok: true, count: list.length });
    }
    if (provider === 'meta') {
      const list = (await listAdAccounts(token)) as unknown[];
      return NextResponse.json({ ok: true, count: list.length });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[HEALTH PROBE ERROR]', { provider, userId: user.id, error: detail });
    return NextResponse.json({
      ok: false,
      error: `${provider} probe failed`,
      detail,
      hint: HINTS[provider],
    });
  }

  return NextResponse.json({ ok: false, error: 'Unknown' });
}
