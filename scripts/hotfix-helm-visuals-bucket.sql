-- Sprint 7.13 (BUG 3B) — ensure the helm-visuals Storage bucket
-- exists, is publicly readable, and lets the service role write.
--
-- Idempotent. Safe to re-run.
--
-- Run via scripts/hotfix-helm-visuals-bucket.mjs OR paste into
-- the Supabase SQL Editor at /project/_/sql. The MJS runner uses
-- the same DATABASE_URL as the rest of the hotfix scripts.

-- 1. Bucket exists + is public for reads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('helm-visuals', 'helm-visuals', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Public read policy.
-- NOTE: storage.objects RLS policies don't accept CREATE POLICY IF
-- NOT EXISTS in older Postgres versions Supabase ships, so we use
-- the standard DO block / drop-and-recreate pattern instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read helm-visuals'
  ) THEN
    CREATE POLICY "Public read helm-visuals"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'helm-visuals');
  END IF;
END$$;

-- 3. Service role insert policy. The /api/visuals/generate
-- handler uses createServiceClient() (lib/visuals/storage.ts), so
-- the policy keys on the service_role JWT claim rather than
-- auth.uid().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Service role write helm-visuals'
  ) THEN
    CREATE POLICY "Service role write helm-visuals"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'helm-visuals');
  END IF;
END$$;

-- 4. Service role update policy (for the rare re-upload case).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Service role update helm-visuals'
  ) THEN
    CREATE POLICY "Service role update helm-visuals"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'helm-visuals');
  END IF;
END$$;
