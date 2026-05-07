// PR #26 — Sprint 3: Auto-Generate Brand Bible.
//
// Fetches a public URL and extracts brand-relevant signals: copy,
// CTAs, OG tags, palette hint, font family, and tone counters
// (exclamations / questions / emojis / sentence length). The output
// goes into brand_bible_sources.analysis_result and is later fed to
// Opus by lib/brand-bible/auto-generate.ts.
//
// Notes on robustness:
//   - 15s timeout; we don't want a slow site to keep a Vercel
//     serverless function alive forever.
//   - Honest user agent (HelmBot + URL); some sites block default
//     fetch UA strings.
//   - All errors are caught and returned in the result so callers
//     never crash; they pattern-match on `error`.
import * as cheerio from 'cheerio';

export interface WebScrapingResult {
  url: string;
  title: string;
  metaDescription: string;
  headlines: string[]; // h1, h2, h3
  ctaTexts: string[]; // button + link-with-cta-class text
  bodyText: string; // first ~2000 chars of cleaned copy
  primaryColor: string | null; // theme-color meta when present
  fonts: string[]; // first font-families found in inline <style>
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterHandle: string | null;
  exclamationCount: number;
  questionCount: number;
  emojiCount: number;
  averageSentenceLength: number;
  error?: string;
}

function emptyResult(url: string, error?: string): WebScrapingResult {
  return {
    url,
    title: '',
    metaDescription: '',
    headlines: [],
    ctaTexts: [],
    bodyText: '',
    primaryColor: null,
    fonts: [],
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    twitterHandle: null,
    exclamationCount: 0,
    questionCount: 0,
    emojiCount: 0,
    averageSentenceLength: 0,
    ...(error ? { error } : {}),
  };
}

export async function scrapeWebsite(
  inputUrl: string
): Promise<WebScrapingResult> {
  // Accept "example.com" or "https://example.com" — coerce to https
  // when no scheme. Reject anything that isn't a valid URL after that.
  let validUrl: URL;
  try {
    validUrl = new URL(
      inputUrl.startsWith('http://') || inputUrl.startsWith('https://')
        ? inputUrl
        : `https://${inputUrl}`
    );
  } catch {
    return emptyResult(inputUrl, 'Invalid URL');
  }

  if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
    return emptyResult(validUrl.toString(), 'Only http/https URLs are allowed');
  }

  let html: string;
  try {
    const response = await fetch(validUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HelmBot/1.0; +https://trythelm.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return emptyResult(
        validUrl.toString(),
        `Fetch failed: HTTP ${response.status}`
      );
    }
    html = await response.text();
  } catch (e) {
    return emptyResult(
      validUrl.toString(),
      e instanceof Error ? e.message : 'Network error'
    );
  }

  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') ?? '';
  const ogTitle = $('meta[property="og:title"]').attr('content') ?? null;
  const ogDescription =
    $('meta[property="og:description"]').attr('content') ?? null;
  const ogImage = $('meta[property="og:image"]').attr('content') ?? null;
  const twitterHandle =
    $('meta[name="twitter:site"]').attr('content') ?? null;
  const primaryColor =
    $('meta[name="theme-color"]').attr('content') ?? null;

  // Headlines: capped at 200 chars/each (skip junk like "← back to top")
  // and 20 total.
  const headlines: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length <= 200 && text.length >= 3) {
      headlines.push(text);
    }
  });

  // CTAs: buttons + anchors whose class hints at button/cta. We DON'T
  // dedupe via lowercase because copy like "Sign up" vs. "SIGN UP"
  // tends to come from the same component anyway and the dedupe is
  // done below via Set.
  const ctaTexts: string[] = [];
  $(
    'button, a[class*="btn" i], a[class*="button" i], a[class*="cta" i], [role="button"]'
  ).each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length >= 2 && text.length <= 50) {
      ctaTexts.push(text);
    }
  });

  // Body text: drop scripts/styles/nav/footer noise, then collapse
  // whitespace and clip. The 3000-char read fed into 2000-char output
  // gives us a buffer for the trim/collapse step.
  $('script, style, noscript, nav, footer, header').remove();
  const rawBody = $('body').text();
  const cleanBody = rawBody.replace(/\s+/g, ' ').trim();
  const bodyText = cleanBody.substring(0, 2000);

  // Fonts: scan inline <style> blocks for font-family declarations.
  // We don't fetch external CSS — that would multiply the request
  // count and the inline hint is usually enough to identify the
  // primary headline font on landing pages.
  const fonts: string[] = [];
  const styleBlob = $('style').text();
  const fontMatches = styleBlob.match(/font-family\s*:\s*([^;}{]+)/gi) ?? [];
  for (const raw of fontMatches.slice(0, 20)) {
    const value = raw
      .replace(/font-family\s*:\s*/i, '')
      .replace(/['"`]/g, '')
      .split(',')[0]
      .trim();
    if (value && !fonts.includes(value) && fonts.length < 5) {
      fonts.push(value);
    }
  }

  // Tone counters — operate on the cleaned body.
  const exclamationCount = (cleanBody.match(/!/g) ?? []).length;
  const questionCount = (cleanBody.match(/\?/g) ?? []).length;
  const emojiCount = (
    cleanBody.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) ?? []
  ).length;
  const sentences = cleanBody
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const averageSentenceLength =
    sentences.length > 0
      ? Math.round(
          sentences.reduce((acc, s) => acc + s.split(/\s+/).length, 0) /
            sentences.length
        )
      : 0;

  return {
    url: validUrl.toString(),
    title,
    metaDescription,
    headlines: headlines.slice(0, 20),
    ctaTexts: [...new Set(ctaTexts)].slice(0, 15),
    bodyText,
    primaryColor,
    fonts,
    ogTitle,
    ogDescription,
    ogImage,
    twitterHandle,
    exclamationCount,
    questionCount,
    emojiCount,
    averageSentenceLength,
  };
}
