-- Sprint 7.16 — Adaptive Voice Engine schema migration.
-- Idempotent (IF NOT EXISTS / IF NOT EXISTS on constraints).

BEGIN;

-- ============================================================
-- client_contexts: per-project learning state.
-- ============================================================
CREATE TABLE IF NOT EXISTS client_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brand_bible jsonb NOT NULL,
  platforms jsonb NOT NULL DEFAULT '{}'::jsonb,
  cross_platform_voice jsonb NOT NULL DEFAULT '[]'::jsonb,
  anti_samples jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_contexts_project_uk'
  ) THEN
    ALTER TABLE client_contexts
      ADD CONSTRAINT client_contexts_project_uk UNIQUE (project_id);
  END IF;
END$$;

-- ============================================================
-- voice_engine_audit_log: one row per state change.
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_engine_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_context_id uuid NOT NULL REFERENCES client_contexts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL,
  platform text,
  dimension text,
  previous_value jsonb,
  new_value jsonb,
  triggering_signals jsonb,
  operator_id text,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Indexes for operator queries (action/dimension/time-range).
CREATE INDEX IF NOT EXISTS voice_engine_audit_action_idx
  ON voice_engine_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_engine_audit_dim_idx
  ON voice_engine_audit_log (dimension, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_engine_audit_user_idx
  ON voice_engine_audit_log (user_id, created_at DESC);

COMMIT;
