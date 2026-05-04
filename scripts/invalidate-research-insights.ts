import { loadEnvConfig } from '@next/env';

// PR #16 fixed prompt-poisoning in lib/research/generate-insight.ts.
// Insights cached BEFORE this fix may contain hallucinated cross-domain
// content (e.g. Voya / travel project showing indie-hacker insights).
// This script clears the cached insight + timestamp on every project so
// the next /api/research/synthesize call (or the daily cron) regenerates
// with the new bible-aware prompt.
//
// SAFE: doesn't delete findings, doesn't touch keywords/competitors/sources.
// Only clears `weekly_insight` + `weekly_insight_at` columns.
//
// Run manually after the PR #16 deploy:
//   DATABASE_URL=<prod> npx tsx scripts/invalidate-research-insights.ts
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• inspecting current cached insights …');
  const before = (await db.execute(sql`
    SELECT count(*)::int as n FROM research_config WHERE weekly_insight IS NOT NULL
  `)) as Array<{ n: number }>;
  console.log('  cached insights before:', before[0]?.n ?? 0);

  console.log('• clearing weekly_insight on all projects …');
  await db.execute(sql`
    UPDATE research_config
    SET weekly_insight = NULL,
        weekly_insight_at = NULL
    WHERE weekly_insight IS NOT NULL
  `);

  const after = (await db.execute(sql`
    SELECT count(*)::int as n FROM research_config WHERE weekly_insight IS NOT NULL
  `)) as Array<{ n: number }>;
  console.log('  cached insights after:', after[0]?.n ?? 0);
  console.log(
    '\nNext step: have each user click "Generate insight" or wait for the daily cron.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
