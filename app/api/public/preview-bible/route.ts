// PR #34 — Sprint 6.2: public landing-page preview.
// PR #36 — Sprint 6.2.2: smart input — accepts a website URL OR an
// Instagram handle (@voyaa.app, instagram.com/voyaa.app). Two
// testers reported having only Instagram, no website.
//
// POST /api/public/preview-bible
// Body: { input?: string, url?: string }   (url kept for back-compat)
//
// Sequence (no-cache path):
//   1. Rate-limit check (read-only, per ip_hash). 429 on overflow.
//   2. detectInputType → website | instagram | invalid.
//   3. URL validation only on website branch (anti-SSRF).
//   4. Cache lookup keyed by content hash (prefixed for IG so the
//      same string can't collide across types).
//   5. Source-specific scrape:
//      - website: cheerio extract title/h1/h2s/body
//      - instagram: og + meta tags from public profile page
//   6. commitRateLimit (now we're about to spend Anthropic tokens).
//   7. Claude Haiku 4.5 → strict JSON preview.
//   8. Persist to public_bible_previews.
//
// Returns: { cached, preview, url, source, remainingRequests? }
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
  normalizeUrl,
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  // PR #36 — accept either `input` (preferred) or `url` (legacy
  // back-compat with anyone who built against the PR-34 shape).
  const raw =
    typeof body?.input === 'string'
      ? body.input
      : typeof body?.url === 'string'
        ? body.url
        : '';

  if (raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'URL or @handle is required' },
      { status: 400 }
    );
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

  // 2. Detect input type.
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

  // 3. Source-specific anti-SSRF / safety check (only websites need
  // it — IG handles route to instagram.com which is safe by
  // definition).
  if (detection.type === 'website') {
    const validation = validatePublicUrl(detection.normalized);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason ?? 'Invalid URL' },
        { status: 400 }
      );
    }
  }

  // PR #36: cache key is type-prefixed so "voyaa.app" as a website
  // and "@voyaa.app" as an IG handle never collide.
  const urlHash =
    detection.type === 'instagram'
      ? createHash('sha256')
          .update(`ig:${detection.normalized}`)
          .digest('hex')
          .slice(0, 32)
      : hashUrl(detection.normalized);
  const normalized = detection.normalized;
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
    return NextResponse.json({
      cached: true,
      preview: {
        archetype: cached.previewArchetype ?? '',
        voice: cached.previewVoice ?? '',
        pillars: (cached.previewPillars as string[] | null) ?? [],
        audience: cached.previewAudience ?? '',
        oneLiner: cached.previewOneLiner ?? '',
      },
      url: cached.originalUrl,
      // PR #36 — derive source from the stored URL. We always
      // persist a navigable URL in original_url; IG previews use
      // https://instagram.com/handle/, so a substring check
      // recovers the source without needing a new column.
      source: /(?:^|\/\/)(?:www\.)?instagram\.com\//i.test(cached.originalUrl)
        ? 'instagram'
        : 'website',
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
  let displayUrl: string;

  if (detection.type === 'instagram') {
    // PR #36 — IG path. instagram-scraper is best-effort; surface
    // its error verbatim because it's already user-facing copy.
    const ig = await scrapeInstagramPublic(detection.normalized);
    if (isInstagramScrapeError(ig)) {
      return NextResponse.json({ error: ig.error }, { status: 400 });
    }
    contextForAi = instagramDataToContext(ig);
    displayUrl = `https://www.instagram.com/${detection.normalized}/`;
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
  // persisting. Source-agnostic prompt — works for both website
  // and Instagram inputs.
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
    url: displayUrl,
    source: detection.type, // 'website' | 'instagram'
    remainingRequests: commit.remainingRequests,
  });
}
