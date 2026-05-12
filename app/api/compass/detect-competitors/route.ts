// PR #67 — Sprint 7.1A: AI-detect competitors with C-3 confidence
// threshold.
//
// Opus 4.7 reads the latest brand_analysis row + project context
// and returns 8-15 competitor candidates (mix of direct / adjacent
// / inspirational) with a confidence score and short reasoning.
//
// We upsert every candidate keyed on (projectId, url). The
// `approvedByUser` flag is set to true automatically for 85+
// confidence rows; the rest stay false until the founder approves
// them via the UI. The scrape endpoint only picks up rows that are
// `approvedByUser=true AND scrape_status='pending'`.
//
// Cost ceiling: 2/hr per user. Each detect is ~$0.10-0.15 Opus.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  brandAnalysis,
  competitors,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTO_APPROVE_THRESHOLD = 85;
const SUGGEST_THRESHOLD = 60;

interface Candidate {
  name: string;
  url: string;
  type: 'direct' | 'adjacent' | 'inspirational';
  confidence: number;
  reasoning: string;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    // Drop trailing slashes for stable dedup, keep host casing canonical.
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

function isValidType(t: unknown): t is Candidate['type'] {
  return t === 'direct' || t === 'adjacent' || t === 'inspirational';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = checkRateLimit(
    `compass-detect:${user.id}`,
    2,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  // Brand analysis is the strategic seed. Without it we can't make
  // a credible competitor list — refuse with a pointer to the
  // Smart Auto-configure flow.
  const [analysis] = await db
    .select()
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, projectId))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);
  if (!analysis) {
    return NextResponse.json(
      {
        error: 'Run Brand Analysis first',
        hint: 'Open /research and click "Generate analysis" before detecting competitors.',
        action: 'analyze-brand',
      },
      { status: 400 },
    );
  }

  const layers =
    typeof analysis.audienceLayers === 'object' && analysis.audienceLayers
      ? (analysis.audienceLayers as Record<string, unknown>)
      : {};
  const subNiches = Array.isArray(analysis.subNiches)
    ? (analysis.subNiches as string[])
    : [];

  const systemPrompt = `You are a market strategist identifying real competitors for a brand. You return STRICT JSON only — no markdown fences, no prose outside the array.

Output: JSON array of 8-15 competitor objects. Each object:
{
  "name": "<brand name>",
  "url": "<real https URL — no guesses>",
  "type": "direct" | "adjacent" | "inspirational",
  "confidence": <integer 0-100>,
  "reasoning": "<1-2 sentences>"
}

Categories:
- direct: same product/service category + audience overlap >70%
- adjacent: different category but competes for the same audience attention
- inspirational: brands the audience admires (different category, useful contrast)

Confidence scoring discipline:
- 90-100: well-known, public info available, definitely competes
- 80-89: likely competitor, some uncertainty
- 70-79: plausible — would need validation
- 60-69: tangential, may or may not be relevant
- <60: don't include in output at all

Hard rules:
- Real URLs only. Never invent.
- Include at least 3 direct + 3 adjacent.
- Match geographic + language relevance from the brand context.
- If the audience is Mexican / Spanish-speaking, include LATAM and Mexican brands.`;

  const userMessage = `BRAND
Name: ${project.name}
Niche: ${analysis.niche}
Sub-niches: ${subNiches.slice(0, 5).join(' · ') || '(none)'}

AUDIENCE LAYERS
Primary: ${typeof layers.primary === 'string' ? layers.primary : '(unset)'}
Secondary: ${typeof layers.secondary === 'string' ? layers.secondary : '(unset)'}
Tertiary: ${typeof layers.tertiary === 'string' ? layers.tertiary : '(unset)'}

Specificity recommended: ${analysis.specificityRecommended ?? 'niche'}
Competitor gap noted: ${analysis.competitorGap ?? '(none)'}

Identify 8-15 competitors. JSON array only.`;

  let parsed: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 3500,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });
    await trackUsage({
      endpoint: 'compass-detect-competitors',
      model: MODELS.OPUS,
      usage: response.usage,
      userId: user.id,
      projectId,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    parsed = JSON.parse(cleanJson(raw));
  } catch (err) {
    console.error('[detect-competitors] Opus failed:', err);
    return NextResponse.json(
      {
        error: 'Detection failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!Array.isArray(parsed)) {
    return NextResponse.json(
      { error: 'Detection returned non-array output' },
      { status: 502 },
    );
  }

  const normalized: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of parsed) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
    const type = isValidType(obj.type) ? obj.type : 'direct';
    const confidence = Math.max(
      0,
      Math.min(100, Math.round(Number(obj.confidence) || 0)),
    );
    const reasoning =
      typeof obj.reasoning === 'string'
        ? obj.reasoning.slice(0, 500)
        : '';
    if (!name || !rawUrl) continue;
    if (confidence < SUGGEST_THRESHOLD) continue;
    const url = normalizeUrl(rawUrl);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    normalized.push({ name, url, type, confidence, reasoning });
  }

  const inserted: { id: string; name: string; url: string; type: string | null; confidenceScore: number | null; approvedByUser: boolean; scrapeStatus: string | null; positioningSummary: string | null }[] = [];
  for (const c of normalized) {
    const autoApprove = c.confidence >= AUTO_APPROVE_THRESHOLD;
    try {
      const result = await db
        .insert(competitors)
        .values({
          projectId,
          userId: user.id,
          name: c.name,
          url: c.url,
          type: c.type,
          detectedBy: 'ai',
          confidenceScore: c.confidence,
          approvedByUser: autoApprove,
          scrapeStatus: 'pending',
          positioningSummary: c.reasoning,
        })
        .onConflictDoUpdate({
          target: [competitors.projectId, competitors.url],
          set: {
            // Refresh confidence + reasoning on re-detect, but
            // preserve the founder's approval decision and any
            // already-scraped fields.
            confidenceScore: c.confidence,
            positioningSummary: c.reasoning,
            type: c.type,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: competitors.id,
          name: competitors.name,
          url: competitors.url,
          type: competitors.type,
          confidenceScore: competitors.confidenceScore,
          approvedByUser: competitors.approvedByUser,
          scrapeStatus: competitors.scrapeStatus,
          positioningSummary: competitors.positioningSummary,
        });
      if (result[0]) inserted.push(result[0]);
    } catch (e) {
      console.error('[detect-competitors] insert failed:', c.name, e);
    }
  }

  const autoApproved = inserted.filter(
    (c) => (c.confidenceScore ?? 0) >= AUTO_APPROVE_THRESHOLD,
  );
  const suggested = inserted.filter(
    (c) =>
      (c.confidenceScore ?? 0) >= SUGGEST_THRESHOLD &&
      (c.confidenceScore ?? 0) < AUTO_APPROVE_THRESHOLD,
  );

  return NextResponse.json({
    success: true,
    detected: inserted.length,
    autoApproved: autoApproved.length,
    suggested: suggested.length,
    competitors: {
      autoApproved,
      suggested,
    },
  });
}
