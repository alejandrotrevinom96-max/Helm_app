// PR #60 — Sprint 7.0.4: content_types + user_content_preferences
// tables, plus contentType/structuredContent columns on
// generated_posts.
//
// Run with: `npx tsx scripts/migrate-content-types.ts`
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('[migrate] Creating content_types…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS content_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      prompt_template TEXT NOT NULL,
      structure_schema JSONB NOT NULL,
      guidelines TEXT,
      max_length INTEGER,
      default_enabled BOOLEAN DEFAULT TRUE NOT NULL,
      display_order INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT content_types_platform_type_uk UNIQUE (platform, type)
    )
  `);
  console.log('[migrate]  ✓ content_types');

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS content_types_platform_idx
      ON content_types (platform, display_order)
  `);
  console.log('[migrate]  ✓ content_types_platform_idx');

  console.log('[migrate] Creating user_content_preferences…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_content_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      platform TEXT NOT NULL,
      enabled_types JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT user_content_preferences_project_platform_uk UNIQUE (project_id, platform)
    )
  `);
  console.log('[migrate]  ✓ user_content_preferences');

  console.log(
    '[migrate] Adding contentType + structuredContent to generated_posts…',
  );
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS content_type TEXT
  `);
  console.log('[migrate]  ✓ generated_posts.content_type');
  await db.execute(sql`
    ALTER TABLE generated_posts
      ADD COLUMN IF NOT EXISTS structured_content JSONB
  `);
  console.log('[migrate]  ✓ generated_posts.structured_content');

  console.log('[migrate] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
