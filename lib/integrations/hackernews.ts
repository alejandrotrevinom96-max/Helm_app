// Hacker News search via Algolia (free, no auth required).
// Docs: https://hn.algolia.com/api

interface HNStory {
  objectID: string;
  title: string;
  url: string | null;
  story_text: string | null;
  points: number;
  num_comments: number;
  created_at_i: number;
  author: string;
}

export interface HNResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  numComments: number;
  date: Date;
  author: string;
}

export async function searchHackerNews(
  query: string,
  options: { limit?: number; daysBack?: number } = {}
): Promise<HNResult[]> {
  const { limit = 25, daysBack = 7 } = options;
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400;

  const url = new URL('https://hn.algolia.com/api/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('numericFilters', `created_at_i>${since}`);
  url.searchParams.set('hitsPerPage', limit.toString());

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.hits || []) as HNStory[]).map((h) => ({
      id: `hn-${h.objectID}`,
      title: h.title || '',
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: h.story_text?.slice(0, 300) || '',
      score: h.points || 0,
      numComments: h.num_comments || 0,
      date: new Date(h.created_at_i * 1000),
      author: h.author || 'unknown',
    }));
  } catch {
    return [];
  }
}
