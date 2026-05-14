// Sprint 7.19 — apply chat conversation/message tables + enable
// Supabase Realtime. Drops the Sprint 7.15 chat_messages table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'hotfix-sprint-7.19-chat.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

console.log(`[hotfix-7.19] applying ${sqlPath}`);
const client = postgres(url, { max: 1, prepare: false, ssl: 'require' });

try {
  await client.unsafe(sql);

  const tables = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('chat_conversations', 'chat_messages')
    ORDER BY table_name;
  `;
  console.log(
    '[hotfix-7.19] tables present:',
    tables.map((t) => t.table_name).join(', '),
  );
  if (tables.length !== 2) {
    console.error('[hotfix-7.19] expected 2 tables, missing some');
    process.exit(1);
  }

  // Verify Realtime publication.
  const pubs = await client`
    SELECT tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('chat_conversations', 'chat_messages')
    ORDER BY tablename;
  `;
  console.log(
    '[hotfix-7.19] realtime tables:',
    pubs.length > 0 ? pubs.map((p) => p.tablename).join(', ') : '(none)',
  );
  if (pubs.length !== 2) {
    console.warn(
      '[hotfix-7.19] Realtime publication missing one or both tables. Run the ALTER PUBLICATION statements manually in the Supabase SQL Editor if this didn\'t take.',
    );
  }

  console.log('[hotfix-7.19] ✓ applied successfully');
  process.exit(0);
} catch (e) {
  console.error('[hotfix-7.19] FAILED:', e.message);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
