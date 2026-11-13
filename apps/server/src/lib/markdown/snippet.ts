/**
 * Plain text and search snippets.
 *
 * Search reads the indexed text out of PostgreSQL, but the same windowing has to
 * work on the stored Tiptap JSON for callers that never touched the index.
 * Keeping both entry points on one implementation stops the two paths from
 * producing different snippets for the same document.
 */

/** Plain text extracted from a Tiptap document, block aware. */
export function documentPlainText(docJson: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: unknown; text?: unknown; content?: unknown; doc?: unknown };
    if (typeof node.text === 'string') parts.push(node.text);
    if (node.doc && typeof node.doc === 'object') walk(node.doc);
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') parts.push(' ');
    }
  };
  walk(docJson);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Builds a compact snippet centred on the first case-insensitive match of
 * `query`. Falls back to the start of the document when the term only matched
 * the title.
 */
export function searchSnippet(docJson: unknown, query: string, maxLength = 180): string {
  return snippetFromText(documentPlainText(docJson), query, maxLength);
}

/**
 * The same window over prose that is already flat.
 *
 * Full-text search reads the indexed text out of PostgreSQL (`marvelous_doc_text`)
 * instead of decoding each hit's Tiptap JSON, so the windowing has to work on a
 * string. Keeping both entry points on one implementation is what stops the two
 * paths from producing different snippets for the same document.
 */
export function snippetFromText(text: string | null | undefined, query: string, maxLength = 180): string {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const needle = query.trim().toLocaleLowerCase();
  const haystack = flat.toLocaleLowerCase();
  const index = needle ? haystack.indexOf(needle) : -1;
  if (index < 0) return flat.length > maxLength ? flat.slice(0, maxLength).trimEnd() + '…' : flat;
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(flat.length, start + maxLength);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}
