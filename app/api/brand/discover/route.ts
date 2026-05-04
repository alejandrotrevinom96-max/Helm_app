import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';
import {
  computeCompletionScore,
  EMPTY_VOICE,
  type BrandBible,
  type BrandColors,
} from '@/lib/types/brand';

const PER_PAGE_TIMEOUT_MS = 8000;
const PER_PAGE_BYTES = 8000;
const MAX_PAGES = 5;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { projectId, url } = body as { projectId?: string; url?: string };

  if (!projectId || !url) {
    return NextResponse.json(
      { error: 'projectId and url required' },
      { status: 400 }
    );
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('protocol');
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // === STEP 1: Multi-page scrape ===
  // Try a small set of high-signal paths. Stop at MAX_PAGES so we don't
  // bloat the LLM input or stall on a slow site.
  const candidatePaths = [
    '',
    '/about',
    '/about-us',
    '/pricing',
    '/features',
    '/manifesto',
    '/why',
    '/team',
    '/blog',
  ];

  const scraped: Array<{ url: string; content: string }> = [];
  const sources: string[] = [];

  for (const path of candidatePaths) {
    if (scraped.length >= MAX_PAGES) break;
    try {
      const fullUrl = new URL(path, parsedUrl).toString();
      const res = await fetch(fullUrl, {
        signal: AbortSignal.timeout(PER_PAGE_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Helm-Discovery/1.0 (+https://helm2.vercel.app)',
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = stripHtmlToText(html).slice(0, PER_PAGE_BYTES);
      if (text.length > 200) {
        scraped.push({ url: fullUrl, content: text });
        sources.push(fullUrl);
      }
    } catch {
      // Skip pages that 404, time out, or block our UA.
    }
  }

  if (scraped.length === 0) {
    return NextResponse.json(
      {
        error: 'Could not access URL or fetch content',
        hint: 'Make sure the URL is publicly accessible and not blocked by Cloudflare.',
      },
      { status: 400 }
    );
  }

  // === STEP 2: Extract colors from raw HTML ===
  // Best-effort hex-color scan. Better extraction (CSS parsing, computed
  // styles) belongs in a dedicated service later.
  const colorPalette = extractColorsFromHtml(scraped[0].content);

  // === STEP 3: Opus deep analysis ===
  const aggregated = scraped
    .map((s) => `=== ${s.url} ===\n${s.content}`)
    .join('\n\n');

  const systemPrompt = `You are a senior brand strategist at a top-tier agency, equivalent to the brand team of Coca-Cola, Apple, or Patagonia. Your job: analyze a company's web presence and produce a complete, rigorous brand bible.

CRITICAL: Most users are indie founders with NO marketing background. They cannot articulate their brand. You must INFER from their content with confidence and educate them with your output. Mark every section with confidence level (high/medium/low/inferred).

Return STRICTLY valid JSON matching this exact structure (no markdown, no preamble):

{
  "identity": {
    "name": string,
    "tagline": string | null,
    "mission": string | null,
    "vision": string | null,
    "foundedYear": number | null,
    "industry": string | null
  },
  "archetype": {
    "primary": "hero" | "sage" | "outlaw" | "creator" | "caregiver" | "magician" | "ruler" | "jester" | "everyman" | "lover" | "innocent" | "explorer",
    "secondary": same enum or null,
    "rationale": string (2-3 sentences explaining why)
  },
  "pillars": [
    { "name": string, "description": string, "weight": number 0-100 }
  ] (3 to 5 pillars),
  "voice": {
    "formal": 0-10,
    "serious": 0-10,
    "bold": 0-10,
    "innovative": 0-10,
    "approachable": 0-10
  },
  "vocabulary": {
    "preferredTerms": [{ "term": string, "instead_of": string | null }],
    "bannedTerms": [{ "term": string, "reason": string | null }],
    "brandPhrases": [string],
    "emojiPolicy": "never" | "rarely" | "tasteful" | "liberal",
    "hashtagPolicy": "never" | "minimal" | "strategic" | "aggressive"
  },
  "nonNegotiables": [string] (3-7 items),
  "audience": {
    "primary": {
      "description": string (1 sentence),
      "demographics": string | null,
      "psychographics": string | null,
      "painPoints": [{ "pain": string, "intensity": 1-5 }] (3-5 items),
      "jobsToBeDone": [string] (2-4 items),
      "toolsTried": [{ "tool": string, "why_failed": string | null }],
      "wateringHoles": [string]
    },
    "antiPersona": {
      "description": string | null,
      "reasons": [string]
    }
  },
  "messaging": {
    "primaryTagline": string | null,
    "taglineVariants": [string] (2-3),
    "valueProps": [
      {
        "pillar": string (must match a pillars[].name),
        "proposition": string,
        "proofPoints": [string]
      }
    ],
    "objections": [{ "objection": string, "response": string }] (2-4),
    "antiPositioning": [string] (2-3 items, "we are NOT...")
  },
  "visual": {
    "imageStyle": "photorealistic" | "illustrated" | "minimalist" | "editorial" | "mixed" | null,
    "photographyMood": string | null
  },
  "culturalMoments": [
    { "name": string, "date": string ISO, "relevance": 1-5, "angle": string }
  ] (only if highly relevant to industry),
  "_confidence": {
    "identity": "high" | "medium" | "low" | "inferred",
    "archetype": "high" | "medium" | "low" | "inferred",
    "pillars": "high" | "medium" | "low" | "inferred",
    "voice": "high" | "medium" | "low" | "inferred",
    "audience": "high" | "medium" | "low" | "inferred",
    "messaging": "high" | "medium" | "low" | "inferred"
  }
}

RULES:
- Be specific. "Indie hackers" is generic; "Solo founders 1-2 years into building, $0-5k MRR, anxious about validation" is specific.
- For pillars: choose 3-5 ATTRIBUTES that REPEAT across content. Common picks: Speed, Craft, Honesty, Independence, Pragmatism. Pick the RIGHT ones for THIS brand.
- For archetype: rationale must reference specific phrases or concepts from the source content.
- For non-negotiables: derive from content patterns. If they never use jargon, "Never use corporate jargon" is non-negotiable.
- For voice scores: be calibrated. 5 = neutral. Reserve 0/10 for extreme cases.
- For confidence: mark "inferred" when you're guessing from limited data. Mark "high" only when content explicitly states it.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Analyze this company's web content and produce the brand bible:\n\nPRIMARY URL: ${url}\n\nCONTENT FROM ${scraped.length} PAGES:\n\n${aggregated}`,
        },
      ],
    });
  } catch (e) {
    console.error('[BRAND DISCOVER] Anthropic call failed', e);
    return NextResponse.json(
      {
        error: 'AI analysis failed',
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error: 'Could not parse AI response',
        hint: 'Try again — Opus occasionally returns malformed JSON.',
      },
      { status: 502 }
    );
  }

  // === STEP 4: Build complete bible ===
  const bible = mergeIntoBible(parsed, colorPalette, sources);

  await db
    .update(projects)
    .set({
      brandUrl: url,
      brandContext: bible,
    })
    .where(eq(projects.id, projectId));

  return NextResponse.json({
    ok: true,
    bible,
    sourcesScraped: sources.length,
    completionScore: bible.meta.completionScore,
  });
}

