// Sprint 7.19 Round 3a — apply metric_daily_snapshots table.
// Idempotent; safe to re-run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-metric-daily-snapshots.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-snapshots] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'metric_daily_snapshots';
  `;
  if (tables.length !== 1) {
    console.error('[hotfix-snapshots] table missing after apply');
    process.exit(1);
  }
  const indexes = await client`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='metric_daily_snapshots'
    ORDER BY indexname;
  `;
  console.log(
    '[hotfix-snapshots] indexes:',
    indexes.map((r) => r.indexname).join(', '),
  );
  console.log('[hotfix-snapshots] ✓ metric_daily_snapshots present');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-snapshots] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
