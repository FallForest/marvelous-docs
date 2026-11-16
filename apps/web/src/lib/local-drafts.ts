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

export function clearSavedDraft(storage: DraftStorage, id: string, userId: string, savedBody: unknown): void {
  const current = readDraft(storage, id, userId)
  if (!current || !sameDraftBody(current.body, savedBody)) return
  try { storage.removeItem(draftKey(id)) } catch { /* private mode */ }
}
