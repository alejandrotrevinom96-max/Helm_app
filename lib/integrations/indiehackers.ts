// Indie Hackers does not have a public search API. We pull the forum RSS feed
// (~30 most recent threads) and filter client-side by user keywords.

export interface IHResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  date: Date;
}

export async function fetchIndieHackersFeed(): Promise<IHResult[]> {
  const url = 'https://www.indiehackers.com/forum.rss';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Helm/1.0 (+https://helm2.vercel.app)' },
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items: IHResult[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title =
        (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ||
          [])[1] || '';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
      const desc =
        (block.match(
          /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/
        ) || [])[1] || '';
      const guid = (block.match(/<guid[^>]*>(.*?)<\/guid>/) || [])[1] || link;
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';

      const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
      if (!cleanTitle) continue;

      items.push({
        id: `ih-${guid}`,
        title: cleanTitle,
        url: link.trim(),
        snippet: desc.replace(/<[^>]+>/g, '').trim().slice(0, 300),
        date: new Date(pubDate || Date.now()),
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function filterByKeywords<T extends { title: string; snippet: string }>(
  items: T[],
  keywords: string[]
): T[] {
  if (keywords.length === 0) return items;
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return items.filter((item) => {
    const text = (item.title + ' ' + item.snippet).toLowerCase();
    return lowerKeywords.some((k) => text.includes(k));
  });
}
