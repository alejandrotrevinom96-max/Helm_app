-- PR Sprint 7.20 — analytics insights cache table.
--
-- The /api/analytics/insights endpoint pre-fix called Claude
-- Haiku on every page load (~9.5s wall-clock). This table backs
-- a 24h cache keyed on (userId, projectsHash) so repeat visits
-- to /analytics skip the AI call entirely.
--
-- projectsHash is sha256 hex of sortedProjectIds.join(',') —
-- adding/removing a project naturally invalidates the cache.
--
-- Apply via Supabase SQL editor or psql:
--   psql $DATABASE_URL -f scripts/hotfix-analytics-insights-cache.sql
--
-- Safe to re-run: IF NOT EXISTS guards all DDL.

CREATE TABLE IF NOT EXISTS analytics_insights_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  projects_hash text NOT NULL,
  insights      jsonb NOT NULL,
  generated_at  timestamp NOT NULL DEFAULT now(),
  expires_at    timestamp NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_insights_cache_uniq_idx
  ON analytics_insights_cache (user_id, projects_hash);

-- Helper index for the cleanup sweep (expired rows). Optional —
-- a future cron can periodically DELETE WHERE expires_at < now().
CREATE INDEX IF NOT EXISTS analytics_insights_cache_expires_idx
  ON analytics_insights_cache (expires_at);
