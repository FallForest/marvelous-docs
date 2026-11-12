-- Full-text search.
--
-- The previous search was `content::text ILIKE '%q%'`: it shipped every
-- document's whole Tiptap JSON to the API process to build a snippet, could not
-- use an index, and ranked nothing. This migration adds a generated index that
-- PostgreSQL maintains on every write, so search becomes one indexed query.
--
-- Three pieces:
--   1. marvelous_doc_text(jsonb)  - the prose out of a Tiptap document.
--   2. marvelous_cjk_tokens(text) - one lexeme per ideograph, so the `simple`
--      dictionary can index Chinese, Japanese and Korean at all.
--   3. two stored generated columns plus GIN indexes.
--
-- Everything is `IF NOT EXISTS` / `OR REPLACE` because the runner replays the
-- whole directory on every boot.

-- Prose out of a Tiptap document (`{ schemaVersion, doc }` or a bare `doc`).
--
-- `strict` is load-bearing: the non-strict `$.**.text` also applies the `.text`
-- selector to every object *inside* a text node's ancestry and returns each
-- string once per matching level, so one paragraph produced three copies of its
-- own words and ts_rank scored a long paragraph as three times as relevant as a
-- short one with the same term.
--
-- `value #>> '{}'` unwraps the JSON string; a JSON `null` attribute (for
-- example an image's `text`) is ignored by string_agg, which is what we want.
CREATE OR REPLACE FUNCTION marvelous_doc_text(content jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT coalesce(string_agg(value #>> '{}', ' '), '')
  FROM jsonb_path_query(content, 'strict $.**.text') AS value
$fn$;

-- CJK has no word boundaries, and `simple` does not segment. Surrounding every
-- ideograph with a space turns "写作方法" into the lexemes 写 文 ... 法, and the
-- query builder then asks for them as an adjacent phrase, so "写作" and "作文"
-- stay different terms. Kana and hangul are included for the same reason.
CREATE OR REPLACE FUNCTION marvelous_cjk_tokens(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT btrim(regexp_replace(regexp_replace(coalesce(value, ''),
    '([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af])', ' \1 ', 'g'),
    '\s+', ' ', 'g'))
$fn$;

-- `to_tsvector(regconfig, text)` is immutable, which is what lets these be
-- generated columns. `simple` rather than a language dictionary: one workspace
-- holds notes in several languages, and a stemming dictionary silently drops
-- every word it does not know.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_title tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', marvelous_cjk_tokens(title))) STORED;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', marvelous_cjk_tokens(marvelous_doc_text(content)))) STORED;

-- GIN over the lexemes; the tree listing and trash already have their indexes.
CREATE INDEX IF NOT EXISTS documents_search_title ON documents USING gin(search_title);
CREATE INDEX IF NOT EXISTS documents_search_vector ON documents USING gin(search_vector);
