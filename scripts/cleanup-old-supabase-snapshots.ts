import { loadEnvConfig } from '@next/env';

// PR #19 changed the Supabase sync to write one snapshot per configured
// table (metric = 'auth.users' / 'profiles' / 'waitlist' / etc.). Pre-PR-19
// snapshots used a single metric='signups' row that doesn't map to any
// configured table, so they show up in the dashboard as a phantom
// "Signups (legacy)" widget alongside the real ones.
//
// This script deletes those legacy rows. The next "Sync now" repopulates
// with the new table-named metrics. NOT auto-run — read-destructive.
//
// Run manually:
//   DATABASE_URL=<prod> npx tsx scripts/cleanup-old-supabase-snapshots.ts
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• inspecting legacy Supabase snapshots …');
  const before = (await db.execute(sql`
    SELECT count(*)::int as n
    FROM metric_snapshots
    WHERE source = 'supabase' AND metric = 'signups'
  `)) as Array<{ n: number }>;
  console.log('  legacy rows:', before[0]?.n ?? 0);

  if ((before[0]?.n ?? 0) === 0) {
    console.log('  nothing to delete — exiting.');
    return;
  }

  console.log('• deleting metric=signups Supabase snapshots …');
  await db.execute(sql`
    DELETE FROM metric_snapshots
    WHERE source = 'supabase' AND metric = 'signups'
  `);

  const after = (await db.execute(sql`
    SELECT count(*)::int as n
    FROM metric_snapshots
    WHERE source = 'supabase' AND metric = 'signups'
  `)) as Array<{ n: number }>;
  console.log('  legacy rows after:', after[0]?.n ?? 0);
  console.log(
    '\nNext step: have each user click "Sync now" in /integrations or wait for the daily cron.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
