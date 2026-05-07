// PR #34 — Sprint 6.2: public landing-page preview.
// PR #36 — Sprint 6.2.2: smart input — accepts a website URL OR an
// Instagram handle (@voyaa.app, instagram.com/voyaa.app). Two
// testers reported having only Instagram, no website.
// PR #36 — Sprint 6.2.3: manual description fallback. When scrape
// fails (Meta login wall, dead URL, blocked bot), the landing
// surfaces a "Describe your brand manually" link that POSTs the
// founder's typed description in place of a URL. Same Anthropic
// prompt + output shape; no scrape step.
//
// POST /api/public/preview-bible
// Body — exactly one of:
//   { input: 'yoursite.com' | '@yourhandle' | 'instagram.com/yourhandle' }
//   { url: '...' }                       // legacy alias for input
//   { description: '30–1000 chars' }     // 6.2.3 fallback path
//
// Sequence:
//   1. Rate-limit check (read-only, per ip_hash). 429 on overflow.
//   2. Description mode: validate length, skip detection/scrape.
//      URL/IG mode: detectInputType → website | instagram | invalid,
//                   validate (anti-SSRF for website).
//   3. Cache lookup keyed by content hash, mode-prefixed so the
//      same string can't collide across types ("voyaa.app" as URL
//      vs IG handle vs description all hash differently).
//   4. Source-specific scrape (skipped for description).
//   5. commitRateLimit (now we're about to spend Anthropic tokens).
//   6. Claude Haiku 4.5 → strict JSON preview.
//   7. Persist to public_bible_previews.
//
// Returns: { cached, preview, url, source, remainingRequests? }
//   - source: 'website' | 'instagram' | 'description'
//   - url: null when source === 'description' (no canonical URL exists)
//
// Cost control: Haiku (not Opus), short prompts ≈ $0.003/run. Cache
// + per-IP rate limit cap exposure.
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { publicBiblePreviews } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import * as cheerio from 'cheerio';
import { anthropic } from '@/lib/ai/claude';
import {
  checkRateLimit,
  commitRateLimit,
  getClientIp,
} from '@/lib/landing/rate-limit';
import {
  hashUrl,
  validatePublicUrl,
} from '@/lib/landing/url-validator';
import { detectInputType } from '@/lib/landing/input-detector';
import {
  instagramDataToContext,
  isInstagramScrapeError,
  scrapeInstagramPublic,
} from '@/lib/landing/instagram-scraper';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Haiku 4.5 pricing snapshot. If pricing shifts we'll see it in
// generation_cost trends and update this constant.
const HAIKU_INPUT_COST_PER_TOKEN = 0.0000008;
const HAIKU_OUTPUT_COST_PER_TOKEN = 0.000004;

// 7 days. After that the URL gets re-scraped; 7d balances "you don't
// pay AI twice for the same site this week" with "the brand voice
// can drift if you change the homepage".
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// PR #36 Sprint 6.2.3: description bounds. 30 lower bound stops
// "asdfasdf" garbage; 1000 upper bound caps prompt size for Haiku
// (a focused brand description fits in <500 chars; 1000 leaves
// room for founders who think out loud).
const DESCRIPTION_MIN_CHARS = 30;
const DESCRIPTION_MAX_CHARS = 1000;

