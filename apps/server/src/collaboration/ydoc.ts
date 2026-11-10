import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yDocToProsemirrorJSON } from 'y-prosemirror'
import { schema } from '../lib/schema.js'

/** The Yjs fragment name shared by the client and the server projection. */
export const roomField = 'default'

/** Builds a Y.Doc from stored Tiptap JSON. Throws on schema mismatch. */
export function createYDoc(docJson: unknown): Y.Doc {
  const parsed = schema.nodeFromJSON(docJson)
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(parsed, ydoc.getXmlFragment(roomField))
  return ydoc
}

/** Projects a Y.Doc back into the stored `{ schemaVersion, doc }` shape. */
export function contentFromYDoc(ydoc: Y.Doc) {
  return { schemaVersion: 1, doc: yDocToProsemirrorJSON(ydoc, roomField) }
}

export function yState(doc: Y.Doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}
