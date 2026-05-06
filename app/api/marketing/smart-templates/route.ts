import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  waitlistPages,
  waitlistResponses,
  scheduledPosts,
  compassReadings,
} from '@/lib/db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';
import type { CompassDimension } from '@/lib/types/compass';

interface SmartTemplate {
  category: string;
  title: string;
  description: string;
  promptStarter: string;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Cheap call (Haiku, ~1500 tokens) but the cache is 24h on the client —
  // this rate limit is the floor for "they cleared their cache and spammed".
  const limit = checkRateLimit(`smart-templates:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Pre-fix: this endpoint ignored which platforms the user had selected,
  // so changing the channel chips in /marketing didn't change which
  // templates Haiku produced — and the client cache used the same key
  // regardless of channels. Now we accept ?platforms=reddit,linkedin
  // and feed it to the prompt so the templates are channel-calibrated.
  const VALID_PLATFORMS = new Set([
    'instagram',
    'facebook',
    'linkedin',
    'threads',
    'reddit',
  ]);
  const rawPlatforms = (searchParams.get('platforms') ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0 && VALID_PLATFORMS.has(p));
  // Dedup + sort so the same selection always hashes to the same prompt
  // regardless of order the client sent them.
  const platforms = Array.from(new Set(rawPlatforms)).sort();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bible = (project.brandContext as BrandBible | null) ?? null;

  // Pull project state in parallel — these are independent reads.
  const [pages, recentPosts, latestCompass] = await Promise.all([
    db
      .select({
        id: waitlistPages.id,
        slug: waitlistPages.slug,
        title: waitlistPages.title,
        template: waitlistPages.template,
      })
      .from(waitlistPages)
      .where(eq(waitlistPages.projectId, projectId)),
    db
      .select({
        platform: scheduledPosts.platform,
        content: scheduledPosts.content,
      })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.projectId, projectId))
      .orderBy(desc(scheduledPosts.createdAt))
      .limit(3),
    db
      .select()
      .from(compassReadings)
      .where(eq(compassReadings.projectId, projectId))
      .orderBy(desc(compassReadings.createdAt))
      .limit(1),
  ]);

  // Per-page response counts so the prompt can reference real signup numbers.
  const pageIds = pages.map((p) => p.id);
  const responseCounts = new Map<string, number>();
  if (pageIds.length > 0) {
    const counts = await db
      .select({
        pageId: waitlistResponses.waitlistPageId,
        count: sql<number>`count(*)::int`,
      })
      .from(waitlistResponses)
      .where(inArray(waitlistResponses.waitlistPageId, pageIds))
      .groupBy(waitlistResponses.waitlistPageId);
    for (const c of counts) responseCounts.set(c.pageId, Number(c.count));
  }

  const compass = latestCompass[0];
  const compassDims = (compass?.dimensions as CompassDimension[] | null) ?? [];
  const weakestDim = [...compassDims].sort(
    (a, b) =>
      (a.maxPts > 0 ? a.pts / a.maxPts : 1) -
      (b.maxPts > 0 ? b.pts / b.maxPts : 1)
  )[0];

  const pillarsList =
    (bible?.pillars ?? []).map((p) => p.name).join(', ') || 'none';

  // Channel-specific guidance the LLM uses to bias each template's hook
  // and structure. Mirrors the platform voice rules in lib/ai/claude.ts so
  // a "Reddit only" selection produces story-driven templates and a
  // "LinkedIn only" selection produces professional-insight templates.
  const PLATFORM_VOICE: Record<string, string> = {
    reddit:
      'humble, story-driven hooks, no emojis, end with a genuine question. r/SaaS / r/IndieHackers tone',
    linkedin: 'professional but human, "I learned X" framing, 1 emoji max',
    instagram: 'casual, visual-first, 2-3 emojis, hook + question CTA',
    facebook: 'conversational, personal storytelling, slightly longer',
    threads: 'punchy 50-80 words, tweet-like, no hashtags',
  };
  const channelsBlock =
    platforms.length === 0
      ? 'TARGET CHANNELS: not specified — produce flexible templates that adapt across channels.'
      : `TARGET CHANNELS (the founder selected these): ${platforms.join(', ')}\n\nVOICE PER CHANNEL:\n${platforms
          .map((p) => `- ${p}: ${PLATFORM_VOICE[p] ?? 'default voice'}`)
          .join('\n')}\n\nCALIBRATE the 4-6 templates SPECIFICALLY for these channels. If only one channel is selected, every template should feel native to that channel's culture. If multiple, lean toward formats that work across all of them.`;

  const prompt = `You are a content strategist for an indie hacker. Generate 4-6 SPECIFIC, CONTEXTUAL post templates based on what's actually happening with this project.

═══════ PROJECT STATE ═══════
Name: ${project.name}
Tagline: ${bible?.identity?.tagline ?? 'none'}
Pillars: ${pillarsList}

Active waitlists (${pages.length}):
${
  pages.length === 0
    ? 'No waitlists'
    : pages
        .map(
          (p) =>
            `- "${p.title || p.slug}" (template: ${p.template ?? 'minimal'}, ${responseCounts.get(p.id) ?? 0} signups)`
        )
        .join('\n')
}

Recent posts (${recentPosts.length}):
${
  recentPosts.length === 0
    ? 'No posts yet'
    : recentPosts
        .map(
          (p) =>
            `- [${p.platform}] ${p.content.slice(0, 80)}${p.content.length > 80 ? '…' : ''}`
        )
        .join('\n')
}

Compass state:
${
  compass
    ? `Score ${compass.totalScore}/100 (${compass.band}). Weakest dimension: ${weakestDim?.name ?? 'unknown'}`
    : 'No compass reading'
}

═══════ CHANNELS ═══════
${channelsBlock}

═══════ TASK ═══════

Generate 4-6 templates SPECIFIC to this project's current state. Each template should:
- Reference real data from this project (pillar names, waitlist titles, metrics, compass weak dimension, etc.)
- Be different from generic "Product launch" / "Numbers / Milestone" templates
- Be actionable: the founder reads it and immediately knows what to write

Output STRICTLY valid JSON, no markdown:
{
  "templates": [
    {
      "category": "string (e.g., 'Validation', 'Build in public', 'Pillar reinforcement')",
      "title": "string (max 6 words, specific)",
      "description": "string (max 25 words, specific to this project)",
      "promptStarter": "string (a starter prompt the founder can use, max 30 words)"
    }
  ]
}

EXAMPLES of GOOD templates (specific to project state):
- "Hit ${pages[0]?.title ?? 'first waitlist'} milestone" — referencing actual waitlist
- "Reinforce '${(bible?.pillars ?? [])[0]?.name ?? 'speed'}' pillar with real example"
- "Address weakest compass dimension publicly"

EXAMPLES of BAD templates (avoid these — generic):
- "Product launch"
- "User shoutout"
- "Behind the scenes"

Be SPECIFIC. Reference real names, real numbers, real pillars.`;

  let templates: SmartTemplate[] = [];
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw) as { templates?: unknown };
    if (Array.isArray(parsed.templates)) {
      // Validate shape so a malformed item doesn't crash the UI map.
      templates = parsed.templates
        .filter(
          (t): t is SmartTemplate =>
            !!t &&
            typeof t === 'object' &&
            typeof (t as SmartTemplate).category === 'string' &&
            typeof (t as SmartTemplate).title === 'string' &&
            typeof (t as SmartTemplate).description === 'string' &&
            typeof (t as SmartTemplate).promptStarter === 'string'
        )
        .slice(0, 6);
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Generation failed',
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ templates });
}
