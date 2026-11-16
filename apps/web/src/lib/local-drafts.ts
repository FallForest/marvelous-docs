/** Local safety copies are removed only when the exact body has been saved. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type LocalDraft = { body: Record<string, unknown>; savedAt?: string }

export const draftKey = (id: string) => 'mdocs-draft-' + id

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}

export function sameDraftBody(a: unknown, b: unknown, schema?: { nodeFromJSON: (value: unknown) => { toJSON: () => unknown } }): boolean {
  try {
    // Yjs omits unset attributes while editor JSON contains schema defaults.
    // Compare their parsed document meaning, not that serialization difference.
    return canonical(schema ? schema.nodeFromJSON(a).toJSON() : a) === canonical(schema ? schema.nodeFromJSON(b).toJSON() : b)
  } catch { return false }
}

/** Every text node of a Tiptap body, in document order. */
export function draftText(value: unknown): string {
  const collect = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const typed = node as { type?: unknown; text?: unknown; content?: unknown }
    if (typed.type === 'hardBreak') return '\n'
    if (typeof typed.text === 'string') return typed.text
    return Array.isArray(typed.content) ? typed.content.map(collect).join('') : ''
  }
  return collect(value)
}

/**
 * Nodes that make a body worth keeping without carrying a single character.
 *
 * A body can be blank of text and still be a real edit: a pasted screenshot, a
 * dividing rule, a table of empty cells you just built. Only a body with none of
 * those and no text is a copy with nothing in it.
 */
const STANDALONE_NODES = new Set(['image', 'horizontalRule', 'table'])

/**
 * True for a safety copy that holds nothing.
 *
 * These exist in the wild for one reason: the editor mounts before the room has
 * handed it the body, and whatever transaction fires in that window is written
 * as "unsaved work". Offering such a copy for recovery replaced a real page with
 * a blank one, or added a second blank page beside it, which is worse than
 * forgetting it: there is nothing in it to lose.
 */
export function isBlankDraft(value: unknown): boolean {
  if (draftText(value).trim()) return false
  let found = false
  const visit = (node: unknown) => {
    if (found || !node || typeof node !== 'object') return
    const typed = node as { type?: unknown; content?: unknown }
    if (typeof typed.type === 'string' && STANDALONE_NODES.has(typed.type)) { found = true; return }
    if (Array.isArray(typed.content)) typed.content.forEach(visit)
  }
  visit(value)
  return !found
}

/**
 * How a body's words compare, ignoring what serialization adds around them.
 *
 * Every space is dropped, including paragraph breaks: two round trips of one page
 * disagree about trailing whitespace and about the empty paragraph the editor
 * keeps at the end, and neither disagreement is something a writer typed. What
 * survives is the text itself, which is exactly the question "are these the same
 * words?".
 */
const squeeze = (value: unknown) => draftText(value).replace(/\s+/gu, '')

/**
 * True when two bodies hold the same words.
 *
 * "Has this copy already been saved?" is not a serialization question. Two
 * representations of one page differ for reasons that have nothing to do with
 * the writing - attribute defaults the schema fills in, key order after a round
 * trip through PostgreSQL's jsonb, the room's own projection - and comparing
 * them byte for byte kept answering "different" for words the cloud had already
 * accepted. The consequence was that the safety copy was never cleared, so every
 * later visit offered to restore text that was already on the page.
 */
export function sameDraftText(a: unknown, b: unknown): boolean {
  const left = squeeze(a)
  return Boolean(left) && left === squeeze(b)
}

/**
 * The shape of a body, as the sequence of node types and marks it contains.
 *
 * Compared instead of the serialized tree because defaults and key order are not
 * content, and compared at all because text alone cannot tell "this page" from
 * "this page with half of it bold": a copy whose only difference is formatting is
 * still a copy worth keeping.
 */
export function draftShape(value: unknown): string {
  /*
   * The editor always keeps one empty paragraph at the end of the document, and
   * a stored body may or may not have it - that trailing node is why an
   * otherwise identical page looked different. Only the tail is dropped: an
   * empty paragraph between two paragraphs is a blank line the writer made.
   */
  const children = (nodes: unknown): string => {
    const parts = nodesArray(nodes).map(walk)
    while (parts.length && parts[parts.length - 1] === '(paragraph)') parts.pop()
    return parts.join('')
  }
  const nodesArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const typed = node as { type?: unknown; text?: unknown; marks?: unknown; content?: unknown }
    if (typeof typed.text === 'string') {
      const marks = Array.isArray(typed.marks)
        ? typed.marks.map((mark) => String((mark as { type?: unknown })?.type)).sort().join('+')
        : ''
      return '[' + marks + ']'
    }
    return '(' + String(typed.type) + children(typed.content) + ')'
  }
  return children([value])
}

/**
 * The comparison used to decide whether a safety copy is still needed.
 *
 * Same words and same shape means the cloud already holds this edit, however
 * differently the two bodies are serialized. Both halves matter: text alone
 * would delete a copy whose only change was bolding a sentence, and shape alone
 * would call two unrelated paragraphs of equal length identical.
 */
export function sameDraftContent(a: unknown, b: unknown, schema?: { nodeFromJSON: (value: unknown) => { toJSON: () => unknown } }): boolean {
  return (sameDraftText(a, b) && draftShape(a) === draftShape(b)) || sameDraftBody(a, b, schema)
}

export function readDraft(storage: DraftStorage, id: string, userId: string): LocalDraft | null {
  try {
    const raw = storage.getItem(draftKey(id))
    if (!raw) return null
    const value = JSON.parse(raw)
    // Older releases stored a bare Tiptap document. It can still be recovered.
    if (value?.type === 'doc' && Array.isArray(value.content)) return { body: value }
    if (value?.format !== 1 || value.userId !== userId || value.documentId !== id) return null
    if (value.body?.type !== 'doc' || !Array.isArray(value.body.content)) return null
    return { body: value.body, savedAt: typeof value.savedAt === 'string' ? value.savedAt : undefined }
  } catch { return null }
}

export function writeDraft(storage: DraftStorage, id: string, userId: string, body: Record<string, unknown>): boolean {
  try {
    storage.setItem(draftKey(id), JSON.stringify({ format: 1, documentId: id, userId, body, savedAt: new Date().toISOString() }))
    return true
  } catch { return false }
}

/**
 * Removes the copy regardless of what it holds.
 *
 * Used when the copy has been proven obsolete - it is blank, or the cloud copy
 * already contains its words - and when a recovery succeeded. Unlike
 * `clearSavedDraft` it does not compare bodies first, because the caller has
 * already decided: the body it is replacing is the one that must go.
 */
export function discardDraft(storage: DraftStorage, id: string): void {
  try { storage.removeItem(draftKey(id)) } catch { /* private mode */ }
}

/**
 * Removes the copy once `savedBody` proves it is no longer needed.
 *
 * The comparison is `sameDraftContent`, not byte equality: see its comment for
 * why an exact match almost never fired and left every saved copy on disk to be
 * offered back on the next visit. A body whose words are already stored has been
 * saved; a later edit changes the text, so an old acknowledgement still cannot
 * erase newer work.
 */
export function clearSavedDraft(storage: DraftStorage, id: string, userId: string, savedBody: unknown): void {
  const current = readDraft(storage, id, userId)
  if (!current || !sameDraftContent(current.body, savedBody)) return
  try { storage.removeItem(draftKey(id)) } catch { /* private mode */ }
}
