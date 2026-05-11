// PR #58 — Sprint 7.0.2: Weekly Brief generator.
//
// Pulls the latest research_insights row for a project, combines it
// with recent generated-post performance, and asks Opus 4.7 to draft
// a Monday-morning email. Opus is chosen here (vs Haiku elsewhere)
// because the brief is the highest-stakes single AI output we
// produce — it's what makes the founder open the app on Monday.
//
// Design tenets:
//   - Idempotent: if the latest insight already has briefSent=true we
//     skip silently so a cron re-run can't double-mail.
//   - Cheap fallback: when there's no insight in the last 7 days we
//     skip without consuming an Opus call.
//   - Cached prefix: brand bible + voice fingerprint can be reused
//     across all projects of a user, but since each call has a
//     different project it's cached per-project (max benefit when
//     the founder triggers test-brief multiple times in a session).
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  researchInsights,
  users as usersTable,
} from '@/lib/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { sendEmail } from '@/lib/email/resend';
import type { BrandBible } from '@/lib/types/brand';

export interface BriefResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  emailId?: string;
  error?: string;
  htmlPreview?: string;
}

interface PainPoint {
  theme: string;
  frequency: number;
  sampleQuote: string;
  platform: string;
  actionableAngle: string;
}

interface BriefArgs {
  userId: string;
  projectId: string;
  /** Override the freshness window. Default: 7 days. */
  insightWindowDays?: number;
  /** When true, generate the HTML but don't send the email. */
  dryRun?: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function generateAndSendBrief(
  args: BriefArgs,
): Promise<BriefResult> {
  const windowDays = args.insightWindowDays ?? 7;
  const windowAgo = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Resolve project + user + ownership all in one shot.
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, args.projectId), eq(projects.userId, args.userId)),
    )
    .limit(1);
  if (!project) {
    return {
      success: false,
      error: 'Project not found or forbidden',
    };
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(eq(usersTable.id, args.userId))
    .limit(1);
  if (!user?.email) {
    return { success: false, error: 'User has no email on file' };
  }

  // Pull the most recent insight inside the window.
  const [insight] = await db
    .select()
    .from(researchInsights)
    .where(
      and(
        eq(researchInsights.projectId, args.projectId),
        gte(researchInsights.createdAt, windowAgo),
      ),
    )
    .orderBy(desc(researchInsights.createdAt))
    .limit(1);

  if (!insight) {
    return {
      success: false,
      skipped: true,
      reason:
        'No research insight in the last week. Run /api/research/extract-pain-points first.',
    };
  }

  if (insight.briefSent && !args.dryRun) {
    return {
      success: false,
      skipped: true,
      reason: 'Brief already sent for this insight.',
    };
  }

  const painPoints = (insight.painPoints as PainPoint[] | null) ?? [];
  if (painPoints.length === 0) {
    return {
      success: false,
      skipped: true,
      reason:
        insight.skippedReason ??
        'Latest insight has no pain points to brief on.',
    };
  }

  // Pull last 7 days of generated-post performance for the "what
  // worked / didn't" block. Cap at 20 so the prompt stays bounded.
  const recentPosts = await db
    .select()
    .from(generatedPosts)
    .where(
      and(
        eq(generatedPosts.projectId, args.projectId),
        gte(generatedPosts.createdAt, new Date(Date.now() - WEEK_MS)),
      ),
    )
    .orderBy(desc(generatedPosts.createdAt))
    .limit(20);

  const bible = (project.brandContext as BrandBible | null) ?? null;
  const pillars = (bible?.pillars ?? [])
    .map((p) => p?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');
  const audience = bible?.audience?.primary?.description ?? 'unknown';

  const systemPrompt = `You write the Monday-morning Weekly Brief email for indie-hacker founders using Helm.

You receive: the founder's brand bible, this week's audience pain points (extracted from connected research sources), and last week's post performance.

You return: a single self-contained HTML fragment ready to embed in an email. No <html>/<body> tags — just the email content from <h2> down.

Voice + tone:
- Direct, specific, founder-to-founder. NOT corporate marketing copy.
- Use the founder's brand pillars and audience language. Drop the quoted pain phrases verbatim where they help.
- Maximum ~400 words. Brevity beats coverage.

Structure (use inline styles for email-client compatibility):
1. <h2>Hey {founderName},</h2> opening + one-sentence framing of the week.
2. <h3>What your audience is talking about</h3> — 3 bullets from the top 3 pain points, each with the quote in a blockquote.
3. <h3>5 angles you could post this week</h3> — numbered list of 5 specific post angles. Each angle must reference a pain point above OR last week's voted post.
4. <h3>Last week</h3> — 1-2 sentences on what worked / what flopped. Skip if no votes/performance data.
5. Footer: <p style="margin-top:24px"><a href="https://trythelm.com/research" style="color:#3b82f6">Open Helm to act on this →</a></p>

Rules:
- Quote text must come verbatim from the pain points provided.
- Never invent angles unrelated to the pillars or pain themes.
- HTML attributes use double quotes; inline styles compact (e.g. style="margin:0 0 12px 0").`;

  const userMessage = `BRAND
Project: ${project.name}
Founder name: ${user.name ?? 'founder'}
Audience: ${audience}
Pillars: ${pillars || 'unset'}

THIS WEEK'S PAIN POINTS (top ${Math.min(painPoints.length, 5)} of ${painPoints.length}):
${painPoints
  .slice(0, 5)
  .map(
    (p, i) =>
      `${i + 1}. ${p.theme} (${p.frequency}× on ${p.platform})
   quote: "${p.sampleQuote}"
   angle: ${p.actionableAngle}`,
  )
  .join('\n\n')}

LAST WEEK'S POSTS (${recentPosts.length}):
${
  recentPosts.length === 0
    ? '(none)'
    : recentPosts
        .map((p) => {
          const head = (p.content ?? '').slice(0, 80).replace(/\s+/g, ' ');
          return `- "${head}…" vote=${p.userVote ?? '·'} perf=${p.performanceRating ?? '·'}`;
        })
        .join('\n')
}

Write the email HTML now.`;

  let html = '';
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 2000,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    await trackUsage({
      endpoint: 'research-weekly-brief',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: args.userId,
      projectId: args.projectId,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    html = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    // Strip ```html fences in case Opus wraps the answer.
    html = html
      .replace(/^```(?:html)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  } catch (err) {
    console.error('[brief] Opus call failed:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!html || html.length < 50) {
    return {
      success: false,
      error: 'Brief HTML too short — Opus may have failed silently',
    };
  }

  if (args.dryRun) {
    return { success: true, htmlPreview: html };
  }

  const subject = `🎯 ${project.name}: weekly audience brief`;
  const emailRes = await sendEmail({
    to: user.email,
    subject,
    html,
  });
  if (!emailRes.success) {
    return {
      success: false,
      error: emailRes.error ?? 'Email send failed',
      htmlPreview: html,
    };
  }

  // Stamp the insight as sent so the cron doesn't re-mail it.
  await db
    .update(researchInsights)
    .set({ briefSent: true, briefSentAt: new Date() })
    .where(eq(researchInsights.id, insight.id));

  return { success: true, emailId: emailRes.id, htmlPreview: html };
}
