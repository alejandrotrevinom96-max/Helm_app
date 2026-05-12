// PR #74 — Sprint 7.2B Step 5: First content (the "wow moment").
//
// Server shell — resolves the primary project + checks for a
// top pain point from the prior step's research extraction so the
// client has a concrete topic to feed Opus instead of a generic
// "intro post".
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  projects,
  onboardingProgress,
  researchInsights,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { FirstContentClient } from './client';

interface ServerPainPoint {
  theme?: unknown;
  actionableAngle?: unknown;
  sampleQuote?: unknown;
}

export default async function OnboardingFirstContentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Same three-tier project resolution as step 4.
  const [progress] = await db
    .select({
      primaryProjectId: onboardingProgress.primaryProjectId,
      brandAnswers: onboardingProgress.brandAnswers,
    })
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);

  let projectId = progress?.primaryProjectId ?? null;
  if (!projectId) {
    const [latest] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.createdAt))
      .limit(1);
    if (latest) projectId = latest.id;
  }
  if (!projectId) {
    redirect('/onboarding/project');
  }

  // Top pain point — feed it as the prompt seed. Defensive shape
  // checking because the painPoints jsonb is free-form across rows.
  const [insight] = await db
    .select({ painPoints: researchInsights.painPoints })
    .from(researchInsights)
    .where(eq(researchInsights.projectId, projectId))
    .orderBy(desc(researchInsights.createdAt))
    .limit(1);

  let seedPrompt: string | null = null;
  const points = Array.isArray(insight?.painPoints)
    ? (insight!.painPoints as ServerPainPoint[])
    : [];
  if (points.length > 0) {
    const top = points[0];
    const angle =
      typeof top.actionableAngle === 'string' && top.actionableAngle.trim()
        ? top.actionableAngle
        : null;
    const theme =
      typeof top.theme === 'string' && top.theme.trim() ? top.theme : null;
    if (angle && theme) {
      seedPrompt = `${theme} — ${angle}`;
    } else if (angle) {
      seedPrompt = angle;
    } else if (theme) {
      seedPrompt = theme;
    }
  }

  // Fallback to the founder's brand-step answers if research didn't
  // produce anything usable.
  if (!seedPrompt) {
    const ans =
      (progress?.brandAnswers as Record<string, unknown> | null) ?? {};
    if (typeof ans.niche === 'string' && ans.niche.trim()) {
      seedPrompt = `Primer post para introducir el brand a la audiencia: ${ans.niche}`;
    } else {
      seedPrompt =
        'Primer post para introducir mi brand a su audiencia primaria.';
    }
  }

  return (
    <FirstContentClient projectId={projectId} seedPrompt={seedPrompt} />
  );
}
