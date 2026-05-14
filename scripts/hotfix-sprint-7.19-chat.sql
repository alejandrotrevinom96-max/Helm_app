-- Sprint 7.19 — Helm Chat System schema.
--
-- Drops the Sprint 7.15 chat_messages table (incompatible shape
-- — no conversation_id, no agent role) and recreates the
-- conversation-based system. Loses Sprint 7.15 chat history;
-- acceptable for an MVP-stage feature with no production usage
-- to preserve. If real chats existed, this script would need a
-- backfill phase first.
--
-- Idempotent in shape: re-running drops then recreates.

BEGIN;

-- 1. Tear down the Sprint 7.15 table.
DROP TABLE IF EXISTS chat_messages;

-- 2. Conversations (parent).
CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'agent')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Index: admin inbox query "list active conversations" sorts by
-- recent activity. Also covers the per-user "give me my active
-- conversation" lookup.
CREATE INDEX IF NOT EXISTS chat_conversations_user_status_idx
  ON chat_conversations (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_status_updated_idx
  ON chat_conversations (status, updated_at DESC);

-- 3. Messages (child).
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'agent')),
  content text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_created_idx
  ON chat_messages (conversation_id, created_at ASC);

COMMIT;

-- ============================================================
-- Enable Supabase Realtime on both tables. This MUST run after
-- the COMMIT above; ALTER PUBLICATION is not transactional with
-- DDL on supabase_realtime in older Postgres versions Supabase
-- ships. Wrap in DO blocks so re-running is safe (ALTER ... ADD
-- TABLE errors if the table is already in the publication).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END$$;
