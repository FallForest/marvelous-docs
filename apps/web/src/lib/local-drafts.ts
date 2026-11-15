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