// PR #36: pull the hostname out of a normalized URL for use in
// human-readable error messages. The URL constructor never throws
// here because we already validated upstream.
function parsedHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// PR #36: undici (Node's fetch) wraps every network failure in a
// generic "fetch failed" Error. The actual cause (DNS, connect
// refused, TLS, etc) lives on `error.cause`. We unwrap it so the
// user sees something they can act on.
//
// Common cause codes from undici:
//   ENOTFOUND       — DNS resolution failed (typo / domain doesn't exist)
//   ECONNREFUSED    — host reachable but port closed
//   ECONNRESET      — connection dropped mid-flight
//   ETIMEDOUT       — TCP timeout (different from AbortSignal timeout)
//   CERT_HAS_EXPIRED / unable to verify  — TLS issue
function friendlyFetchError(e: unknown, url: string): string {
  const host = parsedHost(url);
  // AbortSignal.timeout firing throws a plain Error with name "TimeoutError"
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return `${host} took too long to respond (timed out after 15s). Try again or use a different URL.`;
  }
  if (e instanceof Error) {
    const cause = (e.cause as { code?: string } | undefined) ?? {};
    const code = cause.code ?? '';
    if (code === 'ENOTFOUND') {
      return `Couldn't reach ${host}. Double-check the URL — that domain doesn't seem to resolve.`;
    }
    if (code === 'ECONNREFUSED') {
      return `${host} refused the connection. The server might be down.`;
    }
    if (code === 'ECONNRESET' || code === 'EPIPE') {
      return `${host} closed the connection unexpectedly. Try again.`;
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return `${host} took too long to respond. Try again or use a different URL.`;
    }
    if (
      code === 'CERT_HAS_EXPIRED' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    ) {
      return `${host} has an SSL certificate issue. Make sure HTTPS is set up correctly.`;
    }
  }
  return `Couldn't reach ${host}. Make sure the site is online and the URL is correct.`;
}

// PR #36 Sprint 6.2.3: marker prefix on original_url so we can
// detect description rows on cache lookup without adding a column.
// The full description still drives the hash; this just stores a
// truncated label for display fallback.
const DESCRIPTION_URL_MARKER = 'description:';

interface AiPreview {
  archetype: string;
  voice: string;
  pillars: string[];
  audience: string;
  oneLiner: string;
}

function isAiPreview(input: unknown): input is AiPreview {
  if (!input || typeof input !== 'object') return false;
  const r = input as Record<string, unknown>;
  return (
    typeof r.archetype === 'string' &&
    typeof r.voice === 'string' &&
    Array.isArray(r.pillars) &&
    r.pillars.every((p) => typeof p === 'string') &&
    typeof r.audience === 'string' &&
    typeof r.oneLiner === 'string'
  );
}

type Mode = 'website' | 'instagram' | 'description';

