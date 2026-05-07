// PR #36 — Sprint 6.2.2: best-effort Instagram public scraping.
//
// Meta blocks ~30% of unauth scrape attempts. We don't fight that —
// we use a browser-like User-Agent, take what we can from the public
// OG tags, and surface a clear error when the login wall comes
// down. The rate limiter (PR #34/#36) ensures a flood of failures
// doesn't burn the user's hourly cap (we only commit after the
// Anthropic call, which doesn't run on IG-scrape failures).
//
// What we extract (all from public OG / meta tags — no login):
//   - og:title    → "Display Name (@handle) • Instagram photos and videos"
//   - og:description → "X Followers, Y Following, Z Posts · See …"
//   - meta description → similar, sometimes with bio inline
//   - og:image    → profile picture URL
//
// What we DON'T scrape:
//   - Recent posts (require auth or shared-data ID resolution)
//   - Stories / reels metadata
//   - Hashtag history
//
// If demand grows past best-effort, Sprint 6.4 considers Apify or
// the official Instagram Graph API.
import * as cheerio from 'cheerio';

export interface InstagramData {
  handle: string;
  displayName: string | null;
  bio: string | null;
  followerText: string | null;
  profilePicUrl: string | null;
}

export interface InstagramScrapeError {
  error: string;
}

export type InstagramScrapeResult = InstagramData | InstagramScrapeError;

export function isInstagramScrapeError(
  result: InstagramScrapeResult
): result is InstagramScrapeError {
  return 'error' in result;
}

// Indicators that Meta served us a login wall instead of the
// public profile page. The string set is empirical — Meta rotates
// markup but these have been consistent.
function isLoginWall(html: string): boolean {
  if (html.length < 5000) return true;
  const haystack = html.slice(0, 50000); // first 50KB is enough
  return (
    haystack.includes('"login_form"') ||
    haystack.includes('id="loginForm"') ||
    haystack.includes('Page Not Found • Instagram') ||
    /login\?next=%2F/i.test(haystack)
  );
}

export async function scrapeInstagramPublic(
  handle: string
): Promise<InstagramScrapeResult> {
  const url = `https://www.instagram.com/${handle}/`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // Real browser User-Agent — Meta's anti-bot is laxer on
        // headers that look like a legitimate visitor. Updated
        // periodically; current value is Chrome 120 on macOS.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return { error: 'Instagram took too long to respond. Try again.' };
    }
    return {
      error:
        e instanceof Error
          ? `Could not reach Instagram: ${e.message}`
          : 'Could not reach Instagram',
    };
  }

  if (response.status === 404) {
    return { error: `Instagram profile @${handle} not found.` };
  }
  if (!response.ok) {
    return {
      error: `Instagram returned HTTP ${response.status}. Could not access profile.`,
    };
  }

  const html = await response.text();

  if (isLoginWall(html)) {
    return {
      error:
        'Instagram blocked this request behind a login wall. Try a website URL instead, or sign up to scan the profile from your account.',
    };
  }

  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? '';
  const ogDescription =
    $('meta[property="og:description"]').attr('content')?.trim() ?? '';
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() ?? '';
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ?? '';

  // og:title shape: "Display Name (@handle) • Instagram photos and videos"
  let displayName: string | null = null;
  const titleMatch = ogTitle.match(/^(.+?)\s*\(@/);
  if (titleMatch) displayName = titleMatch[1].trim() || null;

  // Stats: "10K Followers, 500 Following, 200 Posts" — present on
  // both og:description and meta description on most profiles.
  let followerText: string | null = null;
  const followerRe =
    /([\d.,]+\s*[KM]?\s*Followers?,\s*[\d.,]+\s*[KM]?\s*Following,\s*[\d.,]+\s*[KM]?\s*Posts?)/i;
  const followerSource = `${ogDescription}\n${metaDescription}`;
  const followerMatch = followerSource.match(followerRe);
  if (followerMatch) followerText = followerMatch[1];

  // Bio: meta[name="description"] usually leads with the bio for
  // public profiles, then the stats sentence. We take everything
  // BEFORE the stats line if present, otherwise the first 280
  // chars (Instagram bio cap). Drop trailing " - See Instagram…"
  // boilerplate Meta appends.
  let bio: string | null = null;
  const candidate = metaDescription || ogDescription;
  if (candidate) {
    let extracted = candidate;
    const followerIdx = extracted.search(followerRe);
    if (followerIdx > 0) {
      extracted = extracted.slice(0, followerIdx).trim();
    }
    extracted = extracted
      .replace(/-?\s*See Instagram.*$/i, '')
      .replace(/^[“"']|[”"']$/g, '')
      .trim();
    if (extracted.length > 5 && extracted.length < 500) {
      bio = extracted;
    }
  }

  // Validate we got *something* useful. If everything is empty,
  // Meta probably served a stub page that bypassed isLoginWall.
  if (!displayName && !bio && !followerText) {
    return {
      error:
        'Could not extract Instagram profile data. The profile may be private or Meta blocked the request.',
    };
  }

  return {
    handle,
    displayName,
    bio,
    followerText,
    profilePicUrl: ogImage || null,
  };
}

// Builds the prompt context string fed to Claude. Keep it concise —
// Haiku gets confused by long context when the actual signal is
// short. We mark the source explicitly so the model adjusts its
// confidence (an IG bio gives us ~10% of what a website does).
export function instagramDataToContext(data: InstagramData): string {
  const parts = [`Instagram profile: @${data.handle}`];
  if (data.displayName) parts.push(`Display name: ${data.displayName}`);
  if (data.bio) parts.push(`Bio: ${data.bio}`);
  if (data.followerText) parts.push(`Stats: ${data.followerText}`);
  parts.push(
    'NOTE: Source is Instagram bio + meta tags only. Less data than a website. Pick conservative archetype/voice if the bio is sparse.'
  );
  return parts.join('\n');
}
