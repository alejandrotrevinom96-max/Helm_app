// Meta Marketing API client
// Docs: https://developers.facebook.com/docs/marketing-api

const API_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export async function listAdAccounts(accessToken: string) {
  const url = new URL(`${BASE}/me/adaccounts`);
  url.searchParams.set('fields', 'id,name,account_status,currency');
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

interface AdInsight {
  spend: string;
  impressions: string;
  clicks: string;
  reach: string;
  date_start: string;
  date_stop: string;
}

export async function getAdAccountInsights(
  accessToken: string,
  adAccountId: string,
  days: number = 30
): Promise<{
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalReach: number;
  daily: { date: string; spend: number; impressions: number; clicks: number }[];
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const until = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const url = new URL(`${BASE}/${adAccountId}/insights`);
  url.searchParams.set('fields', 'spend,impressions,clicks,reach');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set(
    'time_range',
    JSON.stringify({ since: fmt(since), until: fmt(until) })
  );
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return {
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalReach: 0,
      daily: [],
    };
  }

  const data = await res.json();
  const insights: AdInsight[] = data.data || [];

  const daily = insights.map((i) => ({
    date: i.date_start,
    spend: parseFloat(i.spend || '0'),
    impressions: parseInt(i.impressions || '0'),
    clicks: parseInt(i.clicks || '0'),
  }));

  const totalSpend = daily.reduce((sum, d) => sum + d.spend, 0);
  const totalImpressions = daily.reduce((sum, d) => sum + d.impressions, 0);
  const totalClicks = daily.reduce((sum, d) => sum + d.clicks, 0);
  const totalReach = insights.reduce(
    (sum, i) => sum + parseInt(i.reach || '0'),
    0
  );

  return { totalSpend, totalImpressions, totalClicks, totalReach, daily };
}