// PR #36: cache hits don't carry mode metadata, so we recover it
// from the stored original_url. Description rows have a sentinel
// prefix; IG rows have an instagram.com URL; everything else is a
// plain website URL.
function detectStoredMode(originalUrl: string): Mode {
  if (originalUrl.startsWith(DESCRIPTION_URL_MARKER)) return 'description';
  if (/(?:^|\/\/)(?:www\.)?instagram\.com\//i.test(originalUrl)) {
    return 'instagram';
  }
  return 'website';
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  // PR #36 Sprint 6.2.3 — description path is mutually exclusive
  // with input/url. If `description` is present (non-empty after
  // trim), we skip URL detection and scraping entirely.
  const descriptionRaw =
    typeof body?.description === 'string' ? body.description.trim() : '';
  const isDescriptionMode = descriptionRaw.length > 0;

  // PR #36 — accept either `input` (preferred) or `url` (legacy
  // back-compat with anyone who built against the PR-34 shape).
  const raw = isDescriptionMode
    ? ''
    : typeof body?.input === 'string'
      ? body.input
      : typeof body?.url === 'string'
        ? body.url
        : '';

  if (!isDescriptionMode && raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'URL or @handle is required' },
      { status: 400 }
    );
  }

  if (isDescriptionMode) {
    if (descriptionRaw.length < DESCRIPTION_MIN_CHARS) {
      return NextResponse.json(
        {
          error: `Add a bit more detail (at least ${DESCRIPTION_MIN_CHARS} characters) so we can pick up your brand.`,
        },
        { status: 400 }
      );
    }
    if (descriptionRaw.length > DESCRIPTION_MAX_CHARS) {
      return NextResponse.json(
        {
          error: `Description is too long (max ${DESCRIPTION_MAX_CHARS} characters).`,
        },
        { status: 400 }
      );
    }
  }

  // 1. Read-only rate-limit check. Reject if already blocked, but
  // DON'T increment yet — pre-Anthropic failures (invalid input,
  // DNS fail, IG login wall, etc.) shouldn't burn the user's
  // hourly cap. We commit the slot right before the Anthropic call.
  const ip = getClientIp(request);
  const limit = await checkRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: limit.reason ?? 'Rate limit exceeded',
        resetAt: limit.resetAt?.toISOString(),
      },
      { status: 429 }
    );
  }

  // 2. Mode detection. Description is its own mode; URL/IG falls
  // through detectInputType + (for websites) anti-SSRF.
  let mode: Mode;
  let normalized: string; // content used to compute the cache hash
  let displayUrl: string; // canonical "URL-shaped" value for display + storage

  if (isDescriptionMode) {
    mode = 'description';
    normalized = descriptionRaw;
    // Persisted as a marker so we can detect description rows on
    // cache lookup without adding a new column. Truncated for
    // safety; the full text is what generated the preview anyway.
    displayUrl = `${DESCRIPTION_URL_MARKER}${descriptionRaw.slice(0, 200)}`;
  } else {
    const detection = detectInputType(raw);
    if (detection.type === 'invalid') {
      return NextResponse.json(
        {
          error:
            detection.reason ??
            'Invalid input. Use a website URL (yoursite.com) or Instagram handle (@yourhandle).',
        },
        { status: 400 }
      );
    }
    if (detection.type === 'website') {
      const validation = validatePublicUrl(detection.normalized);
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.reason ?? 'Invalid URL' },
          { status: 400 }
        );
      }
    }
    mode = detection.type;
    normalized = detection.normalized;
    // displayUrl is set after the scrape (websites use the
    // normalized URL; IG uses the canonical
    // instagram.com/handle/ form).
    displayUrl = '';
  }

  // PR #36: cache key is mode-prefixed so the same string can't
  // collide across input types.
  const urlHash =
    mode === 'instagram'
      ? createHash('sha256')
          .update(`ig:${normalized}`)
          .digest('hex')
          .slice(0, 32)
      : mode === 'description'
        ? createHash('sha256')
            .update(`desc:${normalized.toLowerCase()}`)
            .digest('hex')
            .slice(0, 32)
        : hashUrl(normalized);
  const now = new Date();

  // 3. Cache hit returns instantly.
  const [cached] = await db
    .select()
    .from(publicBiblePreviews)
    .where(eq(publicBiblePreviews.urlHash, urlHash))
    .limit(1);

  if (cached && cached.expiresAt && cached.expiresAt > now) {
    // Cache hit IS a successful "use" of the endpoint — commit a slot.
    // (Cheap on our side, so we could skip; but a 1000-cache-hits-per-
    // second flood would still flag as abuse, and counting cache hits
    // makes the rate limit consistent for the user.)
    const commit = await commitRateLimit(ip);
    if (!commit.allowed) {
      return NextResponse.json(
        {
          error: commit.reason ?? 'Rate limit exceeded',
          resetAt: commit.resetAt?.toISOString(),
        },
        { status: 429 }
      );
    }
    await db
      .update(publicBiblePreviews)
      .set({
        visitCount: (cached.visitCount ?? 0) + 1,
        lastVisitedAt: now,
      })
      .where(eq(publicBiblePreviews.id, cached.id));

    const storedMode = detectStoredMode(cached.originalUrl);
    return NextResponse.json({
      cached: true,
      preview: {
        archetype: cached.previewArchetype ?? '',
        voice: cached.previewVoice ?? '',
        pillars: (cached.previewPillars as string[] | null) ?? [],
        audience: cached.previewAudience ?? '',
        oneLiner: cached.previewOneLiner ?? '',
      },
      // For description hits there's no real URL; null tells the
      // UI to render "Generated from your description" instead of
      // the (truncated) marker string.
      url: storedMode === 'description' ? null : cached.originalUrl,
      source: storedMode,
      remainingRequests: commit.remainingRequests,
    });
  }

  // Lazy cleanup: if the row exists but is expired, drop it before
  // writing fresh. Cheap GC without needing a dedicated cron.
  if (cached) {
    await db
      .delete(publicBiblePreviews)
      .where(eq(publicBiblePreviews.id, cached.id));
  }

  // 4. Source-specific scrape. Both branches must populate
  // `contextForAi` (the chunk fed to Haiku) and `displayUrl` (the
  // canonical URL stored + returned). On any failure we exit with
  // a friendly 400 BEFORE committing the rate-limit slot.
  let contextForAi: string;

  if (mode === 'description') {
    // PR #36 Sprint 6.2.3 — no scrape. Feed the founder's words
    // straight to Haiku with a NOTE so it doesn't hallucinate
    // site-style details.
    contextForAi = `User-provided brand description:
${descriptionRaw}

NOTE: Source is the founder's own description (no website or social profile scrape). Use the description verbatim — don't add claims, products, or audiences that aren't there.`;
    // displayUrl already set above (DESCRIPTION_URL_MARKER + truncated text).
  } else if (mode === 'instagram') {
    // PR #36 — IG path. instagram-scraper is best-effort; surface
    // its error verbatim because it's already user-facing copy.
    const ig = await scrapeInstagramPublic(normalized);
    if (isInstagramScrapeError(ig)) {
      return NextResponse.json({ error: ig.error }, { status: 400 });
    }
    contextForAi = instagramDataToContext(ig);
    displayUrl = `https://www.instagram.com/${normalized}/`;
  } else {
    // Website path (original PR #34 / PR #36 friendly-error logic).
    let html: string;
    try {
      const response = await fetch(normalized, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; HelmBot/1.0; +https://trythelm.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const friendly =
          response.status === 403 || response.status === 401
            ? `${parsedHost(normalized)} blocked our request. Some sites block bots — try a different URL or sign up to scan it from your account.`
            : response.status === 404
              ? `Page not found at ${parsedHost(normalized)}. Double-check the URL.`
              : response.status >= 500
                ? `${parsedHost(normalized)} returned a server error (HTTP ${response.status}). Try again in a moment.`
                : `${parsedHost(normalized)} responded with HTTP ${response.status}. Make sure the page is public.`;
        return NextResponse.json({ error: friendly }, { status: 400 });
      }
      html = await response.text();
    } catch (e) {
      const friendly = friendlyFetchError(e, normalized);
      return NextResponse.json({ error: friendly }, { status: 400 });
    }

    // 5. Cheerio extract.
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const metaDesc =
      $('meta[name="description"]').attr('content')?.trim() ?? '';
    const ogDesc =
      $('meta[property="og:description"]').attr('content')?.trim() ?? '';
    const h1 = $('h1').first().text().trim();
    const h2s = $('h2')
      .map((_, el) => $(el).text().trim())
      .get()
      .slice(0, 5)
      .filter(Boolean)
      .join(' | ');
    $('script, style, noscript').remove();
    const bodyText = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    if (!title && !h1 && bodyText.length < 50) {
      return NextResponse.json(
        {
          error:
            'Could not extract content from this site. Make sure it has a title or visible text.',
        },
        { status: 400 }
      );
    }

    contextForAi = `Website: ${normalized}
Title: ${title || '(empty)'}
Description: ${metaDesc || ogDesc || '(empty)'}
H1: ${h1 || '(empty)'}
H2 sections: ${h2s || '(empty)'}
Body excerpt:
${bodyText.slice(0, 2000)}`;
    displayUrl = normalized;
  }

  // PR #36 — Commit a rate-limit slot now that we've successfully
  // fetched + extracted content. The Anthropic call below is the
  // expensive part; from here on a slot is consumed regardless of
  // outcome (Haiku 4xx, JSON parse fail, etc.) because we burned
  // tokens. Pre-PR-36 we incremented at request entry and DNS-fail
  // typos counted against the cap.
  const commit = await commitRateLimit(ip);
  if (!commit.allowed) {
    return NextResponse.json(
      {
        error: commit.reason ?? 'Rate limit exceeded',
        resetAt: commit.resetAt?.toISOString(),
      },
      { status: 429 }
    );
  }

  // 6. Claude Haiku call. Strict JSON output; we sanitize before
  // persisting. Source-agnostic prompt — works for websites,
  // Instagram bios, and founder-typed descriptions alike.
  const prompt = `You are a brand strategist analyzing a brand source to derive a quick brand bible preview. Be SPECIFIC to this brand — never use generic phrasing.

${contextForAi}

Output ONLY valid JSON, no markdown fences, in this exact shape:
{
  "archetype": "one of: Hero, Magician, Sage, Lover, Caregiver, Outlaw, Explorer, Creator, Ruler, Innocent, Jester, Everyman",
  "voice": "2-3 word descriptor (e.g. 'Warm and direct', 'Bold and irreverent')",
  "pillars": ["pillar 1 (1-3 words)", "pillar 2 (1-3 words)", "pillar 3 (1-3 words)"],
  "audience": "Specific audience in 1 sentence (who they are, what they want).",
  "oneLiner": "What this brand does in 1 punchy sentence (under 12 words)."
}

Rules:
- NEVER write generic phrases like "tech-savvy users" or "modern audience".
- Use evidence from the actual content. If something is unclear, pick the closest match — don't invent claims.
- Quote-style oneLiner is fine; the UI renders it in quotes.
`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? `AI error: ${e.message}` : 'AI error',
      },
      { status: 500 }
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  let aiText = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  // Strip ``` fences if Haiku adds them despite the rule.
  if (aiText.startsWith('```')) {
    aiText = aiText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(aiText);
  } catch {
    return NextResponse.json(
      { error: 'AI returned invalid JSON. Try again.' },
      { status: 500 }
    );
  }

  if (!isAiPreview(parsed)) {
    return NextResponse.json(
      { error: 'AI response was missing required fields.' },
      { status: 500 }
    );
  }

  const preview: AiPreview = {
    archetype: parsed.archetype.trim(),
    voice: parsed.voice.trim(),
    pillars: parsed.pillars.slice(0, 3).map((p) => p.trim()),
    audience: parsed.audience.trim(),
    oneLiner: parsed.oneLiner.trim(),
  };

  // 7. Cost calc + persist. usage may be undefined on certain SDK
  // versions — guard for it.
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const cost =
    inputTokens * HAIKU_INPUT_COST_PER_TOKEN +
    outputTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

  await db
    .insert(publicBiblePreviews)
    .values({
      urlHash,
      originalUrl: displayUrl,
      previewArchetype: preview.archetype,
      previewVoice: preview.voice,
      previewPillars: preview.pillars,
      previewAudience: preview.audience,
      previewOneLiner: preview.oneLiner,
      generationCost: cost.toFixed(6),
      visitCount: 1,
      lastVisitedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: publicBiblePreviews.urlHash,
      set: {
        previewArchetype: preview.archetype,
        previewVoice: preview.voice,
        previewPillars: preview.pillars,
        previewAudience: preview.audience,
        previewOneLiner: preview.oneLiner,
        generationCost: cost.toFixed(6),
        visitCount: 1,
        lastVisitedAt: now,
        expiresAt,
      },
    });

  return NextResponse.json({
    cached: false,
    preview,
    // For description mode there's no canonical URL — return null
    // so the UI can render "Generated from your description"
    // instead of leaking the marker string.
    url: mode === 'description' ? null : displayUrl,
    source: mode, // 'website' | 'instagram' | 'description'
    remainingRequests: commit.remainingRequests,
  });
}
