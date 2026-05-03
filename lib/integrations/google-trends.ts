// Google Trends keyword tracking. The unofficial google-trends-api package
// scrapes Trends — Google may rate-limit. We cap to 5 keywords per call and
// swallow errors per keyword so one failure doesn't kill the rest.

// @ts-expect-error - the package doesn't ship type declarations
import googleTrends from 'google-trends-api';

export interface KeywordTrend {
  keyword: string;
  trend: 'up' | 'down' | 'flat';
  changePct: number;
  timeline: number[];
}

interface TimelinePoint {
  value?: number[];
}

interface TrendsResponse {
  default?: {
    timelineData?: TimelinePoint[];
  };
}

export async function getKeywordTrends(
  keywords: string[],
  geo: string = 'US'
): Promise<KeywordTrend[]> {
  if (keywords.length === 0) return [];

  const results = await Promise.all(
    keywords.slice(0, 5).map(async (keyword): Promise<KeywordTrend | null> => {
      try {
        const data: string = await googleTrends.interestOverTime({
          keyword,
          startTime: new Date(Date.now() - 90 * 86400 * 1000),
          geo,
        });
        const parsed = JSON.parse(data) as TrendsResponse;
        const timeline = parsed?.default?.timelineData ?? [];

        if (timeline.length < 14) return null;

        const recent = timeline.slice(-7).map((t) => t.value?.[0] ?? 0);
        const previous = timeline.slice(-14, -7).map((t) => t.value?.[0] ?? 0);
        const recentAvg =
          recent.reduce((a, b) => a + b, 0) / Math.max(recent.length, 1);
        const previousAvg =
          previous.reduce((a, b) => a + b, 0) / Math.max(previous.length, 1);
        const change =
          previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

        return {
          keyword,
          trend: change > 5 ? 'up' : change < -5 ? 'down' : 'flat',
          changePct: Math.round(change),
          timeline: timeline.slice(-30).map((t) => t.value?.[0] ?? 0),
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is KeywordTrend => r !== null);
}
