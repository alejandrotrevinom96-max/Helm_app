// Sprint 7.16 — apply Adaptive Voice Engine schema to prod.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-sprint-7.16-voice-engine.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.16] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('client_contexts', 'voice_engine_audit_log')
    ORDER BY table_name;
  `;
  console.log(
    '[hotfix-7.16] tables present:',
    tables.map((t) => t.table_name).join(', '),
  );
  if (tables.length !== 2) {
    console.error('[hotfix-7.16] expected 2 tables, missing some');
    process.exit(1);
  }

  const indexes = await client`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'voice_engine_audit_%'
    ORDER BY indexname;
  `;
  console.log(
    '[hotfix-7.16] indexes:',
    indexes.map((i) => i.indexname).join(', '),
  );

  console.log('[hotfix-7.16] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.16] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
