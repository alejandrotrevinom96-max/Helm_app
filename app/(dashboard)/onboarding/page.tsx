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

  // Get GitHub token (optional in PR #33+).
  const [githubIntegration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, 'github')))
    .limit(1);

  // PR #33 — Sprint 6.1: users who signed up via email or Google
  // don't have a GitHub integration. Pre-PR-33 we kicked them back
  // to /login with ?error=no_github — confusing because they DID
  // sign in successfully. Now we render the OnboardingClient with
  // empty candidates + a flag so it shows a "no GitHub — add a
  // project manually" CTA. Avoids redirect loops with downstream
  // dashboard pages that require an active project.
  if (!githubIntegration) {
    return (
      <OnboardingClient
        candidates={[]}
        scanError={null}
        userId={user.id}
        noGithub
      />
    );
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
