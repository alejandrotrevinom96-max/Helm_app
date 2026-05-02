import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt } from '@/lib/crypto';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider, token, extra } = await request.json();
  if (!['vercel', 'supabase', 'meta'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const encryptedToken = encrypt(token);

  await db
    .insert(integrations)
    .values({
      userId: user.id,
      provider,
      encryptedAccessToken: encryptedToken,
      metadata: extra ? { extra } : undefined,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: {
        encryptedAccessToken: encryptedToken,
        metadata: extra ? { extra } : undefined,
        updatedAt: new Date(),
      },
    });

  // Auto-update user's projects with the relevant ID
  if (provider === 'supabase' && extra) {
    await db
      .update(projects)
      .set({ supabaseProjectRef: extra })
      .where(eq(projects.userId, user.id));
  }
  if (provider === 'meta' && extra) {
    await db
      .update(projects)
      .set({ metaAdAccountId: extra })
      .where(eq(projects.userId, user.id));
  }

  return NextResponse.json({ success: true });
}
