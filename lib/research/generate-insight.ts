import { db } from '@/lib/db';
import { projects, researchConfig, researchFindings } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import type { BrandBible } from '@/lib/types/brand';

export interface InsightResult {
  ok: true;
  insight: string;
}

export interface InsightError {
  ok: false;
  error: string;
  hint?: string;
}

// Build the project context block for the LLM. We prioritize the brand
// bible (PR #10) which has tagline / archetype / audience / pillars over
// `detectedStack` (which is just framework facts). Pre-PR-16 the fallback
// when no bible existed was the literal string "micro-SaaS for indie
// hackers" — that hardcoded text poisoned the prompt for non-tech projects
// (e.g. Voya, a travel app, was getting insights about "founder validation
// anxiety" because the LLM extrapolated from that fallback).
function buildProjectContext(params: {
  projectName: string;
  bible: BrandBible | null;
  keywords: string[];
  competitors: string[];
}): string {
  const { projectName, bible, keywords, competitors } = params;

  const lines: string[] = [`Name: ${projectName}`];
  if (bible?.identity?.tagline) lines.push(`Tagline: ${bible.identity.tagline}`);
  if (bible?.identity?.industry)
    lines.push(`Industry: ${bible.identity.industry}`);
  if (bible?.archetype?.primary)
    lines.push(`Archetype: ${bible.archetype.primary}`);
  const audienceDesc = bible?.audience?.primary?.description;
  if (audienceDesc) lines.push(`Audience: ${audienceDesc}`);
  const pillarNames = (bible?.pillars ?? []).map((p) => p.name).filter(Boolean);
  if (pillarNames.length > 0) lines.push(`Pillars: ${pillarNames.join(', ')}`);
  if (keywords.length > 0)
    lines.push(`Configured keywords: ${keywords.join(', ')}`);
  if (competitors.length > 0) {
    lines.push(`Configured competitors: ${competitors.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Generate a weekly research insight for a project and persist it on
 * researchConfig. Used by both the manual /api/research/synthesize endpoint
 * (auth-checked at the route level) and the daily cron (which iterates all
 * projects whose insight is older than 7 days).
 *
 * Caller is responsible for authorizing the projectId.
 */
export async function generateWeeklyInsight(
  projectId: string
): Promise<InsightResult | InsightError> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { ok: false, error: 'Project not found' };

  // Pull config alongside findings so the prompt can include keywords +
  // competitors as ground-truth context (in addition to the bible).
  const [config] = await db
    .select()
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  const recent = await db
    .select()
    .from(researchFindings)
    .where(eq(researchFindings.projectId, projectId))
    .orderBy(desc(researchFindings.foundAt))
    .limit(30);

  if (recent.length < 3) {
    return {
      ok: false,
      error: 'Not enough findings yet',
      hint: 'Run a scan first; at least 3 findings are needed to synthesize.',
    };
  }

  const findingsText = recent
    .map(
      (f, i) =>
        `${i + 1}. [${f.source}] ${f.title}\n   ${(f.snippet ?? '').slice(0, 200)}`
    )
    .join('\n\n');

  const bible = (project.brandContext as BrandBible | null) ?? null;
  const keywords = (config?.keywords as string[] | null) ?? [];
  const competitors = (config?.competitors as string[] | null) ?? [];
  const projectContext = buildProjectContext({
    projectName: project.name,
    bible,
    keywords,
    competitors,
  });

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      system: `You are a market research consultant analyzing community signals for a SPECIFIC project. DO NOT extrapolate findings outside this project's domain — if a finding is tangential to the project's actual industry/audience, ignore it rather than forcing a generic interpretation.

═══════ PROJECT CONTEXT ═══════
${projectContext}

═══════ TASK ═══════

Given research findings, generate a structured insight specific to THIS project's domain:

1. **Top 3 pain points this week** — concrete problems users mention that match this project's audience. Cite which findings (use [1], [2] etc).
2. **Trending keywords** — what's gaining vs losing momentum within this domain.
3. **Opportunity gaps** — what competitors don't address (reference the configured competitors above when relevant).
4. **Quotes worth responding to** — 2-3 specific posts the founder should engage with directly.

CRITICAL: If a finding clearly belongs to a different domain (e.g. an indie hacker tools post for a travel app, or a SaaS post for a fitness brand), DO NOT include it. Better to flag fewer, on-domain insights than to manufacture cross-domain ones.

Keep total under 600 words. Use markdown headers (##). Be specific, not generic.`,
      messages: [
        {
          role: 'user',
          content: `Recent findings for "${project.name}":\n\n${findingsText}`,
        },
      ],
    });
  } catch (e) {
    console.error('[INSIGHT] anthropic failed', e);
    return {
      ok: false,
      error: 'AI call failed',
      hint: e instanceof Error ? e.message : String(e),
    };
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  const insight = textBlock?.type === 'text' ? textBlock.text : '';
  if (!insight) return { ok: false, error: 'Empty response' };

  // Upsert: synthesize might run before the user has saved any config.
  const [existing] = await db
    .select({ id: researchConfig.id })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  if (existing) {
    await db
      .update(researchConfig)
      .set({ weeklyInsight: insight, weeklyInsightAt: new Date() })
      .where(eq(researchConfig.projectId, projectId));
  } else {
    await db.insert(researchConfig).values({
      projectId,
      weeklyInsight: insight,
      weeklyInsightAt: new Date(),
    });
  }

  return { ok: true, insight };
}
