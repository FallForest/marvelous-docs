-- Preserve legacy rows while giving meaningful events a bounded JSON summary.
ALTER TABLE document_activity ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS document_activity_key_events
  ON document_activity(document_id, created_at DESC, id DESC)
  WHERE action NOT IN ('view','edit');

-- Opening a page is distinct from reading its latest state in the background.
-- The unique row atomically deduplicates simultaneous visits without deleting
-- the old view entries used by the recent-documents list.
CREATE TABLE IF NOT EXISTS document_recent_visits (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,user_id)
);
INSERT INTO document_recent_visits(document_id,user_id,visited_at)
  SELECT document_id,user_id,max(created_at) FROM document_activity WHERE action='view'
  GROUP BY document_id,user_id
  ON CONFLICT(document_id,user_id) DO NOTHING;
