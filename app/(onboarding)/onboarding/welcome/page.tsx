// PR #74 — Sprint 7.2B Step 1: Welcome.
// Server shell: resolves the founder's display name + checks
// whether they've already completed onboarding (and if so kicks
// them straight to the dashboard). Hydrates the client with the
// name so the greeting is personal from first paint.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { WelcomeClient } from './client';

export default async function OnboardingWelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Skip-the-wizard for already-completed users. The layout above
  // has the same auth guard but doesn't check completion — we want
  // a returning user who manually types /onboarding/welcome to
  // bounce to their library, not re-run setup.
  const [dbUser] = await db
    .select({
      hasCompletedOnboarding: users.hasCompletedOnboarding,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (dbUser?.hasCompletedOnboarding) {
    redirect('/marketing/library');
  }

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
  };
  const userName =
    dbUser?.name ??
    meta.full_name ??
    meta.name ??
    user.email?.split('@')[0] ??
    'Founder';

  return <WelcomeClient userName={userName} />;
}
