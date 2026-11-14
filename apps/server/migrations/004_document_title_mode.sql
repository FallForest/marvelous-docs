-- Existing titles, including user-chosen placeholder names, must be preserved.
-- Only the create API opts new untitled documents into automatic naming.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS title_mode text NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='documents_title_mode_check' AND conrelid='documents'::regclass
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_title_mode_check
      CHECK (title_mode IN ('auto', 'manual'));
  END IF;
END $$;
