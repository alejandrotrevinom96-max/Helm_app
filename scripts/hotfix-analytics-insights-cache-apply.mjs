// PR Sprint 7.20 — apply the analytics_insights_cache table.
// Wraps hotfix-analytics-insights-cache.sql so CI / a teammate can
// run it with `node scripts/hotfix-analytics-insights-cache-apply.mjs`
// instead of manually pasting into the Supabase SQL editor.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-analytics-insights-cache.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.20-insights] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'analytics_insights_cache';
  `;
  if (tables.length !== 1) {
    console.error(
      '[hotfix-7.20-insights] analytics_insights_cache missing after apply',
    );
    process.exit(1);
  }

  const idx = await client`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analytics_insights_cache'
    ORDER BY indexname;
  `;
  console.log(
    '[hotfix-7.20-insights] indexes:',
    idx.map((r) => r.indexname).join(', '),
  );

  console.log('[hotfix-7.20-insights] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.20-insights] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
