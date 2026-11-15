import { Extension } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Mapping, StepMap } from '@tiptap/pm/transform'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror'
import { createAbsolutePositionFromRelativePosition, createRelativePositionFromJSON, createRelativePositionFromTypeIndex, relativePositionToJSON } from 'yjs'
import type { Comment, CommentAnchor, CommentAnchorLocation } from '../types'

export type CommentMark = {
  ids: string[]
  from: number
  to: number
  label: string
  resolved: boolean
}
type MarkSpec = { ids: string[]; label: string; resolved: boolean; active: boolean }
export type CommentDraft = { from: number; to: number }
export type CommentMarksMeta = { comments: Comment[]; activeId: string | null; draft: CommentDraft | null }
type TrackedRange = CommentAnchorLocation & { from: number; to: number }
type CommentMarkState = {
  deco: DecorationSet
  comments: Comment[]
  activeId: string | null
  draft: CommentDraft | null
  ranges: Map<string, TrackedRange>
}
export const commentMarksKey = new PluginKey<CommentMarkState>('commentMarks')
type DocLike = {
  content: { size: number }
  textBetween: (from: number, to: number, blockSeparator?: string) => string
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const fold = (text: string) => text.replace(/\s+/g, '')

/** Render overlap as one span, but retain each thread's independent range. */
export function commentAnchorMarks(comments: Comment[], doc: DocLike): CommentMark[] {
  const ranges: CommentMark[] = []
  for (const comment of comments) {
    if (!comment.anchor || !Number.isFinite(comment.anchor.from) || !Number.isFinite(comment.anchor.to)) continue
    const range = clampDraft(comment.anchor as CommentDraft, doc)
    if (!range) continue
    const label = fold(comment.anchor.text || comment.body || '评论')
    ranges.push({ ids: [comment.id], ...range, label: label.length > 80 ? label.slice(0, 80) + '…' : label, resolved: comment.status === 'resolved' })
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to)
  const merged: CommentMark[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.from < last.to) {
      last.to = Math.max(last.to, range.to)
      last.ids.push(...range.ids)
      last.resolved &&= range.resolved
    } else merged.push({ ...range, ids: [...range.ids] })
  }
  return merged
}

/** Old anchors are snapshots. Never accept an arbitrary partial prefix. */
export function anchorStillMatches(comment: Comment, doc: DocLike, from: number, to: number) {
  const expected = fold(comment.anchor?.text || '')
  if (!expected) return true
  const actual = fold(doc.textBetween(from, to, ' '))
  return actual === expected || ((comment.anchor?.text?.length ?? 0) >= 500 && actual.startsWith(expected))
}
export function clampDraft(draft: CommentDraft, doc: DocLike): CommentDraft | null {
  if (!Number.isFinite(draft.from) || !Number.isFinite(draft.to)) return null
  const limit = Math.max(2, doc.content.size)
  const from = clamp(Math.min(draft.from, draft.to), 1, limit - 1)
  const to = clamp(Math.max(draft.from, draft.to), 1, limit - 1)
  return to > from ? { from, to } : null
}
export function mapDraft(draft: CommentDraft, tr: Pick<Transaction, 'doc' | 'mapping'>): CommentDraft | null {
  const start = tr.mapping.mapResult(draft.from, 1)
  const end = tr.mapping.mapResult(draft.to, -1)
  return !(start.deleted && end.deleted) && start.pos < end.pos ? clampDraft({ from: start.pos, to: end.pos }, tr.doc) : null
}

/** Store item identities with the quote, never as marks in the document body. */
export function captureCommentAnchor(state: EditorState, range: CommentDraft): CommentAnchor {
  const anchor: CommentAnchor = { from: range.from, to: range.to, text: state.doc.textBetween(range.from, range.to, ' ').slice(0, 500) }
  const sync = ySyncPluginKey.getState(state)
  if (sync?.binding?.mapping.size) {
    try {
      const end = absolutePositionToRelativePosition(range.to, sync.type, sync.binding.mapping)
      const absoluteEnd = createAbsolutePositionFromRelativePosition(end, sync.doc)
      anchor.relative = {
        from: relativePositionToJSON(absolutePositionToRelativePosition(range.from, sync.type, sync.binding.mapping)),
        to: relativePositionToJSON(absoluteEnd ? createRelativePositionFromTypeIndex(absoluteEnd.type, absoluteEnd.index, -1) : end),
      }
    } catch { /* A not-yet-synced editor still has the verified snapshot range. */ }
  }
  return anchor
}

