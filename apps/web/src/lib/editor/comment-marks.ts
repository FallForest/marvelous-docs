import { Extension } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Comment } from '../types'

/*
 * Comment markers: the text a thread is about, marked in the text itself.
 *
 * A comment stores `anchor: {from, to, text}` — the document range captured when
 * it was written. Storing the range is what lets the panel quote the sentence
 * later; marking it here is what makes the sentence findable without opening the
 * panel first. The reason is plain: a thread that cannot be located in the page
 * is a chat log, not a review.
 *
 * Two decisions are worth recording.
 *
 * 1. Decorations, not a mark. A ProseMirror mark lives *in* the document: it
 *    would round-trip into Markdown, HTML, PDF and the server schema, so every
 *    comment would become part of the text it comments on. Decorations are
 *    view-only, map through edits, and disappear with the thread.
 *
 * 2. An anchor is placed once, then mapped. The stored range is a snapshot, so
 *    replaying it after the document moved would drag an old marker back to where
 *    its text used to be. Only ranges that are not on screen yet are taken from
 *    the anchor, and only while the text at that range still says what the anchor
 *    says. Everything already placed is mapped through each transaction, so a
 *    marker follows the text it belongs to.
 */

/** One contiguous stretch of text covered by one or more comment threads. */
export type CommentMark = {
  /** Comment ids covering this range, in anchor order. */
  ids: string[]
  from: number
  to: number
  /** The quoted excerpt, shown as the marker's tooltip. */
  label: string
  /** True when every thread on the range is resolved. */
  resolved: boolean
}

type MarkSpec = { ids: string[]; label: string; resolved: boolean; active: boolean }

/** The range the composer is quoting, before it becomes a thread. */
export type CommentDraft = { from: number; to: number }

export type CommentMarksMeta = { comments: Comment[]; activeId: string | null; draft: CommentDraft | null }

type CommentMarkState = {
  deco: DecorationSet
  /** The last thread list the markers were reconciled against. */
  comments: Comment[]
  activeId: string | null
  draft: CommentDraft | null
}

export const commentMarksKey = new PluginKey<CommentMarkState>('commentMarks')

