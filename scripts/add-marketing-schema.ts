import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  // Idempotent: only add columns/tables if they don't already exist.
  // Drizzle-kit push has a parser bug we hit before, so we apply ALTERs
  // directly. The schema in lib/db/schema.ts is the source of truth — this
  // script just makes the live DB match.

  console.log('• projects.brand_url …');
  await db.execute(sql`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand_url text
  `);

  console.log('• projects.brand_context …');
  await db.execute(sql`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand_context jsonb
  `);

  console.log('• scheduled_posts table …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      project_id uuid NOT NULL,
      user_id uuid NOT NULL,
      platform text NOT NULL,
      content text NOT NULL,
      template_used text,
      scheduled_for timestamp NOT NULL,
      status text DEFAULT 'scheduled' NOT NULL,
      notified_at timestamp,
      posted_at timestamp,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `);

  console.log('• scheduled_posts FKs …');
  // Add FKs separately so re-runs don't error.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'scheduled_posts_project_id_projects_id_fk'
      ) THEN
        ALTER TABLE scheduled_posts
        ADD CONSTRAINT scheduled_posts_project_id_projects_id_fk
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'scheduled_posts_user_id_users_id_fk'
      ) THEN
        ALTER TABLE scheduled_posts
        ADD CONSTRAINT scheduled_posts_user_id_users_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$
  `);

  console.log('\nVerifying:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name IN ('brand_url', 'brand_context')
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  console.log('  projects new columns:', cols.map((c) => c.column_name));

  const tables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'scheduled_posts'
  `)) as Array<{ table_name: string }>;
  console.log('  scheduled_posts exists:', tables.length > 0);

  const fks = (await db.execute(sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'scheduled_posts'::regclass AND contype = 'f'
  `)) as Array<{ conname: string }>;
  console.log('  scheduled_posts FKs:', fks.map((f) => f.conname));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
