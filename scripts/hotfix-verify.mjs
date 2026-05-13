// Verify Sprint 7.10/7.11 schema is present in production.
// Exit 0 = all good, 1 = something missing.
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  const cols = await client`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'projects'
      AND column_name IN (
        'heygen_avatar_type',
        'heygen_avatar_id',
        'heygen_photo_url',
        'heygen_voice_id'
      )
    ORDER BY column_name;
  `;
  console.log('[verify] projects columns:', cols.map((c) => c.column_name).join(', '));

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('tiktok_integrations', 'tiktok_publish_jobs')
    ORDER BY table_name;
  `;
  console.log('[verify] tables:', tables.map((t) => t.table_name).join(', '));

  const missing = [];
  if (cols.length !== 4) missing.push('projects columns');
  if (tables.length !== 2) missing.push('tiktok tables');
  if (missing.length > 0) {
    console.error('[verify] MISSING:', missing.join(', '));
    process.exit(1);
  }
  console.log('[verify] ✓ all required schema elements present');
} catch (e) {
  console.error('[verify] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
