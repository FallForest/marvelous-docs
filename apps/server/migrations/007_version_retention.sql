-- Two indexes and one retention policy that the roadmap's P0-7 asked for.
--
-- 1. `documents(parent_id)` has a foreign key but no index. Every access check,
--    every delete and every move recurses on it, and so does the trash sweep, so
--    the table was scanned once per level of the tree.
--
-- 2. Nothing ever deleted from `document_versions`. It stores a full copy of the
--    content per row, written on the idle (2 min) and interval (10 min) clocks,
--    so an eight-hour session leaves roughly 48 copies of the same document and
--    the table grows for as long as the workspace is used. `GET /workspace/stats`
--    counted it on every request.
--
-- The policy keeps a cheap outline of the whole history and full snapshots only
-- where they are worth their size:
--
--   - anything from the last `keep_recent_days` (7) is kept untouched, so undo
--     and "what did it look like on Friday" work without a query penalty;
--   - older days keep at most `keep_per_day` (4) snapshots, spaced through the
--     day, so a long-lived document still has a shape;
--   - the newest `keep_ceiling` (50) per document are always kept, so a
--     frequently edited document is never left with an empty history.
--
-- Deliberately not a trigger: a trigger would run inside the collaboration save
-- path, which is the hottest write in the system. The sweep runs on the timer in
-- src/index.ts next to the trash sweep, and is idempotent by construction.

CREATE INDEX IF NOT EXISTS documents_parent ON documents(parent_id);

CREATE TABLE IF NOT EXISTS document_version_retention (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  keep_recent_days integer NOT NULL DEFAULT 7,
  keep_per_day integer NOT NULL DEFAULT 4,
  keep_ceiling integer NOT NULL DEFAULT 50,
  last_run_at timestamptz
);
INSERT INTO document_version_retention(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

/*
 * `row_number()` partitions the history twice: once by document and age, once by
 * document and calendar day. A row survives if it is recent, or among the first
 * few of the day it belongs to, or inside the per-document ceiling.
 *
 * The day bucket is built in UTC on purpose. The server has no idea which
 * timezone a workspace reads in, and a bucket boundary is an internal detail of
 * pruning rather than something a user is told about.
 */
CREATE OR REPLACE FUNCTION marvelous_prune_document_versions() RETURNS integer AS $$
DECLARE
  removed integer;
  policy document_version_retention;
BEGIN
  SELECT * INTO policy FROM document_version_retention WHERE id;
  IF policy IS NULL THEN RETURN 0; END IF;

  WITH ranked AS (
    SELECT v.id,
           row_number() OVER (PARTITION BY v.document_id ORDER BY v.created_at DESC) AS age_rank,
           row_number() OVER (
             PARTITION BY v.document_id, date_trunc('day', v.created_at)
             ORDER BY v.created_at DESC
           ) AS day_rank,
           v.created_at
    FROM document_versions v
  ), doomed AS (
    DELETE FROM document_versions d
     USING ranked r
     WHERE d.id = r.id
       AND r.age_rank > policy.keep_ceiling
       AND r.created_at < now() - (policy.keep_recent_days * interval '1 day')
       AND r.day_rank > policy.keep_per_day
    RETURNING d.id
  )
  SELECT count(*) INTO removed FROM doomed;

  UPDATE document_version_retention SET last_run_at = now() WHERE id;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marvelous_prune_document_versions() IS
  'Applies document_version_retention to document_versions. Safe to call repeatedly; returns the row count removed.';
