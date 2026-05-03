import { loadEnvConfig } from '@next/env';

async function main() {
  // Load .env.local before importing db (which evaluates DATABASE_URL at import time)
  loadEnvConfig(process.cwd());

  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  const beforeRows = (await db.execute(
    sql`SELECT count(*)::int as n FROM projects`
  )) as Array<{ n: number }>;
  const before = beforeRows[0]?.n ?? 0;
  console.log(`projects before: ${before}`);

  // Keep the OLDEST row per (user_id, github_repo_id), delete the rest.
  // Done in a single statement so it's atomic and idempotent.
  await db.execute(sql`
    DELETE FROM projects
    WHERE id NOT IN (
      SELECT DISTINCT ON (user_id, github_repo_id) id
      FROM projects
      ORDER BY user_id, github_repo_id, created_at ASC
    )
  `);

  const afterRows = (await db.execute(
    sql`SELECT count(*)::int as n FROM projects`
  )) as Array<{ n: number }>;
  const after = afterRows[0]?.n ?? 0;
  console.log(`projects after:  ${after}`);
  console.log(`removed:         ${before - after}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
