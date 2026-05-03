import { createClient, createServiceClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { users, integrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/onboarding';

  if (!code) {
    return redirect(`/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    console.error('Auth error:', error);
    return redirect(`/login?error=auth_failed`);
  }

  const user = data.user;
  const session = data.session;
  const githubMeta = user.user_metadata;
  const providerToken = session.provider_token; // GitHub access token

  // Upsert user record in our DB
  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email!,
      githubUsername: githubMeta?.user_name || githubMeta?.preferred_username,
      githubId: githubMeta?.provider_id ? parseInt(githubMeta.provider_id) : undefined,
      name: githubMeta?.full_name || githubMeta?.name,
      avatarUrl: githubMeta?.avatar_url,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        githubUsername: githubMeta?.user_name || githubMeta?.preferred_username,
        avatarUrl: githubMeta?.avatar_url,
      },
    });

  // Save GitHub access token (encrypted)
  if (providerToken) {
    await db
      .insert(integrations)
      .values({
        userId: user.id,
        provider: 'github',
        encryptedAccessToken: encrypt(providerToken),
        scope: 'read:user user:email repo',
      })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: {
          encryptedAccessToken: encrypt(providerToken),
          updatedAt: new Date(),
        },
      });
  }

  // Check if user has completed onboarding
  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (dbUser?.hasCompletedOnboarding) {
    return redirect('/analytics');
  }

  return redirect(next);
}
