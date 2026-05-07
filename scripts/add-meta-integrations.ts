// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// Two structural changes:
//   1. New table meta_integrations (one row per project that's been
//      OAuth-connected to Meta).
//   2. ALTER scheduled_posts to add publish lifecycle columns +
//      Meta-specific identifiers (post id, permalink, container id).
//
// IMPORTANT: There's no unified `posts` table in this schema — drafts
// live in generated_posts and scheduled posts in scheduled_posts. Only
// scheduled_posts gets the publish fields because drafts never publish.
//
// Idempotent: every ALTER + CREATE uses IF NOT EXISTS, safe to re-run.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• meta_integrations …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS meta_integrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      facebook_page_id text,
      facebook_page_name text,
      facebook_page_access_token text,
      instagram_business_id text,
      instagram_business_username text,
      meta_user_id text,
      meta_user_name text,
      token_expires_at timestamp,
      token_refreshed_at timestamp,
      status text NOT NULL DEFAULT 'pending',
      last_error text,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW(),
      CONSTRAINT meta_integrations_project_unique UNIQUE (project_id)
    )
  `);

  console.log('• meta_integrations indexes …');
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_meta_int_user
      ON meta_integrations(user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_meta_int_status
      ON meta_integrations(status)
  `);

  console.log('• scheduled_posts publish columns …');
  const publishColumns: Array<[string, string]> = [
    ['publish_status', 'text'],
    ['published_at', 'timestamp'],
    ['publish_failure_reason', 'text'],
    ['publish_retry_count', 'integer NOT NULL DEFAULT 0'],
    ['publish_next_retry_at', 'timestamp'],
    ['meta_post_id', 'text'],
    ['meta_permalink', 'text'],
    ['meta_target_type', 'text'],
    ['meta_container_id', 'text'],
  ];
  for (const [col, type] of publishColumns) {
    await db.execute(
      sql.raw(
        `ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS ${col} ${type}`
      )
    );
    console.log(`    ${col}`);
  }

  console.log(
    '\n• index for cron worker (scheduledFor + publishStatus) …'
  );
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sp_cron_due
      ON scheduled_posts(scheduled_for, publish_status, status)
  `);

  console.log('\nVerifying meta_integrations:');
  const intCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'meta_integrations'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of intCols) console.log('  ', c.column_name);

  console.log('\nVerifying scheduled_posts publish columns:');
  const spCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scheduled_posts'
      AND column_name IN (
        'publish_status', 'published_at', 'publish_failure_reason',
        'publish_retry_count', 'publish_next_retry_at',
        'meta_post_id', 'meta_permalink', 'meta_target_type',
        'meta_container_id'
      )
    ORDER BY column_name
  `)) as Array<{ column_name: string }>;
  for (const c of spCols) console.log('  ', c.column_name);

  console.log('\n✓ Meta integrations schema ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
