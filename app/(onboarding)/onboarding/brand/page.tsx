// PR #74 — Sprint 7.2B Step 3: Brand context.
//
// Server shell — hydrates the client with whatever the founder
// already entered in step 2 (the oneLiner doubles as a "niche"
// hint) and any prior brand-step answers from a previous wizard
// attempt. Keeps the form pre-filled across browser refreshes.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { onboardingProgress } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BrandClient } from './client';

export default async function OnboardingBrandPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [progress] = await db
    .select({ brandAnswers: onboardingProgress.brandAnswers })
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);

  const prior =
    (progress?.brandAnswers as Record<string, unknown> | null) ?? {};
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

  return (
    <BrandClient
      initialNiche={asStr(prior.niche) || asStr(prior.oneLiner)}
      initialAudience={asStr(prior.audience)}
      initialTone={asStr(prior.tone)}
    />
  );
}
