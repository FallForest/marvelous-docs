import { getMarkRange } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export type LinkPrompt = { from: number; to: number; href?: string; requestId: string; documentId: string }
export type LinkEditSession = { prompt: LinkPrompt; from: number; to: number; valid: boolean }

export function safeHttpHref(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

/** A caret inside an existing link edits that entire mark. */
export function startLinkEdit(state: EditorState, documentId: string, requestId: string): LinkEditSession {
  let { from, to } = state.selection
  const mark = state.schema.marks.link
  const range = mark && getMarkRange(state.selection.$from, mark)
  if (from === to && range) { from = range.from; to = range.to }
  const href = range && range.from <= from && range.to >= to
    ? state.doc.resolve(from).nodeAfter?.marks.find((item) => item.type === mark)?.attrs.href as string | undefined
    : undefined
  return { prompt: { from, to, href, documentId, requestId }, from, to, valid: true }
}

/** Never re-use a snapshot offset after another collaborator edits the page. */
export function mapLinkEdit(session: LinkEditSession, tr: Transaction): LinkEditSession {
  if (!session.valid || !tr.docChanged) return session
  const start = tr.mapping.mapResult(session.from, 1)
  const end = tr.mapping.mapResult(session.to, session.from === session.to ? 1 : -1)
  const valid = !start.deletedAcross && !end.deletedAcross && (session.from === session.to || end.pos > start.pos)
  return { ...session, from: start.pos, to: end.pos, valid }
}

/** null removes the link while preserving its text; a caret inserts a URL. */
export function linkEditTransaction(state: EditorState, session: LinkEditSession, href: string | null): Transaction | null {
  const { from, to, valid } = session
  if (!valid || from < 0 || to > state.doc.content.size || from > to) return null
  const mark = state.schema.marks.link
  if (!mark || (href !== null && !safeHttpHref(href))) return null
  const tr = state.tr
  if (href === null) {
    if (from === to) return null
    tr.removeMark(from, to, mark)
  } else if (from === to) {
    const text = href.trim()
    tr.insertText(text, from).addMark(from, from + text.length, mark.create({ href: text }))
    tr.setSelection(TextSelection.create(tr.doc, from + text.length))
  } else {
    tr.addMark(from, to, mark.create({ href: href.trim() }))
    tr.setSelection(TextSelection.create(tr.doc, from, to))
  }
  return tr.setStoredMarks(null).scrollIntoView()
}
