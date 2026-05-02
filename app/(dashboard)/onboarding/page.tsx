import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { scanUserRepos } from '@/lib/integrations/github';
import { redirect } from 'next/navigation';
import { OnboardingClient } from './client';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get GitHub token
  const [githubIntegration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, 'github')))
    .limit(1);

  if (!githubIntegration) {
    return redirect('/login?error=no_github');
  }

  const token = decrypt(githubIntegration.encryptedAccessToken);

  // Scan repos
  let candidates: Awaited<ReturnType<typeof scanUserRepos>> = [];
  let scanError: string | null = null;
  try {
    candidates = await scanUserRepos(token);
  } catch (err) {
    scanError = err instanceof Error ? err.message : 'Unknown error';
  }

  return <OnboardingClient candidates={candidates} scanError={scanError} userId={user.id} />;
}
