// Supabase Management API client
// Docs: https://supabase.com/docs/reference/api/introduction
// Used to query the user's OWN Supabase project (not Helm's database)

const BASE = 'https://api.supabase.com';

export async function listUserProjects(accessToken: string) {
  const res = await fetch(`${BASE}/v1/projects`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Supabase Management API error: ${res.status}`);
  return await res.json();
}

/**
 * Get auth users count via SQL query
 * (uses pg-meta endpoint)
 */
export async function getAuthUsersCount(
  accessToken: string,
  projectRef: string,
  sinceDays?: number
): Promise<number> {
  const whereClause = sinceDays
    ? `WHERE created_at >= now() - interval '${sinceDays} days'`
    : '';
  const query = `SELECT count(*)::int as count FROM auth.users ${whereClause}`;

  const res = await fetch(
    `${BASE}/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) return 0;
  const data = await res.json();
  return data?.[0]?.count ?? 0;
}

/**
 * Get recent signups (for activity feed)
 */
export async function getRecentSignups(
  accessToken: string,
  projectRef: string,
  limit: number = 10
) {
  const query = `
    SELECT id, email, created_at
    FROM auth.users
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const res = await fetch(
    `${BASE}/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) return [];
  return await res.json();
}

/**
 * Get daily signup counts for a chart (last N days)
 */
export async function getDailySignups(
  accessToken: string,
  projectRef: string,
  days: number = 30
) {
  const query = `
    SELECT
      date_trunc('day', created_at)::date as day,
      count(*)::int as signups
    FROM auth.users
    WHERE created_at >= now() - interval '${days} days'
    GROUP BY day
    ORDER BY day ASC
  `;

  const res = await fetch(
    `${BASE}/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) return [];
  return await res.json();
}
