import { db } from '@/lib/db';
import {
  projects,
  waitlistPages,
  waitlistResponses,
  scheduledPosts,
  researchFindings,
  brandQuotes,
  type Project,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { BrandBible } from '@/lib/types/brand';
import type { TemplateConfig } from '@/lib/validate/defaults';

// All the signal we extract from Helm to feed the scoring engine. Form
// inputs from the wizard are merged in by `lib/compass/scoring.ts`.
export interface HelmData {
  project: Project;
  brandBible: BrandBible | null;

  // Validation evidence
  waitlistPagesCount: number;
  totalWaitlistResponses: number;
  uniqueWaitlistSignups: number;
  pricingTestResponses: Array<{ price: number; willingToPay: boolean }>;
  surveyResponses: Array<{ painText: string; createdAt: Date }>;

  // Strategic evidence
  hasTagline: boolean;
  taglineLength: number;
  hasArchetype: boolean;
  pillarsCount: number;
  competitorsConfigured: string[];

  // Execution evidence
  scheduledPostsLast30d: number;
  scheduledPostsLast7d: number;
  publishedPostsCount: number;
  daysSinceLastPost: number | null;
  brandQuotesCount: number;

  // Traction evidence
  signupGrowthRate7d: number;
  signupGrowthRate30d: number;
  competitorMentions: number;
  ratedPostsWorkedCount: number;
  ratedPostsFloppedCount: number;

  // Brand bible completeness
  brandCompletionScore: number;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function pullHelmData(
  projectId: string,
  userId: string
): Promise<HelmData> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) throw new Error('Project not found');

  const bible = (project.brandContext as BrandBible | null) ?? null;

  // === Waitlist pages + responses ===
  const pages = await db
    .select()
    .from(waitlistPages)
    .where(eq(waitlistPages.projectId, projectId));
  const pageIds = pages.map((p) => p.id);

  const allResponses =
    pageIds.length > 0
      ? await db
          .select()
          .from(waitlistResponses)
          .where(inArray(waitlistResponses.waitlistPageId, pageIds))
      : [];

  const uniqueEmails = new Set(
    allResponses
      .map((r) => r.email?.toLowerCase().trim())
      .filter((e): e is string => !!e && e.length > 0)
  );

  // pricing-test template (PR #7) stores `commit: true` when the user
  // accepts the displayed price. The price + discount are in templateConfig.
  const pricingTestResponses: Array<{ price: number; willingToPay: boolean }> =
    [];
  for (const p of pages.filter((pg) => pg.template === 'pricing-test')) {
    const cfg = (p.templateConfig as TemplateConfig | null) ?? null;
    const price = cfg?.pricePerMonth ?? 0;
    const responsesForPage = allResponses.filter(
      (r) => r.waitlistPageId === p.id
    );
    for (const r of responsesForPage) {
      const respData = (r.responses as Record<string, unknown> | null) ?? {};
      // Multiple legacy field names — accept any "yes the price works" flag.
      const willing = !!(
        respData.commit ||
        respData.willingToPay ||
        respData.priceAccepted ||
        respData.accepted
      );
      pricingTestResponses.push({ price, willingToPay: willing });
    }
  }

  // survey-5q template (PR #4) stores answers as q0/q1/q2/q3/q4. We pull
  // q0 (typically the pain question) for evidence quotes — anything >20
  // chars counts as a substantive answer.
  const surveyResponses: Array<{ painText: string; createdAt: Date }> = [];
  for (const p of pages.filter((pg) => pg.template === 'survey-5q')) {
    const responsesForPage = allResponses.filter(
      (r) => r.waitlistPageId === p.id
    );
    for (const r of responsesForPage) {
      const respData = (r.responses as Record<string, unknown> | null) ?? {};
      const painText =
        (respData.q0 as string | undefined) ||
        (respData.q1 as string | undefined) ||
        (respData.pain as string | undefined) ||
        '';
      if (painText && painText.length > 20) {
        const createdAt = toDate(r.createdAt) ?? new Date();
        surveyResponses.push({ painText, createdAt });
      }
    }
  }

  // === Scheduled posts ===
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const projectScheduled = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, userId),
        eq(scheduledPosts.projectId, projectId)
      )
    );

  const last30d = projectScheduled.filter((p) => {
    const d = toDate(p.createdAt);
    return d != null && d >= thirtyDaysAgo;
  });
  const last7d = projectScheduled.filter((p) => {
    const d = toDate(p.createdAt);
    return d != null && d >= sevenDaysAgo;
  });
  const published = projectScheduled.filter(
    (p) => p.status === 'posted' || p.status === 'notified'
  );

  const lastPost = projectScheduled
    .map((p) => ({ p, d: toDate(p.createdAt) }))
    .filter((x): x is { p: typeof projectScheduled[number]; d: Date } => x.d !== null)
    .sort((a, b) => b.d.getTime() - a.d.getTime())[0];
  const daysSinceLastPost = lastPost
    ? Math.floor(
        (now.getTime() - lastPost.d.getTime()) / (24 * 60 * 60 * 1000)
      )
    : null;

  // Performance ratings (PR #13)
  const ratedWorked = projectScheduled.filter(
    (p) => p.performanceRating === 'worked'
  ).length;
  const ratedFlopped = projectScheduled.filter(
    (p) => p.performanceRating === 'flopped'
  ).length;

  // === Brand quotes ===
  const quotes = await db
    .select({ id: brandQuotes.id })
    .from(brandQuotes)
    .where(eq(brandQuotes.projectId, projectId));

  // === Traction: signup growth ===
  const signupsLast7d = allResponses.filter((r) => {
    const d = toDate(r.createdAt);
    return d !== null && d >= sevenDaysAgo;
  }).length;
  const signupsPrev7d = allResponses.filter((r) => {
    const d = toDate(r.createdAt);
    return d !== null && d < sevenDaysAgo && d >= fourteenDaysAgo;
  }).length;
  const signupGrowthRate7d =
    signupsPrev7d > 0
      ? ((signupsLast7d - signupsPrev7d) / signupsPrev7d) * 100
      : signupsLast7d > 0
        ? 100
        : 0;

  const signupsLast30d = allResponses.filter((r) => {
    const d = toDate(r.createdAt);
    return d !== null && d >= thirtyDaysAgo;
  }).length;
  const signupsPrev30d = allResponses.filter((r) => {
    const d = toDate(r.createdAt);
    return d !== null && d < thirtyDaysAgo && d >= sixtyDaysAgo;
  }).length;
  const signupGrowthRate30d =
    signupsPrev30d > 0
      ? ((signupsLast30d - signupsPrev30d) / signupsPrev30d) * 100
      : signupsLast30d > 0
        ? 100
        : 0;

  // === Research: competitor mentions + configured competitors ===
  const findings = await db
    .select()
    .from(researchFindings)
    .where(eq(researchFindings.projectId, projectId));
  const competitorMentions = findings.filter((f) => f.competitor != null).length;

  const competitorSet = new Set<string>();
  for (const f of findings) {
    if (f.competitor) competitorSet.add(f.competitor);
  }

  return {
    project,
    brandBible: bible,
    waitlistPagesCount: pages.length,
    totalWaitlistResponses: allResponses.length,
    uniqueWaitlistSignups: uniqueEmails.size,
    pricingTestResponses,
    surveyResponses,
    hasTagline: !!bible?.identity?.tagline,
    taglineLength: bible?.identity?.tagline?.length ?? 0,
    hasArchetype: !!bible?.archetype?.primary,
    pillarsCount: bible?.pillars?.length ?? 0,
    competitorsConfigured: Array.from(competitorSet),
    scheduledPostsLast30d: last30d.length,
    scheduledPostsLast7d: last7d.length,
    publishedPostsCount: published.length,
    daysSinceLastPost,
    brandQuotesCount: quotes.length,
    signupGrowthRate7d: Math.round(signupGrowthRate7d),
    signupGrowthRate30d: Math.round(signupGrowthRate30d),
    competitorMentions,
    ratedPostsWorkedCount: ratedWorked,
    ratedPostsFloppedCount: ratedFlopped,
    brandCompletionScore: bible?.meta?.completionScore ?? 0,
  };
}
