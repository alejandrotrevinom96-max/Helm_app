import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• research_findings.competitor …');
  await db.execute(sql`
    ALTER TABLE research_findings
    ADD COLUMN IF NOT EXISTS competitor text
  `);

  console.log('• partial index research_findings_competitor_idx …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS research_findings_competitor_idx
    ON research_findings(competitor)
    WHERE competitor IS NOT NULL
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'research_findings' AND column_name = 'competitor'
  `)) as Array<{ column_name: string }>;
  console.log('  competitor exists:', cols.length > 0);

  const idx = (await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'research_findings' AND indexname = 'research_findings_competitor_idx'
  `)) as Array<{ indexname: string }>;
  console.log('  index exists:', idx.length > 0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
