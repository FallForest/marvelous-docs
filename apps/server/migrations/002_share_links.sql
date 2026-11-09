CREATE TABLE IF NOT EXISTS document_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  permission text NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer','commenter')),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_links_document ON document_share_links(document_id);
CREATE INDEX IF NOT EXISTS share_links_token ON document_share_links(token);
