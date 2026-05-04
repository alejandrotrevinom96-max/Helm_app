import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import type { BrandBible } from '@/lib/types/brand';

// Opus call with bigger context — give it room without blowing maxDuration.
export const maxDuration = 60;

const VALID_SOURCE_IDS = new Set([
  'reddit',
  'hackernews',
  'indiehackers',
  'googletrends',
]);

interface AutoConfigResult {
  keywords: string[];
  competitors: string[];
  recommendedSources: Array<{ id: string; reason: string }>;
  rationale: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Opus call ~$0.10. Cap at 5/hr/user as a budget guard — anyone hammering
  // this is either testing or stuck in a loop.
  const limit = checkRateLimit(`research-auto:${user.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId } = body as { projectId?: string };
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bible = (project.brandContext as BrandBible | null) ?? null;

  // Auto-config without a brand bible would be guessing. Send the user
  // back to /marketing first instead of producing low-confidence output.
  if (!bible || !bible.identity?.name) {
    return NextResponse.json(
      {
        error: 'Brand bible not configured',
        hint: 'Configure your brand bible in /marketing first to auto-configure research.',
      },
      { status: 400 }
    );
  }

  const prompt = `You are a competitive intelligence analyst for an indie hacker product. Analyze the brand bible and propose research config.

═══════ BRAND BIBLE ═══════
${JSON.stringify(
  {
    name: bible.identity?.name,
    tagline: bible.identity?.tagline,
    archetype: bible.archetype?.primary,
    pillars: bible.pillars,
    audience: bible.audience,
    industry: bible.identity?.industry,
  },
  null,
  2
)}

═══════ TASK ═══════

Output STRICTLY valid JSON, no markdown:

{
  "keywords": ["string (5-10 search keywords for this product's space)"],
  "competitors": ["string (3-7 specific competitor product names — REAL companies)"],
  "recommendedSources": [
    {
      "id": "reddit" | "hackernews" | "indiehackers" | "googletrends",
      "reason": "string (why this source matters for this project, max 20 words)"
    }
  ],
  "rationale": "string (2-3 sentence explanation of why these keywords/competitors matter)"
}

RULES for keywords:
- Mix broad terms (e.g., "indie hacker tools") with specific ones (e.g., "AI brand voice generator")
- Include 1-2 problem-statement keywords (e.g., "tool fatigue", "context switching")
- Avoid generic words like "startup" or "saas" alone

RULES for competitors:
- Real, named companies/products (not categories)
- Mix direct competitors and adjacent products
- Specific to the audience, not just "anyone in the industry"
- Examples for indie hacker tools: Tally, Senja, Lemon Squeezy, ConvertKit, Beehiiv

RULES for sources (only use these IDs: reddit, hackernews, indiehackers, googletrends):
- reddit: useful if audience hangs out on subreddits (most B2C, indie hackers, devs)
- hackernews: useful for tech/dev audience
- indiehackers: only if audience is indie hackers/founders
- googletrends: useful for measuring overall topic interest
- Pick 2-4 most relevant. Skip irrelevant ones.`;

  let result: AutoConfigResult;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw) as Partial<AutoConfigResult>;

    // Validate + normalize each field so a malformed Opus response can't
    // crash the modal that consumes this.
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords
          .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
          .map((k) => k.trim())
          .slice(0, 10)
      : [];
    const competitors = Array.isArray(parsed.competitors)
      ? parsed.competitors
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map((c) => c.trim())
          .slice(0, 7)
      : [];
    const recommendedSources = Array.isArray(parsed.recommendedSources)
      ? parsed.recommendedSources
          .map((s) => {
            if (!s || typeof s !== 'object') return null;
            const id = (s as Record<string, unknown>).id;
            const reason = (s as Record<string, unknown>).reason;
            if (
              typeof id !== 'string' ||
              !VALID_SOURCE_IDS.has(id.toLowerCase())
            ) {
              return null;
            }
            return {
              id: id.toLowerCase(),
              reason: typeof reason === 'string' ? reason : '',
            };
          })
          .filter((s): s is { id: string; reason: string } => s !== null)
          .slice(0, 4)
      : [];
    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale : '';

    result = { keywords, competitors, recommendedSources, rationale };
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Generation failed',
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ config: result });
}