function initialRange(comment: Comment, state: EditorState, doc: DocLike): TrackedRange {
  const anchor = comment.anchor!
  const sync = ySyncPluginKey.getState(state)
  if (anchor.relative && sync?.binding?.mapping.size) {
    try {
      const from = relativePositionToAbsolutePosition(sync.doc, sync.type, createRelativePositionFromJSON(anchor.relative.from), sync.binding.mapping)
      const to = relativePositionToAbsolutePosition(sync.doc, sync.type, createRelativePositionFromJSON(anchor.relative.to), sync.binding.mapping)
      if (from !== null && to !== null) {
        const range = from < to ? clampDraft({ from, to }, doc) : null
        return range ? { ...range, status: 'attached' } : { from, to, status: 'deleted' }
      }
      // A replaced Yjs document cannot safely reuse its old absolute offsets.
      return { from: 0, to: 0, status: 'unavailable' }
    } catch { return { from: 0, to: 0, status: 'unavailable' } }
  }
  // Relative anchors wait for the provider instead of attaching to a stale body.
  if (anchor.relative) return { from: 0, to: 0, status: 'unavailable' }
  const range = typeof anchor.from === 'number' && typeof anchor.to === 'number' ? clampDraft({ from: anchor.from, to: anchor.to }, doc) : null
  return range && anchorStillMatches(comment, doc, range.from, range.to)
    ? { ...range, status: 'attached' }
    : { from: 0, to: 0, status: 'unavailable' }
}

/** The only supported navigation target is the live tracked range. */
export function commentLocation(state: EditorState, id: string): CommentAnchorLocation | null {
  return commentMarksKey.getState(state)?.ranges.get(id) ?? null
}
export function commentLocations(state: EditorState): Record<string, CommentAnchorLocation> {
  return Object.fromEntries(commentMarksKey.getState(state)?.ranges ?? [])
}

function decorations(comments: Comment[], ranges: Map<string, TrackedRange>, activeId: string | null, doc: Transaction['doc']) {
  const located = comments.filter((comment) => ranges.get(comment.id)?.status === 'attached').map((comment) => ({
    ...comment, anchor: { ...comment.anchor, ...ranges.get(comment.id)! },
  }))
  return DecorationSet.create(doc, commentAnchorMarks(located, doc).map((mark) => {
    const active = activeId !== null && mark.ids.includes(activeId)
    const spec: MarkSpec = { ids: mark.ids, label: mark.label, resolved: mark.resolved, active }
    return Decoration.inline(mark.from, mark.to, {
      class: 'is-commented' + (mark.resolved ? ' is-commented-resolved' : '') + (active ? ' is-commented-active' : ''),
      'data-comment-id': mark.ids[0],
      title: mark.label + (mark.ids.length > 1 ? ' · 共 ' + mark.ids.length + ' 条评论' : ''),
    }, spec)
  }))
}

