import { db } from '@/lib/db';
import { projects, researchConfig, researchFindings } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';

export interface InsightResult {
  ok: true;
  insight: string;
}

export interface InsightError {
  ok: false;
  error: string;
  hint?: string;
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

  const stackJson = project.detectedStack
    ? JSON.stringify(project.detectedStack)
    : 'micro-SaaS for indie hackers';

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      system: `You are a market research consultant analyzing community signals for "${project.name}".
Project context: ${stackJson}

Given research findings, generate a structured insight:

1. **Top 3 pain points this week** — concrete problems users mention. Cite which findings (use [1], [2] etc).
2. **Trending keywords** — what's gaining vs losing momentum.
3. **Opportunity gaps** — what competitors don't address.
4. **Quotes worth responding to** — 2-3 specific posts the founder should engage with directly.

Keep total under 600 words. Use markdown headers (##). Be specific, not generic.`,
      messages: [
        {
          role: 'user',
          content: `Recent findings:\n\n${findingsText}`,
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
    await db
      .insert(researchConfig)
      .values({
        projectId,
        weeklyInsight: insight,
        weeklyInsightAt: new Date(),
      });
  }

  return { ok: true, insight };
}
