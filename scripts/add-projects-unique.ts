import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  // Idempotent: drizzle's auto-generated name for unique().on(userId, githubRepoId)
  // on the `projects` table is projects_user_id_github_repo_id_unique. Use that
  // exact name so a future drizzle-kit push sees it and does not try to add it
  // a second time.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'projects_user_id_github_repo_id_unique'
      ) THEN
        ALTER TABLE projects
        ADD CONSTRAINT projects_user_id_github_repo_id_unique
        UNIQUE (user_id, github_repo_id);
      END IF;
    END $$;
  `);

  const rows = (await db.execute(sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'projects'::regclass AND contype = 'u'
  `)) as Array<{ conname: string }>;
  console.log('unique constraints on projects:', rows.map((r) => r.conname));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
