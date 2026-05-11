// PR #59 — Sprint 7.0.3: Reddit RSS client.
//
// Reddit's JSON API blocks cloud-provider IPs (Vercel/AWS) and OAuth
// is now Devvit-only. RSS at https://www.reddit.com/r/<sub>/.rss
// remains public, unauthenticated, and works from Vercel.
//
// Design rules:
//   - Cache every fetch for 24h via lib/research/cache (Postgres).
//     This also serves as our rate limiter: we never hit the same
//     subreddit twice in 24h.
//   - User-Agent must identify the caller per Reddit's policy.
//   - Auto-disable after 3 consecutive failures across a 6h window
//     so a Reddit outage doesn't burn our quota or spam logs. Auto-
//     resets after 6h.
//
// We don't import the rss-parser default export inside the module
// body because it pulls a heavy http2 dependency tree that we'd
// rather warm only when actually needed; the dynamic import below
// keeps cold-start cost off the hot path that just reads cache.
import { getCached, setCached } from './cache';

export interface RedditRssPost {
  title: string;
  link: string;
  pubDate: string | null;
  contentSnippet: string;
  author: string | null;
  subreddit: string;
}

interface RedditHealth {
  failureCount: number;
  lastFailureAt: number; // epoch ms
}

const CACHE_TTL_HOURS = 24;
const POST_LIMIT = 25;
const CACHE_PREFIX = 'reddit:rss:';
const HEALTH_KEY = 'reddit:health';
const MAX_FAILURES = 3;
const HEALTH_RESET_HOURS = 6;
const FETCH_TIMEOUT_MS = 10_000;

function getUserAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT ??
    'Helm/1.0 (contact: hello@trythelm.com)'
  );
}

function normalizeSubredditName(input: string): string {
  return input.replace(/^r\//i, '').toLowerCase().trim();
}

async function recordFailure(): Promise<void> {
  const current = await getCached<RedditHealth>(HEALTH_KEY);
  const next: RedditHealth = {
    failureCount: (current?.failureCount ?? 0) + 1,
    lastFailureAt: Date.now(),
  };
  await setCached(HEALTH_KEY, next, 24);
}

async function clearFailures(): Promise<void> {
  const empty: RedditHealth = { failureCount: 0, lastFailureAt: 0 };
  await setCached(HEALTH_KEY, empty, 24);
}

export interface RedditHealthStatus {
  healthy: boolean;
  failureCount: number;
  message: string;
}

export async function getRedditHealth(): Promise<RedditHealthStatus> {
  const health = await getCached<RedditHealth>(HEALTH_KEY);
  if (!health || health.failureCount === 0) {
    return {
      healthy: true,
      failureCount: 0,
      message: 'Reddit RSS healthy',
    };
  }
  if (health.failureCount < MAX_FAILURES) {
    return {
      healthy: true,
      failureCount: health.failureCount,
      message: `Reddit RSS degraded (${health.failureCount} recent failure${health.failureCount === 1 ? '' : 's'})`,
    };
  }
  const hoursSince =
    (Date.now() - health.lastFailureAt) / (60 * 60 * 1000);
  return {
    healthy: false,
    failureCount: health.failureCount,
    message: `Reddit RSS temporarily disabled (${health.failureCount} failures, last ${hoursSince.toFixed(1)}h ago — auto-reset in ${Math.max(0, HEALTH_RESET_HOURS - hoursSince).toFixed(1)}h)`,
  };
}

/**
 * Fetch a subreddit's RSS feed with cache + auto-disable. Returns
 * an empty array (never throws) so callers can iterate over many
 * subreddits without one bad feed breaking the rest.
 */
export async function fetchSubredditRSS(
  subreddit: string,
): Promise<RedditRssPost[]> {
  const name = normalizeSubredditName(subreddit);
  if (!name || name.length < 2) return [];

  const cacheKey = `${CACHE_PREFIX}${name}`;
  const cached = await getCached<RedditRssPost[]>(cacheKey);
  if (cached && Array.isArray(cached)) {
    return cached;
  }

  // Auto-disable: too many recent failures? Bail without burning
  // another fetch. The 6h cooldown lets Reddit recover on its own.
  const health = await getCached<RedditHealth>(HEALTH_KEY);
  if (
    health &&
    health.failureCount >= MAX_FAILURES &&
    Date.now() - health.lastFailureAt <
      HEALTH_RESET_HOURS * 60 * 60 * 1000
  ) {
    return [];
  }
  // Past the cooldown? Reset and try again.
  if (
    health &&
    health.failureCount >= MAX_FAILURES &&
    Date.now() - health.lastFailureAt >=
      HEALTH_RESET_HOURS * 60 * 60 * 1000
  ) {
    await clearFailures();
  }

  const url = `https://www.reddit.com/r/${name}/.rss`;

  try {
    const Parser = (await import('rss-parser')).default;
    const parser = new Parser({
      headers: { 'User-Agent': getUserAgent() },
      timeout: FETCH_TIMEOUT_MS,
    });
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? []).slice(0, POST_LIMIT);

    const posts: RedditRssPost[] = items.map((item) => ({
      title: (item.title ?? '').toString(),
      link: (item.link ?? '').toString(),
      pubDate: item.pubDate ?? item.isoDate ?? null,
      contentSnippet:
        item.contentSnippet ??
        (typeof item.content === 'string' ? item.content : '') ??
        '',
      author: item.author ?? item.creator ?? null,
      subreddit: name,
    }));

    if (posts.length === 0) {
      await recordFailure();
      return [];
    }

    await setCached(cacheKey, posts, CACHE_TTL_HOURS);
    await clearFailures();
    return posts;
  } catch (err) {
    console.error(
      `[reddit-rss] fetch failed for r/${name}:`,
      err instanceof Error ? err.message : err,
    );
    await recordFailure();
    return [];
  }
}
