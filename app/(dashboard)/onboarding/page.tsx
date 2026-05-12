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

  // PR #72 — Sprint 7.2A hotfix: pluck the pending brand URL the
  // landing-page hero stashed via signup user_metadata. If present,
  // the client auto-opens the manual project modal and pre-fills the
  // URL field — so a user who clicked "See full bible" on the landing
  // doesn't lose that intent across the email-confirmation hop.
  //
  // The fallback for OAuth signups (Google/GitHub) is the same path:
  // user_metadata travels with the OAuth session, so the URL persists
  // through any provider as long as it was set on signup.
  const meta = (user.user_metadata ?? {}) as { pending_brand_url?: string };
  const pendingBrandUrl =
    typeof meta.pending_brand_url === 'string' &&
    meta.pending_brand_url.trim().length > 0
      ? meta.pending_brand_url.trim().slice(0, 500)
      : null;

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
        pendingBrandUrl={pendingBrandUrl}
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

  return (
    <OnboardingClient
      candidates={candidates}
      scanError={scanError}
      userId={user.id}
      pendingBrandUrl={pendingBrandUrl}
    />
  );
}
