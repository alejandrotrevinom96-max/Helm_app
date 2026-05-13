-- PR #86 / #87 — Sprint 7.10 + 7.11 production hotfix.
--
-- Idempotent — safe to re-run. Drizzle schema.ts already declares
-- these; this file is the catch-up for the live Supabase prod
-- which never had `drizzle-kit push` applied after the schema
-- changes shipped on PR a31e4b8 and d17f8ec.
--
-- Triggering error in Vercel logs:
--   column "heygen_avatar_type" does not exist
--   (table "projects")
--
-- Cause: schema.ts added 4 columns to projects + 2 new tables
-- (tiktok_integrations, tiktok_publish_jobs) but the migration
-- was never pushed to prod.

BEGIN;

-- === Sprint 7.10 (PR #86): HeyGen avatar config on projects ===
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS heygen_avatar_type text DEFAULT 'stock';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS heygen_avatar_id text;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS heygen_photo_url text;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS heygen_voice_id text;

-- === Sprint 7.11 (PR #87): TikTok integrations ===
CREATE TABLE IF NOT EXISTS tiktok_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  open_id text NOT NULL,
  display_name text,
  avatar_url text,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_expires_at timestamp NOT NULL,
  refresh_token_expires_at timestamp NOT NULL,
  scope text,
  status text NOT NULL DEFAULT 'connected',
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- The unique-on-user_id constraint matches the schema.ts declaration:
--   unique('tiktok_integrations_user_uk').on(t.userId)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tiktok_integrations_user_uk'
  ) THEN
    ALTER TABLE tiktok_integrations
      ADD CONSTRAINT tiktok_integrations_user_uk UNIQUE (user_id);
  END IF;
END$$;

-- === Sprint 7.11 (PR #87): TikTok publish job ledger ===
CREATE TABLE IF NOT EXISTS tiktok_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scheduled_post_id uuid,
  heygen_job_id uuid,
  publish_id text NOT NULL,
  status text NOT NULL DEFAULT 'PROCESSING_UPLOAD',
  source_video_url text,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

COMMIT;
