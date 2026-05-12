// PR #67 — Sprint 7.1A: competitor website scraper.
//
// Fetches a competitor's homepage with cheerio, strips chrome
// (nav/footer/scripts), and asks Haiku 4.5 to extract a structured
// positioning snapshot. Haiku because (a) extraction is shape-
// matching, not reasoning, and (b) cost — 10 competitors × Opus
// would be ~$1/run. Haiku keeps the whole scrape pass under $0.05.
//
// We DON'T render JS — the cheerio fetch is a single HTTP GET.
// Many marketing sites front-load their value prop in the HTML
// shell anyway. If a particular competitor is JS-rendered we'll
// catch a thin/empty bodyText and surface that as a scrape failure
// rather than guessing.
//
// User-Agent identifies Helm so site operators can grep us out of
// logs if they want. We don't crawl — single homepage fetch only.
import { load } from 'cheerio';
import { anthropic, MODELS } from '@/lib/ai/claude';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 5000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; HelmCompass/1.0; +https://trythelm.com)';

export interface ScrapedPricingTier {
  tier: string;
  price: string;
}

export interface ScrapedPlatformLink {
  platform: string;
  url: string;
}

export interface ScrapedData {
  headline: string | null;
  valueProp: string | null;
  targetAudience: string | null;
  pricingVisible: ScrapedPricingTier[];
  platformPresence: ScrapedPlatformLink[];
  contentAngles: string[];
}

export class ScrapeError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'ScrapeError';
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asPricingArray(v: unknown): ScrapedPricingTier[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> =>
        !!x && typeof x === 'object',
    )
    .map((x) => ({
      tier: typeof x.tier === 'string' ? x.tier : '',
      price: typeof x.price === 'string' ? x.price : '',
    }))
    .filter((x) => x.tier || x.price);
}

function asPlatformArray(v: unknown): ScrapedPlatformLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> =>
        !!x && typeof x === 'object',
    )
    .map((x) => ({
      platform: typeof x.platform === 'string' ? x.platform : '',
      url: typeof x.url === 'string' ? x.url : '',
    }))
    .filter((x) => x.platform && x.url);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function scrapeCompetitor(url: string): Promise<ScrapedData> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new ScrapeError(`HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html') && !contentType.includes('text')) {
    throw new ScrapeError(`Non-HTML response (${contentType})`);
  }
  const html = await res.text();
  const $ = load(html);

  // Strip chrome / scripts so the body text is mostly real content.
  $('script, style, noscript, nav, footer, header, svg').remove();

  const title =
    $('title').text().trim() || $('h1').first().text().trim() || '';
  const metaDesc = $('meta[name="description"]').attr('content') ?? '';
  const ogDesc = $('meta[property="og:description"]').attr('content') ?? '';
  const bodyText = $('body')
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BODY_CHARS);

  if (bodyText.length < 200) {
    throw new ScrapeError(
      'Page returned too little text — likely JS-rendered or blocking us.',
    );
  }

  // Cheap regex pass for visible pricing strings. The Haiku call
  // gets these as a hint so it isn't guessing currency / billing
  // cycles from prose.
  const pricingMatches =
    bodyText.match(
      /[$€£¥]\s*\d+[.,]?\d*\s*(?:\/\s*(?:mes|mo|month|año|year|wk|week))?/gi,
    ) ?? [];

  // Social link harvest — Haiku gets a hydrated platform list so it
  // doesn't have to invent handles.
  const SOCIAL_HOSTS = [
    'instagram',
    'facebook',
    'linkedin',
    'twitter',
    'x.com',
    'tiktok',
    'youtube',
    'threads',
    'reddit',
  ];
  const socials = new Map<string, string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    for (const host of SOCIAL_HOSTS) {
      if (href.includes(`${host}.`) || href.includes(`${host}/`)) {
        const key = host === 'x.com' ? 'x' : host;
        if (!socials.has(key)) socials.set(key, href);
      }
    }
  });

  const systemPrompt = `You extract structured positioning data from a competitor's homepage HTML. Return strict JSON. No prose, no markdown fences.

Output shape:
{
  "headline": "string | null",
  "valueProp": "string | null  — 1-2 sentences",
  "targetAudience": "string | null — who they serve",
  "pricingVisible": [{ "tier": "string", "price": "string" }],
  "platformPresence": [{ "platform": "string", "url": "string" }],
  "contentAngles": ["string"]  // 3-5 recurring themes
}

Rules:
- Use the audience's language (Spanish input → Spanish output).
- Don't invent. If a field isn't on the page, return null / empty array.
- contentAngles are concrete themes, not "marketing" or "sales".`;

  const userMessage = `URL: ${url}
TITLE: ${title.slice(0, 200)}
META DESCRIPTION: ${metaDesc.slice(0, 300)}
OG DESCRIPTION: ${ogDesc.slice(0, 300)}

PRICING SIGNALS (regex pre-pass): ${pricingMatches.slice(0, 8).join(' | ') || '(none)'}

SOCIAL LINKS FOUND: ${
    socials.size > 0
      ? Array.from(socials.entries())
          .map(([p, u]) => `${p}=${u}`)
          .join(' | ')
      : '(none)'
  }

BODY TEXT (truncated, chrome stripped):
${bodyText.slice(0, 3500)}

Extract. JSON only.`;

  const response = await anthropic.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 1500,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock?.type === 'text' ? textBlock.text : '';
  if (!raw) {
    throw new ScrapeError('Haiku returned no text.');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanJson(raw)) as Record<string, unknown>;
  } catch (e) {
    throw new ScrapeError(
      `Failed to parse extraction JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Hydrate with regex-found socials if Haiku missed them.
  const haikuPlatforms = asPlatformArray(parsed.platformPresence);
  const merged = new Map<string, string>();
  for (const p of haikuPlatforms) merged.set(p.platform.toLowerCase(), p.url);
  for (const [p, u] of socials.entries()) if (!merged.has(p)) merged.set(p, u);

  return {
    headline: asString(parsed.headline),
    valueProp: asString(parsed.valueProp),
    targetAudience: asString(parsed.targetAudience),
    pricingVisible: asPricingArray(parsed.pricingVisible),
    platformPresence: Array.from(merged.entries()).map(([platform, url]) => ({
      platform,
      url,
    })),
    contentAngles: asStringArray(parsed.contentAngles).slice(0, 8),
  };
}
