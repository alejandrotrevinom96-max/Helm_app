// Sprint 7.15 — apply chat_messages migration to prod.
// Idempotent. Same pattern as the other hotfix scripts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-sprint-7.15-chat.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.15] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);
  const [tbl] = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_messages';
  `;
  if (!tbl) {
    console.error('[hotfix-7.15] chat_messages not present after migration');
    process.exit(1);
  }
  const cols = await client`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'chat_messages'
    ORDER BY column_name;
  `;
  console.log(
    '[hotfix-7.15] chat_messages columns:',
    cols.map((c) => c.column_name).join(', '),
  );
  console.log('[hotfix-7.15] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.15] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
