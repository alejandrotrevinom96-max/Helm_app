// PR Sprint 7.24 — apply the generated_posts variant columns.
// Wraps hotfix-generated-posts-variants.sql so CI / a teammate
// can run it via `node scripts/hotfix-generated-posts-variants-apply.mjs`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-generated-posts-variants.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.24-variants] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const cols = await client`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'generated_posts'
      AND column_name IN ('variant_label', 'variant_group_id')
    ORDER BY column_name;
  `;
  console.log(
    '[hotfix-7.24-variants] columns:',
    cols.map((r) => r.column_name).join(', '),
  );
  if (cols.length !== 2) {
    console.error(
      '[hotfix-7.24-variants] expected 2 columns, missing some',
    );
    process.exit(1);
  }

  const idx = await client`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'generated_posts'
      AND indexname = 'generated_posts_variant_group_idx';
  `;
  console.log(
    '[hotfix-7.24-variants] partial index present:',
    idx.length === 1,
  );

  console.log('[hotfix-7.24-variants] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.24-variants] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
