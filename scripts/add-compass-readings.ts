import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• compass_readings table …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS compass_readings (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total_score integer NOT NULL,
      band text NOT NULL,
      dimensions jsonb NOT NULL,
      red_flags jsonb,
      bull_case jsonb,
      bear_case jsonb,
      due_diligence_question text,
      recommendations jsonb,
      form_data jsonb,
      computed_by text NOT NULL DEFAULT 'manual',
      data_quality integer NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `);

  console.log('• compass_readings_project_idx …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS compass_readings_project_idx
    ON compass_readings(project_id, created_at DESC)
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'compass_readings'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