// === Helpers ===

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractColorsFromHtml(content: string): BrandColors {
  const matches = Array.from(content.matchAll(/#[0-9a-f]{6}\b/gi)).map((m) =>
    m[0].toLowerCase()
  );
  const unique = [...new Set(matches)].filter(
    (c) => c !== '#000000' && c !== '#ffffff'
  );
  return {
    primary: unique[0] ?? null,
    secondary: unique[1] ?? null,
    accent: unique[2] ?? null,
    neutral: unique[3] ?? null,
  };
}

// Merge Opus output into a complete BrandBible. Anything missing falls back
// to safe defaults so downstream code can rely on the shape being intact.
function mergeIntoBible(
  parsed: Record<string, unknown>,
  colors: BrandColors,
  sources: string[]
): BrandBible {
  const p = parsed as Record<string, Record<string, unknown> | unknown>;
  const conf = (p._confidence as Record<string, unknown>) ?? {};
  const visual = (p.visual as Record<string, unknown>) ?? {};

  const bible: BrandBible = {
    identity: {
      name: ((p.identity as Record<string, unknown>)?.name as string) ?? null,
      tagline: ((p.identity as Record<string, unknown>)?.tagline as string) ?? null,
      mission: ((p.identity as Record<string, unknown>)?.mission as string) ?? null,
      vision: ((p.identity as Record<string, unknown>)?.vision as string) ?? null,
      foundedYear:
        ((p.identity as Record<string, unknown>)?.foundedYear as number) ?? null,
      industry:
        ((p.identity as Record<string, unknown>)?.industry as string) ?? null,
    },
    archetype: (p.archetype as BrandBible['archetype']) ?? {
      primary: null,
      secondary: null,
      rationale: null,
    },
    pillars: (p.pillars as BrandBible['pillars']) ?? [],
    voice: (p.voice as BrandBible['voice']) ?? EMPTY_VOICE,
    vocabulary: (p.vocabulary as BrandBible['vocabulary']) ?? {
      preferredTerms: [],
      bannedTerms: [],
      brandPhrases: [],
      emojiPolicy: 'tasteful',
      hashtagPolicy: 'minimal',
    },
    nonNegotiables: (p.nonNegotiables as string[]) ?? [],
    audience: (p.audience as BrandBible['audience']) ?? {
      primary: {
        description: '',
        demographics: null,
        psychographics: null,
        painPoints: [],
        jobsToBeDone: [],
        toolsTried: [],
        wateringHoles: [],
      },
      antiPersona: { description: null, reasons: [] },
    },
    messaging: (p.messaging as BrandBible['messaging']) ?? {
      primaryTagline: null,
      taglineVariants: [],
      valueProps: [],
      objections: [],
      antiPositioning: [],
    },
    visual: {
      colors,
      typography:
        (visual.typography as BrandBible['visual']['typography']) ?? {
          headingStyle: null,
          bodyStyle: null,
        },
      imageStyle:
        (visual.imageStyle as BrandBible['visual']['imageStyle']) ?? null,
      photographyMood: (visual.photographyMood as string) ?? null,
    },
    culturalMoments: (p.culturalMoments as BrandBible['culturalMoments']) ?? [],
    meta: {
      autoDiscoveredAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
      completionScore: 0,
      sourceUrls: sources,
      confidence: {
        identity: (conf.identity as BrandBible['meta']['confidence']['identity']) ?? 'medium',
        archetype: (conf.archetype as BrandBible['meta']['confidence']['archetype']) ?? 'medium',
        pillars: (conf.pillars as BrandBible['meta']['confidence']['pillars']) ?? 'medium',
        voice: (conf.voice as BrandBible['meta']['confidence']['voice']) ?? 'medium',
        audience: (conf.audience as BrandBible['meta']['confidence']['audience']) ?? 'medium',
        messaging: (conf.messaging as BrandBible['meta']['confidence']['messaging']) ?? 'medium',
      },
    },
  };

  bible.meta.completionScore = computeCompletionScore(bible);
  return bible;
}
