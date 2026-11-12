import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/*
 * Code block boundaries: how a writer gets out of a block, and how a block is
 * removed.
 *
 * The stock CodeBlock extension is optimised for writing code and says nothing
 * about leaving again:
 *
 *   - Enter only ever inserts a newline, because the node is `code: true` and
 *     every key press is literal text. The stock escapes are triple Enter and
 *     ArrowDown on the last line; neither is discoverable, while the shortcut
 *     users do find (Shift+Enter) calls exitCode() and *leaves* the block — the
 *     opposite of what Shift+Enter means everywhere else.
 *   - Backspace at the start of the block calls clearNodes(), which does not
 *     remove the node: it demotes it to a paragraph and keeps the code as body
 *     text. Deleting a code block therefore looked like deleting the wrong
 *     thing.
 *
 * Both rules live here rather than in the schema, so existing documents, the
 * server schema and the Markdown round-trip are untouched.
 */

/**
 * True when the caret sits after the final character of the final line of a code
 * block.
 *
 *
 * A code block is a `code: true` node whose content is the raw text, newlines
 * included, so "the end of the block" is exactly "the end of its content" — no
 * trailing-empty-line bookkeeping is needed, unlike a paragraph inside a list.
 */
export function isAtCodeBlockEnd(selection: { empty: boolean; $from: { parent: { type: { name: string }; content: { size: number } }; parentOffset: number } }): boolean {
  const { empty, $from } = selection
  if (!empty || $from.parent.type.name !== 'codeBlock') return false
  return $from.parentOffset === $from.parent.content.size
}


export const CodeBlockBoundary = Extension.create({
  name: 'codeBlockBoundary',

  addOptions() {
    return {
      /** Enter on the last line, at its end, drops out of the block. */
      exitOnEnterAtEnd: true,
      /** Backspace at the start empties first, then removes the block. */
      removeOnEmptyBackspace: true,
      /** Whether Shift+Enter may leave the block (the stock exitCode() path). */
      allowShiftEnterExit: false,
    }
  },

  addKeyboardShortcuts() {
    const isCode = (editor: Editor) => editor.isActive('codeBlock')

    const atCodeEnd = (editor: Editor) => isAtCodeBlockEnd(editor.state.selection)

    return {
      /*
       * Enter stays a newline everywhere except at the very end of the block.
       * That keeps the block usable for code and gives it the one escape every
       * writer already knows: press Enter where you want to start writing.
       */
      Enter: ({ editor }) => {
        if (!this.options.exitOnEnterAtEnd) return false
        if (!isCode(editor) || !atCodeEnd(editor)) return false
        // splitBlock at the end of a code node creates a paragraph after it and
        // puts the caret there; the block itself is left alone.
        return editor.commands.splitBlock()
      },

      /*
       * Shift+Enter inside a block inserts a newline, matching every other
       * editor. Without this the stock handler maps it to exitCode(), so the
       * one shortcut that should insert a line break was the only way out.
       */
      'Shift-Enter': ({ editor }) => {
        if (!isCode(editor)) return false
        if (this.options.allowShiftEnterExit && atCodeEnd(editor)) return editor.commands.exitCode()
        /*
         * setHardBreak() inserts a hardBreak *node*, which a code block cannot
         * hold (content is text*), so the command is rejected and the press falls
         * through to the stock exitCode handler — the exact behaviour this rule
         * exists to prevent. A code block represents a line break as "\n" inside
         * its text, so that is what gets inserted.
         */
        return editor
          .chain()
          .command(({ tr, state }) => {
            const from = state.selection.from
            tr.insertText('\n', from, state.selection.to)
            // Keep the caret after the inserted newline. Without an explicit
            // selection the mapping can leave the caret at the block boundary,
            // where ProseMirror's own Enter handling then also adds a paragraph
            // — the press would both break the line and leave the block.
            tr.setSelection(TextSelection.create(tr.doc, from + 1))
            return true
          })
          .run()
      },

      /*
       * Backspace at the start of the block: empty it first, delete the node
       * second. The intermediate state is ordinary undoable editing, so a
       * mis-press costs one Ctrl+Z rather than the whole snippet.
       */
      Backspace: ({ editor }) => {
        if (!this.options.removeOnEmptyBackspace) return false
        const { state } = editor
        const { empty, $from } = state.selection
        if (!empty || $from.parent.type.name !== 'codeBlock') return false
        if ($from.parentOffset !== 0) return false

        // Second press, block already empty: remove the node and land the caret
        // at the end of whatever now precedes it.
        if ($from.parent.content.size === 0) {
          const start = $from.before()
          const size = $from.parent.nodeSize
          return editor.chain()
            .command(({ tr }) => {
              tr.delete(start, start + size)
              // Land at the end of whatever now precedes the block; clamp to 1 so
              // removing the first node of the document cannot produce pos 0,
              // which is not a valid text position.
              const target = Math.max(1, Math.min(start - 1, tr.doc.content.size))
              tr.setSelection(TextSelection.create(tr.doc, target))
              return true
            })
            .run()
        }

        // First press: clear the content but keep the (now empty) block.
        const start = $from.start()
        const end = $from.end()
        return editor.chain()
          .command(({ tr }) => {
            tr.delete(start, end)
            tr.setSelection(TextSelection.create(tr.doc, start))
            return true
          })
          .run()
      },
    }
  },
})
