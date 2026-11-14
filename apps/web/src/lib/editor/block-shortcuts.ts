import { Extension, type Editor } from '@tiptap/core'
import {
  canMoveBlock, deleteBlock, duplicateBlock, moveBlock, topLevelBlockAt,
} from './blocks'

/**
 * Block-level keyboard shortcuts.
 *
 * Every structural operation already existed in `blocks.ts` — the gutter handle and
 * the context menu have used them for a while — but they were reachable only with a
 * pointer. A writer who never touches the gutter had no way to move a paragraph
 * except cut and paste, which loses the cursor and creates two undo steps.
 *
 * The commands are the same functions the gutter calls, so an operation stays one
 * undo step in both ProseMirror history and Yjs. That isolation is the whole reason
 * this is a thin binding rather than a new implementation.
 *
 * Shortcuts follow the conventions the rest of the industry trained people on, with
 * one deliberate detour: formatting uses `Mod-Alt` rather than `Mod-Shift` for
 * headings, because `Mod-Shift-<digit>` is claimed by browser tab switching on most
 * platforms and a shortcut that fights the browser is not a shortcut.
 */
export const BlockShortcuts = Extension.create({
  name: 'blockShortcuts',
  // Above the default map so a block move wins over the paragraph's own handling of
  // the same chord, but below the code block (1100), which owns these keys while the
  // caret is inside a fence.
  priority: 900,

  addKeyboardShortcuts() {
    /** The top-level block that owns the caret, or null. */
    const target = () => {
      const editor = this.editor
      if (!editor.isEditable) return null
      const block = topLevelBlockAt(editor.state.doc, editor.state.selection.from)
      return block ? block.pos : null
    }

    return {
      'Mod-Shift-ArrowUp': () => {
        const pos = target()
        return pos !== null && canMoveBlock(this.editor, pos, -1) && moveBlock(this.editor, pos, -1)
      },
      'Mod-Shift-ArrowDown': () => {
        const pos = target()
        return pos !== null && canMoveBlock(this.editor, pos, 1) && moveBlock(this.editor, pos, 1)
      },
      'Mod-Shift-d': () => {
        const pos = target()
        return pos !== null && duplicateBlock(this.editor, pos)
      },
      'Mod-Shift-Backspace': () => {
        const pos = target()
        return pos !== null && deleteBlock(this.editor, pos)
      },
      // Turn the block into a heading of a given level, or back into prose with 0.
      'Mod-Alt-1': () => turnInto(this.editor, 1),
      'Mod-Alt-2': () => turnInto(this.editor, 2),
      'Mod-Alt-3': () => turnInto(this.editor, 3),
      'Mod-Alt-0': () => turnInto(this.editor, 0),
    }
  },
})

/** `0` is prose; anything else is a heading level. */
function turnInto(editor: Editor, level: 0 | 1 | 2 | 3) {
  const chain = editor.chain().focus()
  return level === 0 ? chain.setParagraph().run() : chain.setHeading({ level }).run()
}
