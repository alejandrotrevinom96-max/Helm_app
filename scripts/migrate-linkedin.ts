// PR #66 — Sprint 7.0.9: linkedin_integrations table for per-project
// LinkedIn OAuth state.
//
// Run with: `npx tsx scripts/migrate-linkedin.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating linkedin_integrations…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS linkedin_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT,
      token_expires_at TIMESTAMP,
      linkedin_user_id TEXT NOT NULL,
      linkedin_name TEXT,
      linkedin_handle TEXT,
      scopes JSONB,
      status TEXT NOT NULL DEFAULT 'connected',
      last_error TEXT,
      connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT linkedin_integrations_project_uk UNIQUE (project_id)
    )
  `);
  console.log('[migrate]  ✓ linkedin_integrations');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS linkedin_integrations_user_idx
      ON linkedin_integrations (user_id)
  `);
  console.log('[migrate]  ✓ linkedin_integrations_user_idx');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
