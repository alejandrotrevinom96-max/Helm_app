// PR #27 — Sprint 4: Image validation loop.
//
// Creates brand_image_validations + indexes. Idempotent (IF NOT
// EXISTS), safe to re-run. Schema mirrors lib/db/schema.ts.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• brand_image_validations …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brand_image_validations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      batch_id uuid NOT NULL,
      context_type text NOT NULL,
      context_label text NOT NULL,
      context_dimensions text NOT NULL,
      prompt text NOT NULL,
      image_url text NOT NULL,
      generation_cost numeric(10, 4),
      vote text,
      voted_at timestamp,
      vote_reason text,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `);

  console.log('• indexes …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_image_val_project
      ON brand_image_validations(project_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_image_val_batch
      ON brand_image_validations(batch_id)
  `);

  console.log('\nVerifying brand_image_validations columns:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'brand_image_validations'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);

  console.log('\n✓ brand_image_validations ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