export function commentMarksPlugin() {
  return new Plugin<CommentMarkState>({
    key: commentMarksKey,
    state: {
      init: () => ({ deco: DecorationSet.empty, comments: [], activeId: null, draft: null, ranges: new Map() }),
      apply(tr, previous, oldState) {
        const meta = tr.getMeta(commentMarksKey) as CommentMarksMeta | undefined
        if (!meta && !tr.docChanged) return previous
        const comments = meta?.comments ?? previous.comments
        const activeId = meta ? meta.activeId : previous.activeId
        const ranges = new Map<string, TrackedRange>()
        const remote = Boolean(tr.getMeta(ySyncPluginKey)?.isChangeOrigin)
        // y-prosemirror represents a remote edit as a whole-document replace.
        // Relative anchors use Yjs identities; legacy offsets use the smallest
        // changed slice instead of treating all text as deleted.
        let mapping = tr.mapping
        if (remote && tr.docChanged) {
          const start = oldState.doc.content.findDiffStart(tr.doc.content)
          const end = oldState.doc.content.findDiffEnd(tr.doc.content)
          if (start === null || !end) mapping = new Mapping()
          else {
            let before = end.a
            let after = end.b
            if (before < start) { after += start - before; before = start }
            if (after < start) { before += start - after; after = start }
            mapping = new Mapping([new StepMap([start, before - start, after - start])])
          }
        }
        for (const comment of comments) {
          // Replies belong to their root's range, and must never create duplicate markers.
          if (!comment.anchor || comment.parentId) continue
          const old = previous.ranges.get(comment.id)
          if (remote && comment.anchor.relative) {
            ranges.set(comment.id, initialRange(comment, oldState, tr.doc))
            continue
          }
          if (!old || old.status === 'unavailable') {
            ranges.set(comment.id, initialRange(comment, oldState, tr.doc))
            continue
          }
          if (!tr.docChanged) { ranges.set(comment.id, old); continue }
          // Keep a tombstone after deletion. Undo can restore the original words
          // there, while another occurrence elsewhere must never acquire this thread.
          const start = mapping.mapResult(old.from, old.status === 'deleted' ? -1 : 1)
          const end = mapping.mapResult(old.to, old.status === 'deleted' ? 1 : -1)
          const from = start.pos
          const to = end.pos
          // Replacing the whole quote maps the two edges in reverse order.
          // That is a deleted quote, never a range around its replacement.
          const range = from < to ? clampDraft({ from, to }, tr.doc) : null
          const removed = old.status === 'attached' && start.deleted && end.deleted
          const attached = !removed && !!range && (old.status === 'attached' || anchorStillMatches(comment, tr.doc, range.from, range.to))
          ranges.set(comment.id, { from, to, status: attached ? 'attached' : 'deleted' })
        }
        const draft = meta ? (meta.draft ? clampDraft(meta.draft, tr.doc) : null) : (previous.draft ? mapDraft(previous.draft, { doc: tr.doc, mapping }) : null)
        return { deco: decorations(comments, ranges, activeId, tr.doc), comments, activeId, draft, ranges }
      },
    },
    props: {
      decorations(state) {
        const current = commentMarksKey.getState(state)
        if (!current) return null
        const draft = current.draft ? clampDraft(current.draft, state.doc) : null
        return draft ? current.deco.add(state.doc, [Decoration.inline(draft.from, draft.to, { class: 'is-comment-draft' })]) : current.deco
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null
        const id = target?.closest?.('[data-comment-id]')?.getAttribute('data-comment-id')
        if (id) window.dispatchEvent(new CustomEvent('mdoc-focus-comment', { detail: { id } }))
        return false
      },
    },
  })
}
export const CommentMarks = Extension.create({
  name: 'commentMarks',
  addCommands() {
    return {
      setCommentMarks: (comments: Comment[], activeId: string | null = null) => ({ tr, state, dispatch }) => {
        const current = commentMarksKey.getState(state)
        if (!current) return false
        if (dispatch) tr.setMeta(commentMarksKey, { comments, activeId, draft: current.draft } satisfies CommentMarksMeta)
        return true
      },
      setCommentDraft: (draft: CommentDraft | null) => ({ tr, state, dispatch }) => {
        const current = commentMarksKey.getState(state)
        if (!current) return false
        if (dispatch) tr.setMeta(commentMarksKey, { comments: current.comments, activeId: current.activeId, draft } satisfies CommentMarksMeta)
        return true
      },
    }
  },
  addProseMirrorPlugins() { return [commentMarksPlugin()] },
})
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMarks: {
      setCommentMarks: (comments: Comment[], activeId?: string | null) => ReturnType
      setCommentDraft: (draft: CommentDraft | null) => ReturnType
    }
  }
}
