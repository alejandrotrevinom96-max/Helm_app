// Supabase Management API client
// Docs: https://supabase.com/docs/reference/api/introduction
// Used to query the user's OWN Supabase project (not Helm's database)
//
// Every helper that reads project data goes through the same SQL query
// endpoint (/v1/projects/{ref}/database/query). Quoting & validation
// matter — the management API runs the SQL as service-role so a careless
// concat is a real injection vector.

const BASE = 'https://api.supabase.com';

// Tables the user shouldn't be allowed to count or expose. We reject
// any table name that includes a dot prefix outside this allowlist —
// only `auth.users` is special-cased on the way in (server-side).
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
 * List public-schema tables in the user's Supabase project. Used by the
 * /api/integrations/supabase/list-tables endpoint to populate the
 * "tables to track" UI in Integrations.
 */
export async function listPublicTables(
  accessToken: string,
  projectRef: string
): Promise<string[]> {
  const query = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
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
  const rows = (await res.json()) as Array<{ table_name: string }>;
  return rows.map((r) => r.table_name).filter((n) => TABLE_NAME_RE.test(n));
}

/**
 * Count rows in a single table. The table name is sanity-checked
 * against TABLE_NAME_RE before being interpolated — never call this
 * with raw user input.
 *
 * Special case: `auth.users` reuses getAuthUsersCount() so the helper
 * has a uniform "give me a count for this metric" surface.
 */
export async function getTableCount(
  accessToken: string,
  projectRef: string,
  tableName: string
): Promise<number> {
  if (tableName === 'auth.users') {
    return getAuthUsersCount(accessToken, projectRef);
  }
  if (!TABLE_NAME_RE.test(tableName)) {
    // Reject anything that doesn't look like a bare identifier. Schema
    // prefixes other than `auth.users` aren't supported yet.
    return 0;
  }
  const query = `SELECT count(*)::int as count FROM public."${tableName}"`;
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
  const data = (await res.json()) as Array<{ count: number }>;
  return data?.[0]?.count ?? 0;
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
