// Reddit JSON API — public, no auth required for read-only
// Rate limit: 60 requests/minute

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  ups: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  author: string;
}

interface RedditListing {
  data: {
    children: { data: RedditPost }[];
  };
}

const RELEVANT_SUBREDDITS = [
  'SaaS',
  'indiehackers',
  'startups',
  'EntrepreneurRideAlong',
  'sideproject',
  'webdev',
  'micro_saas',
];

/**
 * Search across multiple subreddits for posts matching a query.
 */
export async function searchReddit(
  query: string,
  options: { limit?: number; timeRange?: 'day' | 'week' | 'month' } = {}
): Promise<RedditPost[]> {
  const { limit = 25, timeRange = 'week' } = options;

  const subredditQuery = RELEVANT_SUBREDDITS.map((s) => `subreddit:${s}`).join(' OR ');
  const fullQuery = `(${subredditQuery}) ${query}`;

  const url = new URL('https://www.reddit.com/search.json');
  url.searchParams.set('q', fullQuery);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('t', timeRange);
  url.searchParams.set('sort', 'relevance');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Helm/1.0 (indie hacker tool)' },
  });

  if (!res.ok) {
    console.error('Reddit search failed:', res.status);
    return [];
  }

  const data: RedditListing = await res.json();
  return data.data.children.map((c) => c.data);
}

/**
 * Get hot posts from indie hacker subreddits (general scan).
 */
export async function getHotPosts(limit: number = 50): Promise<RedditPost[]> {
  const allPosts: RedditPost[] = [];

  for (const sub of RELEVANT_SUBREDDITS.slice(0, 4)) {
    const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${Math.ceil(limit / 4)}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Helm/1.0 (indie hacker tool)' },
      });
      if (!res.ok) continue;
      const data: RedditListing = await res.json();
      allPosts.push(...data.data.children.map((c) => c.data));
    } catch {
      continue;
    }
  }

  return allPosts;
}