type DocLike = {
  content: { size: number }
  textBetween: (from: number, to: number, blockSeparator?: string) => string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const covers = (ids: string[], activeId: string | null) => activeId !== null && ids.includes(activeId)
// Whitespace is removed rather than collapsed: an anchor captured across a line
// break and the same words read back from the document must compare equal, and
// ProseMirror's textBetween already inserts a space at a block boundary.
const fold = (text: string) => text.replace(/\s+/g, '')

function excerptOf(comment: Comment) {
  const text = fold(comment.anchor?.text || comment.body || '')
  if (!text) return '评论'
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}

/**
 * Turns stored anchors into marks that are valid for the current document.
 *
 * Anchors are absolute positions, so they can arrive out of order (`from` and
 * `to` read back reversed), past the end of a document that was shortened, or as
 * a collapsed range whose text is gone. Each of those is dropped or clamped
 * rather than trusted: a decoration outside the document throws, while the
 * thread itself stays perfectly readable without a marker.
 *
 * Overlapping ranges become one mark. Two reviewers on the same sentence should
 * see one underline that answers to both threads, not two stacked translucent
 * bands — and the tooltip still names the text once.
 */
export function commentAnchorMarks(comments: Comment[], doc: DocLike): CommentMark[] {
  const limit = Math.max(2, doc.content.size)
  const ranges: CommentMark[] = []
  for (const comment of comments) {
    const anchor = comment.anchor
    if (!anchor || typeof anchor.from !== 'number' || typeof anchor.to !== 'number') continue
    if (!Number.isFinite(anchor.from) || !Number.isFinite(anchor.to)) continue
    const from = clamp(Math.min(anchor.from, anchor.to), 1, limit - 1)
    const to = clamp(Math.max(anchor.from, anchor.to), 1, limit - 1)
    if (to <= from) continue
    ranges.push({ ids: [comment.id], from, to, label: excerptOf(comment), resolved: comment.status === 'resolved' })
  }
  ranges.sort((left, right) => left.from - right.from || right.to - left.to)

  const merged: CommentMark[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    // Strict overlap only: two ranges that merely touch (5-8 and 8-12) are
    // comments on separate words and must not share one highlight.
    if (last && range.from < last.to) {
      last.to = Math.max(last.to, range.to)
      for (const id of range.ids) if (!last.ids.includes(id)) last.ids.push(id)
      last.resolved = last.resolved && range.resolved
      if (last.label === '评论' && range.label !== '评论') last.label = range.label
      continue
    }
    merged.push({ ...range, ids: [...range.ids] })
  }
  return merged
}

/**
 * Whether an anchor still points at the words it was taken from.
 *
 * This is what keeps a stale range from underlining an unrelated stretch of text
 * after an edit, a paste or a collaborative merge. It is also what makes the
 * first paint survivable: under collaboration the body arrives from the Yjs
 * provider *after* the comment list, so the first reconciliation sees an empty
 * document, places nothing, and this test lets the marker appear once the text
 * does. An anchor without quoted text carries nothing to verify, so only its
 * range is checked.
 */
export function anchorStillMatches(comment: Comment, doc: DocLike, from: number, to: number) {
  const expected = fold(comment.anchor?.text || '')
  if (!expected) return true
  const actual = fold(doc.textBetween(from, to, ' '))
  if (!actual) return false
  // The capture caps the excerpt at 500 characters, so the two strings are
  // compared as prefixes rather than for equality.
  return actual === expected || actual.startsWith(expected) || expected.startsWith(actual)
}

/** Keeps a quoted range inside the document; an empty result means "no range". */
export function clampDraft(draft: CommentDraft, doc: DocLike): CommentDraft | null {
  const limit = Math.max(2, doc.content.size)
  const from = clamp(Math.min(draft.from, draft.to), 1, limit - 1)
  const to = clamp(Math.max(draft.from, draft.to), 1, limit - 1)
  return to > from ? { from, to } : null
}

/** Maps a quoted range through an edit, keeping it inside the document. */
export function mapDraft(draft: CommentDraft, tr: Pick<Transaction, 'doc' | 'mapping'>): CommentDraft {
  return clampDraft(
    { from: tr.mapping.map(draft.from, -1), to: tr.mapping.map(draft.to, 1) },
    tr.doc,
  ) ?? draft
}

function decorationFor(from: number, to: number, spec: MarkSpec) {
  const classes = ['is-commented']
  if (spec.resolved) classes.push('is-commented-resolved')
  if (spec.active) classes.push('is-commented-active')
  const attributes: Record<string, string | undefined> = {
    class: classes.join(' '),
    // The first id is what a click acts on; every id travels in the spec, so the
    // whole group lights up when any one of its threads is open.
    'data-comment-id': spec.ids[0],
    // The tooltip is the only place a stacked thread count can live: a badge
    // would be painted once per wrapped line fragment of the range.
    title: spec.ids.length > 1 ? spec.label + ' · 共 ' + spec.ids.length + ' 条评论' : spec.label,
  }
  return Decoration.inline(from, to, attributes, spec)
}

/**
 * Reconciles the marker set with the thread list.
 *
 * Exported so the headless test can drive it against a real ProseMirror
 * transaction without a DOM: it only reads the document and the mapping.
 */
export function applyCommentMarks(
  deco: DecorationSet,
  comments: Comment[],
  activeId: string | null,
  tr: Pick<Transaction, 'doc' | 'mapping'>,
): DecorationSet {
  let next = deco.map(tr.mapping, tr.doc)
  const marks = commentAnchorMarks(comments, tr.doc)
  const tone = new Map<string, boolean>()
  for (const mark of marks) for (const id of mark.ids) tone.set(id, mark.resolved)

  // Threads that no longer exist (deleted, or a different document) lose their
  // marker; every other one keeps the marker it already has.
  const wanted = new Set(marks.flatMap((mark) => mark.ids))
  const stale = next.find().filter((decoration) => !(decoration.spec as MarkSpec).ids.some((id) => wanted.has(id)))
  if (stale.length) next = next.remove(stale)

  const placed = new Set(next.find().flatMap((decoration) => (decoration.spec as MarkSpec).ids))
  const fresh = marks.filter((mark) => {
    if (mark.ids.some((id) => placed.has(id))) return false
    const source = comments.find((comment) => comment.id === mark.ids[0])
    return !!source && anchorStillMatches(source, tr.doc, mark.from, mark.to)
  })
  if (fresh.length) {
    next = next.add(tr.doc, fresh.map((mark) => decorationFor(mark.from, mark.to, {
      ids: mark.ids,
      label: mark.label,
      resolved: mark.resolved,
      active: covers(mark.ids, activeId),
    })))
  }

  /*
   * Re-tint only what actually changed. A decoration's attributes are baked in
   * when it is created, so opening or resolving a thread means replacing the
   * span, not editing it — and the replacement is built from the decoration's
   * *current* range, so a re-tint never rewinds a marker that already moved.
   */
  const wrong = next.find().filter((decoration) => {
    const spec = decoration.spec as MarkSpec
    const wantResolved = spec.ids.every((id) => tone.get(id) ?? spec.resolved)
    return spec.active !== covers(spec.ids, activeId) || spec.resolved !== wantResolved
  })
  if (wrong.length) {
    /*
     * The ranges and specs are read out first: DecorationSet.remove() consumes
     * the array it is given (it nulls every entry it matched), so a map over
     * the same array afterwards would rebuild from nulls.
     */
    const replacements = wrong.map((decoration) => ({ from: decoration.from, to: decoration.to, spec: decoration.spec as MarkSpec }))
    next = next.remove(wrong)
    next = next.add(tr.doc, replacements.map(({ from, to, spec }) => decorationFor(from, to, {
      ...spec,
      resolved: spec.ids.every((id) => tone.get(id) ?? spec.resolved),
      active: covers(spec.ids, activeId),
    })))
  }

  return next
}

export function commentMarksPlugin() {
  return new Plugin<CommentMarkState>({
    key: commentMarksKey,
    state: {
      init: () => ({ deco: DecorationSet.empty, comments: [], activeId: null, draft: null }),
      apply(tr, previous) {
        const meta = tr.getMeta(commentMarksKey) as CommentMarksMeta | undefined
        // Nothing to reconcile: no new thread list and no document change.
        if (!meta && !tr.docChanged) return previous
        const comments = meta ? meta.comments : previous.comments
        const activeId = meta ? meta.activeId : previous.activeId
        /*
         * The quoted range is mapped rather than re-read: typing inside the
         * quote has to keep the highlight around the text, not around the
         * positions that text happened to occupy a keystroke ago.
         */
        const draft = meta
          ? (meta.draft ? clampDraft(meta.draft, tr.doc) : null)
          : (previous.draft ? mapDraft(previous.draft, tr) : null)
        return { deco: applyCommentMarks(previous.deco, comments, activeId, tr), comments, activeId, draft }
      },
    },
    props: {
      decorations(state) {
        const current = commentMarksKey.getState(state)
        if (!current) return null
        const draft = current.draft ? clampDraft(current.draft, state.doc) : null
        if (!draft) return current.deco
        // Assembled per call on purpose: the draft range changes on every
        // keystroke, and a DecorationSet is immutable anyway.
        return current.deco.add(state.doc, [
          Decoration.inline(draft.from, draft.to, { class: 'is-comment-draft' }, { draft: true }),
        ])
      },
      /*
       * Clicking marked text opens its thread — the movement the marker
       * advertises. The click is *not* swallowed: the caret still lands where the
       * user pressed, so opening a thread never interrupts reading.
       */
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null
        const host = target && typeof target.closest === 'function' ? target.closest('[data-comment-id]') : null
        const id = host?.getAttribute('data-comment-id')
        if (!id) return false
        window.dispatchEvent(new CustomEvent('mdoc-focus-comment', { detail: { id } }))
        return false
      },
    },
  })
}

export const CommentMarks = Extension.create({
  name: 'commentMarks',

  addCommands() {
    return {
      /** Pushes the thread list into the view, keeping the open thread's tint. */
      setCommentMarks: (comments: Comment[], activeId: string | null = null) => ({ tr, state, dispatch }) => {
        if (!commentMarksKey.getState(state)) return false
        const draft = commentMarksKey.getState(state)?.draft ?? null
        if (dispatch) tr.setMeta(commentMarksKey, { comments, activeId, draft } satisfies CommentMarksMeta)
        return true
      },
      /** Highlights the range the composer is quoting, without creating a thread. */
      setCommentDraft: (draft: CommentDraft | null) => ({ tr, state, dispatch }) => {
        const current = commentMarksKey.getState(state)
        if (!current) return false
        if (dispatch) tr.setMeta(commentMarksKey, { comments: current.comments, activeId: current.activeId, draft } satisfies CommentMarksMeta)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [commentMarksPlugin()]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMarks: {
      /** Reconciles the comment markers against the document's threads. */
      setCommentMarks: (comments: Comment[], activeId?: string | null) => ReturnType
      /** Highlights the range the composer is quoting, without creating a thread. */
      setCommentDraft: (draft: CommentDraft | null) => ReturnType
    }
  }
}