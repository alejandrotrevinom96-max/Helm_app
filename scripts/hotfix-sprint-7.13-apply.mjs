// Sprint 7.13 (BUG 2) — apply the Brand fit score schema delta.
// One-shot idempotent migration. Same pattern as hotfix-apply.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-sprint-7.13-bug2.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.13] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);
  const cols = await client`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'generated_posts'
      AND column_name IN ('consistency_score', 'score_breakdown')
    ORDER BY column_name;
  `;
  console.log(
    '[hotfix-7.13] generated_posts columns:',
    cols.map((c) => c.column_name).join(', '),
  );
  if (cols.length !== 2) {
    console.error(`[hotfix-7.13] expected 2 cols, got ${cols.length}`);
    process.exit(1);
  }
  console.log('[hotfix-7.13] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.13] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
