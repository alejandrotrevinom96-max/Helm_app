-- Sprint 7.15 — chat_messages table for the Helm AI widget.
-- Idempotent: CREATE TABLE IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Per-user lookup index. The chat widget itself reads from
-- component state, not DB; this index covers the eventual
-- analytics / support / "resume my last session" features that
-- WILL query by (user_id, created_at DESC).
CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx
  ON chat_messages (user_id, created_at DESC);

COMMIT;
