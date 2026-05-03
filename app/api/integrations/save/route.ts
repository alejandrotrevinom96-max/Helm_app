import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { NextResponse } from 'next/server';

// Saves the per-account credential (one row per user+provider). Per-project
// mappings (which Vercel project / Supabase ref / Meta ad account belongs to
// each Helm project) are configured separately via /api/integrations/map-project,
// because one user account can map to many distinct remote projects.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider, token } = await request.json();
  if (!['vercel', 'supabase', 'meta'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const encryptedToken = encrypt(token);

  await db
    .insert(integrations)
    .values({
      userId: user.id,
      provider,
      encryptedAccessToken: encryptedToken,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: {
        encryptedAccessToken: encryptedToken,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}
