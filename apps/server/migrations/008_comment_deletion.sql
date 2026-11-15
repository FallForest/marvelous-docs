-- Remove the author's words without cascading through other people's replies.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
