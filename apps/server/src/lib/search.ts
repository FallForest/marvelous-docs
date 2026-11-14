/**
 * Full-text search: turning user input into a `tsquery`, and the SQL that runs
 * it.
 *
 * The index is `simple`-configured — no stemming, no stop words — because the
 * workspace is bilingual and a language-specific dictionary would silently drop
 * German or Chinese content. CJK text has no spaces, so `marvelous_cjk_tokens`
 * (see migrations/003) inserts one before and after every ideograph. A search
 * therefore has to rebuild the same shape: a run of ideographs becomes a phrase
 * (`'写' <-> '作'`) so "写作" does not match "作文".
 *
 * Latin words keep prefix matching (`'quarterly':*`), which is what a user
 * expects from "quar" and what the previous ILIKE scan did for free.
 */


export type SearchScope = 'all' | 'title' | 'content'

/** Ideographs, kana, and hangul: one lexeme each after tokenisation. */
const IDEOGRAPH = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const WORD_CHAR = /[a-z0-9_]/

/**
 * Builds the `tsquery` text for a user query, or null when nothing searchable
 * is left (punctuation only).
 *
 * Terms are ANDed; a run of ideographs inside one whitespace-separated segment
 * stays a phrase. Punctuation and whitespace break both.
 */
export function buildTsQuery(input: string): string | null {
  const text = (input || '').trim().toLowerCase()
  if (!text) return null

  const clauses: string[] = []
  let phrase: string[] = []
  let word = ''

  /**
   * Quoting every lexeme is not cosmetic: `to_tsquery` parses its input, so a
   * term that happens to be an operator (`&`, `|`, `!`, `:`, `<->`) or contains
   * a quote would either change the query's shape or fail to parse. Quoted, the
   * whole term is taken literally.
   */
  const lexeme = (value: string) => "'" + value.replace(/'/g, "''") + "'"

  const flushPhrase = () => {
    if (!phrase.length) return
    // A single ideograph is just a lexeme; two or more must stay adjacent.
    clauses.push(phrase.length === 1 ? lexeme(phrase[0]!) : phrase.map(lexeme).join(' <-> '))
    phrase = []
  }
  const flushWord = () => {
    if (!word) return
    clauses.push(lexeme(word) + ':*')
    word = ''
  }

  for (const char of text) {
    if (IDEOGRAPH.test(char)) { flushWord(); phrase.push(char); continue }
    if (WORD_CHAR.test(char)) { flushPhrase(); word += char; continue }
    flushPhrase()
    flushWord()
  }
  flushPhrase()
  flushWord()

  return clauses.length ? clauses.join(' & ') : null
}

/**
 * The search statement, parameterised on how visibility is decided.
 *
 * `lib/` may not import `domain/` (structure.test.ts enforces the direction), so
 * the caller hands in the recursive fragment and this file only composes it into
 * the statement it belongs to. Keeping the two together matters: the query this
 * replaced tested `d.acl_restricted` on the row itself, so a document filed under
 * a restricted folder stayed searchable - and `body_text` was selected before the
 * row was ever checked, which shipped the text itself.
 *
 * Ordering is "title matched first, then relevance, then recency": a document
 * named after the query is what the user meant, and relevance alone ranks a
 * one-word title below a long document that repeats the term. `body_text` is
 * selected so the snippet can be built without shipping every hit's Tiptap
 * JSON to Node.
 *
 * @param visibleCte a `WITH RECURSIVE` body defining `visible_documents`
 */
export function searchSql(visibleCte: string) {
  return `WITH RECURSIVE ${visibleCte}
  SELECT d.id, d.title, d.title_mode AS "titleMode", d.kind, d.parent_id AS "parentId", d.created_at AS "createdAt", d.updated_at AS "updatedAt", d.version,
         CASE WHEN d.search_title @@ to_tsquery('simple', $3) THEN 1 ELSE 0 END AS title_match,
         ts_rank(d.search_vector, to_tsquery('simple', $3))
           + 2 * ts_rank(d.search_title, to_tsquery('simple', $3)) AS rank,
         marvelous_doc_text(d.content) AS body_text
    FROM documents d
   WHERE d.id IN (SELECT id FROM visible_documents)
     AND (($4 = 'title' AND d.search_title @@ to_tsquery('simple', $3))
       OR ($4 = 'content' AND d.search_vector @@ to_tsquery('simple', $3))
       OR ($4 = 'all' AND (d.search_title @@ to_tsquery('simple', $3)
                        OR d.search_vector @@ to_tsquery('simple', $3))))
   ORDER BY title_match DESC, rank DESC, d.updated_at DESC
   LIMIT $5`
}

/** One row of {@link SEARCH_SQL}, before it is trimmed for the client. */
export type SearchRow = {
  id: string; title: string; titleMode: 'auto' | 'manual'; kind: string; parentId: string | null; createdAt: Date; updatedAt: Date;
  version: number; title_match: number; rank: number; body_text: string | null;
}
