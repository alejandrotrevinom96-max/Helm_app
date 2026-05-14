// Sprint 7.19 — apply optional visual_prompt_ir_log audit table.
// Idempotent. Run when you want telemetry on visual generations
// (the pipeline works fine without it — the table is additive).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-visual-prompt-ir-log.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-visuals-log] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'visual_prompt_ir_log';
  `;
  if (tables.length !== 1) {
    console.error('[hotfix-visuals-log] table missing after apply');
    process.exit(1);
  }
  console.log('[hotfix-visuals-log] ✓ visual_prompt_ir_log present');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-visuals-log] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
