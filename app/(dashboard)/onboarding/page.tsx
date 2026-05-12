// PR #74 — Sprint 7.2B: thin redirect to the new 5-step wizard.
//
// Before PR #74 this page rendered the GitHub-repo-scan + manual
// OnboardingClient as the entire onboarding experience. The new
// wizard lives in the (onboarding) route group with no sidebar
// (see app/(onboarding)/layout.tsx) — but this URL `/onboarding`
// still has to handle the redirect from:
//   - the auth callback (`next ?? '/onboarding'`)
//   - the dashboard layout's "no project yet" guard
//   - any old link the founder might have bookmarked
//
// We resolve to the right step based on (a) the new
// onboarding_progress row if it exists, (b) the legacy
// `users.hasCompletedOnboarding` boolean for users from before
// this sprint. Existing users with the legacy flag set go
// straight to the dashboard; new users land at /onboarding/welcome.
//
// The old client.tsx file under this directory is now unused but
// kept so a bookmark to /onboarding doesn't 500 if the wizard
// pages somehow become unreachable. The build tree-shakes it
// since nothing imports it.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  users,
  onboardingProgress,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const VALID_STEPS = new Set([
  'welcome',
  'project',
  'brand',
  'research',
  'first-content',
]);

export default async function OnboardingIndex() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Tier 1 — new wizard progress row.
  const [progress] = await db
    .select({
      currentStep: onboardingProgress.currentStep,
      completedAt: onboardingProgress.completedAt,
    })
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);

  if (progress?.completedAt) {
    redirect('/marketing/library');
  }

  if (progress && VALID_STEPS.has(progress.currentStep)) {
    redirect(`/onboarding/${progress.currentStep}`);
  }

  // Tier 2 — legacy users from before PR #74. The dashboard
  // overlay wizard (components/onboarding/wizard.tsx) was the
  // previous flow; if they finished it (hasCompletedOnboarding =
  // true OR onboardingStep >= 99), we send them straight to the
  // library without re-running the new wizard.
  const [legacyUser] = await db
    .select({
      hasCompletedOnboarding: users.hasCompletedOnboarding,
      onboardingStep: users.onboardingStep,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (
    legacyUser?.hasCompletedOnboarding ||
    (legacyUser?.onboardingStep ?? 0) >= 99
  ) {
    redirect('/marketing/library');
  }

  // Tier 3 — brand new user (or one who started but never reached
  // step 1). Default to welcome.
  redirect('/onboarding/welcome');
}
