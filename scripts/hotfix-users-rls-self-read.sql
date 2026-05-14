-- PR Sprint 7.19 — RLS self-read policy on public.users.
--
-- The middleware redirect to /onboarding (for users with
-- has_completed_onboarding = false) needs to query the users
-- table from the Edge runtime via the Supabase REST client.
-- That client runs as the authenticated role + the user's JWT
-- — meaning RLS gates every read.
--
-- Pre-fix state on the users table:
--   - rowsecurity ENABLED
--   - zero policies defined
-- → Every middleware SELECT returns zero rows, so the
--   has_completed_onboarding check silently no-ops and the
--   redirect never fires. The DB stayed lockdown-safe only
--   because every other code path goes through Drizzle (which
--   uses the service-role DATABASE_URL connection that bypasses
--   RLS).
--
-- This policy lets a user read their own row only — same
-- principle as Supabase's auth.users default. No write
-- exposure; we deliberately scope to SELECT.
--
-- Idempotent: CREATE POLICY IF NOT EXISTS isn't standard
-- Postgres, so we guard with a pg_policies probe + DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users can read own row'
  ) THEN
    CREATE POLICY "Users can read own row"
      ON public.users
      FOR SELECT
      TO authenticated
      USING (auth.uid() = id);
  END IF;
END $$;
