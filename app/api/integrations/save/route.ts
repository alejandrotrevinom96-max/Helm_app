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

  const { provider, token, extra, projectId } = await request.json();
  if (!['vercel', 'supabase', 'meta'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  // For per-project providers, the caller must specify which project the
  // extra value applies to, and we must verify it belongs to this user
  // before writing — otherwise a logged-in user could overwrite another
  // user's project, or accidentally overwrite all of their own projects.
  const needsProject = (provider === 'supabase' || provider === 'meta') && !!extra;
  if (needsProject) {
    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!owned) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
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

  if (provider === 'supabase' && extra) {
    await db
      .update(projects)
      .set({ supabaseProjectRef: extra })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  }
  if (provider === 'meta' && extra) {
    await db
      .update(projects)
      .set({ metaAdAccountId: extra })
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  }

  return NextResponse.json({ success: true });
}
