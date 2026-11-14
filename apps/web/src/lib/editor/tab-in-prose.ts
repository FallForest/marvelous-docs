import { Extension } from '@tiptap/core'

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
      setIndent: (level: number) => ({ commands }: { commands: { updateAttributes: (type: string, attrs: Record<string, unknown>) => boolean } }) =>
        this.options.types.every((type: string) => commands.updateAttributes(type, { indent: Math.max(0, Math.min(6, level)) })),
    } as never
  },
})

import { sinkListItem, liftListItem } from '@tiptap/pm/schema-list'

/**
 * Tab inside prose.
 *
 * Tab had no binding outside a code block, so pressing it in a paragraph moved
 * focus out of the editor to the next control — which, in a document that fills the
 * window, is invisible. Writers read that as "the editor stopped accepting input".
 *
 * Inside a list, Tab/Shift-Tab indent and outdent the item, which is what every
 * outliner does and the only place where tab-indent has an unambiguous meaning.
 * In a paragraph `sinkListItem` does nothing, so the key is consumed and nothing
 * moves: a no-op is a better answer than a focus jump, and it keeps the door open
 * for a real paragraph indent once `documents.content` can express one.
 *
 * Priority 1000 puts this above StarterKit's list keymap but below the code block
 * (1100), which owns Tab for literal indentation.
 */
/** The current block's indent step, or 0 when it is not an indented type. */
function indentOf(editor: { state: { selection: { $from: { parent: { attrs: Record<string, unknown> } } } } }): number {
  const value = editor.state.selection.$from.parent.attrs.indent
  return typeof value === 'number' ? value : 0
}

export const TabInProse = Extension.create({
  name: 'tabInProse',
  priority: 1000,

  addKeyboardShortcuts() {
    const listItem = () => this.editor.schema.nodes.listItem
    const taskItem = () => this.editor.schema.nodes.taskItem

    /** The list node the caret sits inside, if any. */
    const listNode = () => {
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth)
        if (node.type === listItem()) return listItem()
        if (node.type === taskItem()) return taskItem()
      }
      return null
    }

    return {
      Tab: () => {
        if (!this.editor.isEditable) return false
        const type = listNode()
        if (type) return sinkListItem(type)(this.editor.state, this.editor.view.dispatch)
        // A paragraph or heading moves one step: the key used to be consumed with
        // nothing to show for it, which read as "the editor stopped listening".
        return this.editor.commands.setIndent(indentOf(this.editor) + 1)
      },
      'Shift-Tab': () => {
        if (!this.editor.isEditable) return false
        const type = listNode()
        if (type) return liftListItem(type)(this.editor.state, this.editor.view.dispatch)
        return this.editor.commands.setIndent(indentOf(this.editor) - 1)
      },
    }
  },
})
