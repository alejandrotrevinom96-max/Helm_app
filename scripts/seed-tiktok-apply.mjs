// PR #88 — Sprint 7.12: apply TikTok content_types seed to prod.
//
// Reads scripts/seed-tiktok-content-types.sql and runs it against
// DATABASE_URL. Idempotent — the SQL uses ON CONFLICT DO NOTHING
// against the content_types_platform_type_uk constraint, so
// re-running is safe.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'seed-tiktok-content-types.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[seed-tiktok] applying ${sqlPath}`);
console.log(`[seed-tiktok] host=${new URL(url.replace(/^postgres:/, 'postgresql:')).host}`);

const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);
  // Verify the rows are now present.
  const rows = await client`
    SELECT type, display_name, default_enabled
    FROM content_types
    WHERE platform = 'tiktok'
    ORDER BY display_order;
  `;
  console.log('[seed-tiktok] tiktok content_types rows:');
  for (const r of rows) {
    console.log(`  - ${r.type.padEnd(10)} | ${r.display_name}`);
  }
  if (rows.length !== 3) {
    console.error(`[seed-tiktok] expected 3 rows, got ${rows.length}`);
    process.exit(1);
  }
  console.log('[seed-tiktok] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[seed-tiktok] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
