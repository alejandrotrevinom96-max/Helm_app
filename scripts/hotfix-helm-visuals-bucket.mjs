// Sprint 7.13 (BUG 3B) — apply the helm-visuals bucket setup to
// prod. Idempotent. Same connection pattern as the other hotfix
// scripts (postgres.js + DATABASE_URL).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-helm-visuals-bucket.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[helm-visuals] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  // Verify: bucket exists + is public.
  const [bucket] = await client`
    SELECT id, name, public
    FROM storage.buckets
    WHERE id = 'helm-visuals';
  `;
  if (!bucket) {
    console.error('[helm-visuals] bucket not present after migration');
    process.exit(1);
  }
  console.log(
    `[helm-visuals] bucket: id=${bucket.id} public=${bucket.public}`,
  );

  // Verify: policies present.
  const policies = await client`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE '%helm-visuals%'
    ORDER BY policyname;
  `;
  console.log(
    '[helm-visuals] policies:',
    policies.map((p) => p.policyname).join(', '),
  );

  if (policies.length < 2) {
    console.error('[helm-visuals] expected ≥2 policies, missing some');
    process.exit(1);
  }

  console.log('[helm-visuals] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[helm-visuals] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
