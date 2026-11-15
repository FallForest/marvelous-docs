import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import { sinkListItem, liftListItem } from '@tiptap/pm/schema-list'

/**
 * Paragraph and heading indentation, in steps of one.
 *
 * The mirror of `apps/server/src/lib/schema.ts`: the two schemas have to accept the
 * same documents, and the server rejects what it cannot represent. Keep the attribute
 * shape identical - a mismatch makes every REST save fail while collaboration keeps
 * working, which is the trap recorded in `image.ts`.
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** One indentation step for the block containing the caret. */
      setIndent: (level: number) => ReturnType
    }
  }
}

export const Indent = Extension.create({
  name: 'indent',
  addOptions() { return { types: ['paragraph', 'heading'] as string[] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-indent') || 0),
          renderHTML: (attributes: { indent?: number }) => (attributes.indent ? { 'data-indent': attributes.indent } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      /** One step in or out, clamped at 0 and 6. */
      setIndent: (level: number) => ({ tr, dispatch }: CommandProps) => {
        if (!Number.isFinite(level)) return false
        return updateProseIndent(tr, () => Math.max(0, Math.min(6, Math.trunc(level))), dispatch)
      },
    } as never
  },
})

/** Update each selected prose block independently, preserving relative levels. */
function updateProseIndent(tr: Transaction, level: (current: number) => number, dispatch?: unknown): boolean {
  let changed = false
  const { from, to } = tr.selection
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
    const current = Number(node.attrs.indent) || 0
    const next = level(current)
    if (next === current) return
    changed = true
    if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
  })
  return changed
}

function listItemType(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type
    if (type.name === 'listItem' || type.name === 'taskItem') return type
  }
  return null
}

/** The same command powers buttons and keyboard bindings, including can(). */
export const changeBlockIndent = (direction: 1 | -1): Command => (state, dispatch) => {
  const type = listItemType(state)
  if (type) return (direction === 1 ? sinkListItem(type) : liftListItem(type))(state, dispatch)
  const tr = state.tr
  const changed = updateProseIndent(tr, (current) => Math.max(0, Math.min(6, current + direction)), dispatch)
  if (changed && dispatch) dispatch(tr)
  return changed
}

/**
 * Tab inside prose.
 *
 * Tab had no binding outside a code block, so pressing it in a paragraph moved
 * focus out of the editor to the next control — which, in a document that fills the
 * window, is invisible. Writers read that as "the editor stopped accepting input".
 *
 * Inside a list, Tab/Shift-Tab indent and outdent the item, which is what every
 * outliner does and the only place where tab-indent has an unambiguous meaning.
 * Paragraphs and headings use the persisted indent attribute. Table Tab is left
 * to the table extension, which moves between cells; code owns literal spaces.
 *
 * Priority 1000 puts this above StarterKit's list keymap but below the code block
 * (1100), which owns Tab for literal indentation.
 */
export const TabInProse = Extension.create({
  name: 'tabInProse',
  priority: 1000,

  addKeyboardShortcuts() {
    const inTable = () => {
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === 'table') return true
      }
      return false
    }

    return {
      Tab: () => {
        if (!this.editor.isEditable || inTable()) return false
        // Consume prose Tab at a limit too, keeping the caret in the document.
        changeBlockIndent(1)(this.editor.state, this.editor.view.dispatch)
        return true
      },
      'Shift-Tab': () => {
        if (!this.editor.isEditable || inTable()) return false
        changeBlockIndent(-1)(this.editor.state, this.editor.view.dispatch)
        return true
      },
    }
  },
})
