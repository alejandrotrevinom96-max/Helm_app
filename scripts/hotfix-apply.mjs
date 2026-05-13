// PR #86 / #87 hotfix — apply schema deltas Drizzle never pushed.
//
// One-shot script: reads drizzle/hotfix-sprint-7.10-7.11.sql,
// connects with the postgres driver already in the project, runs
// it, exits. Idempotent SQL (IF NOT EXISTS / DO blocks for
// constraints) so re-running is safe.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-sprint-7.10-7.11.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix] applying ${sqlPath}`);
console.log(`[hotfix] host=${new URL(url.replace(/^postgres:/, 'postgresql:')).host}`);

const client = postgres(url, {
  max: 1,
  // Supabase pooler needs prepare=false for some statements.
  prepare: false,
  ssl: 'require',
});

try {
  // postgres-js .unsafe(...) runs the SQL string verbatim — needed
  // for multi-statement migrations with DO blocks.
  await client.unsafe(sql);
  console.log('[hotfix] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
