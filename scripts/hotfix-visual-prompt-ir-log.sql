-- PR Sprint 7.19 — optional visuals audit log.
--
-- Additive table for tracking VisualPromptIR generations. Use
-- to audit subject-extractor output quality, debug failed
-- generations, and seed the v1.5 SubjectBlock cache layer (the
-- cache_key column is the lookup key once that cache lands).
--
-- Apply via: scripts/hotfix-visual-prompt-ir-log-apply.mjs
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS means re-running is safe.

CREATE TABLE IF NOT EXISTS visual_prompt_ir_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Soft refs (no FK) so the log survives project/post deletes.
  -- The audit value is in the IR snapshot itself; we don't want
  -- ON DELETE CASCADE to wipe the history.
  user_id         UUID,
  project_id      UUID,
  post_id         UUID,
  -- Full IR JSON snapshot (5 blocks + metadata). JSONB so we can
  -- query into it later (e.g. SELECT
  -- ir_json->'subject'->>'visual_strategy' to count strategies).
  ir_json         JSONB NOT NULL,
  -- The final rendered Flux prompt string. Kept verbatim so we
  -- can diff rendering changes vs old prompts.
  flux_prompt     TEXT  NOT NULL,
  -- Resulting image URL (Supabase Storage or fal.ai CDN).
  image_url       TEXT,
  -- Mirror of ir_json->'metadata'->>'cache_key' for fast lookup.
  cache_key       TEXT,
  -- Track extractor model + latency at the row level so we can
  -- chart latency over time without parsing JSONB.
  subject_extractor_model      TEXT,
  subject_extractor_latency_ms INTEGER,
  -- Whether the IR passed soft validation. Null = not validated.
  validation_failures JSONB,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookups by cache_key (v1.5 cache layer) and by user/project
-- for audit views in the admin overview.
CREATE INDEX IF NOT EXISTS visual_prompt_ir_log_cache_key_idx
  ON visual_prompt_ir_log (cache_key);
CREATE INDEX IF NOT EXISTS visual_prompt_ir_log_user_id_idx
  ON visual_prompt_ir_log (user_id);
CREATE INDEX IF NOT EXISTS visual_prompt_ir_log_project_id_idx
  ON visual_prompt_ir_log (project_id);
CREATE INDEX IF NOT EXISTS visual_prompt_ir_log_generated_at_idx
  ON visual_prompt_ir_log (generated_at DESC);
