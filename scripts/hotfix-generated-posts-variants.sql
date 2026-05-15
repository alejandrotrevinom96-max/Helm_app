-- PR Sprint 7.24 — Prompt 3. Per-content-type variants on
-- generated_posts so the structured generator can persist 2
-- drafts per (platform, contentType) and the Library / Calendar
-- can render them as a 2-up comparison.
--
-- variantLabel:    'A' | 'B' | null (null on pre-7.24 rows)
-- variantGroupId:  uuid shared across the pair, null on legacy
--                  rows
--
-- Safe to re-run — IF NOT EXISTS guards both ADDs.

ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS variant_label TEXT;

ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS variant_group_id UUID;

-- Index on variantGroupId so the Library can pull "all variants
-- of this pair" in O(1). Partial index — only the rows that
-- actually carry a group id (i.e., post-7.24 drafts).
CREATE INDEX IF NOT EXISTS generated_posts_variant_group_idx
  ON generated_posts (variant_group_id)
  WHERE variant_group_id IS NOT NULL;
