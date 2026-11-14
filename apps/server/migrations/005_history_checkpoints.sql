-- Preserve existing snapshots; new checkpoints are independent of auto-save.
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'legacy';
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS fingerprint text;
CREATE INDEX IF NOT EXISTS document_versions_timeline ON document_versions(document_id, created_at DESC, id DESC);

-- Durable deadlines survive room eviction and process restarts.
CREATE TABLE IF NOT EXISTS document_history_pending (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_edit_at timestamptz NOT NULL DEFAULT now()
);
