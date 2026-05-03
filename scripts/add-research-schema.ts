import { loadEnvConfig } from '@next/env';

// Same pattern as the previous schema scripts: load Next's .env.local before
// importing db, then run idempotent SQL. drizzle-kit push has a parser bug
// we hit before; this avoids it.
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• research_config table …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS research_config (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      keywords jsonb DEFAULT '[]'::jsonb,
      competitors jsonb DEFAULT '[]'::jsonb,
      exclude_words jsonb DEFAULT '[]'::jsonb,
      sources jsonb DEFAULT '{"reddit":true,"hackernews":true,"indiehackers":true,"googleTrends":true}'::jsonb,
      last_synced_at timestamp,
      weekly_insight text,
      weekly_insight_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  console.log('• research_findings.source (no-op if already there) …');
  await db.execute(sql`
    ALTER TABLE research_findings
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'reddit'
  `);

  console.log('\nVerifying:');
  const tables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'research_config'
  `)) as Array<{ table_name: string }>;
  console.log('  research_config exists:', tables.length > 0);

  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'research_findings' AND column_name = 'source'
  `)) as Array<{ column_name: string }>;
  console.log('  research_findings.source exists:', cols.length > 0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
