-- Sprint 7.13 (BUG 2) — Brand fit score on drafts.
--
-- Mirrors scheduledPosts.{consistencyScore, scoreBreakdown} on
-- generatedPosts so the /api/ai/generate-structured pipeline can
-- persist the score immediately after each Opus call.
-- Idempotent (IF NOT EXISTS).

BEGIN;

ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS consistency_score integer;
ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

COMMIT;
