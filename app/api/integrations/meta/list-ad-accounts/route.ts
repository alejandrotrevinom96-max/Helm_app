import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { listAdAccounts } from '@/lib/integrations/meta';
import { NextResponse } from 'next/server';

interface MetaAdAccount {
  id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [int] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, 'meta')))
    .limit(1);
  if (!int) return NextResponse.json({ accounts: [] });

  try {
    const token = decrypt(int.encryptedAccessToken);
    const accounts = (await listAdAccounts(token)) as MetaAdAccount[];
    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id ?? '',
        name: a.name ?? '',
        currency: a.currency ?? '',
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to list Meta ad accounts' }, { status: 500 });
  }
}
