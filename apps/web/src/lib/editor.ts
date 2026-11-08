import type { Doc as YDoc } from 'yjs'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TextStyle from '@tiptap/extension-text-style'

export type EditorExtensionOptions = { ydoc?: YDoc | null; placeholder?: string }

export function buildEditorExtensions(options: EditorExtensionOptions = {}) {
  const { ydoc, placeholder } = options
  return [
    StarterKit.configure(ydoc ? { history: false } : {}),
    Underline,
    Link.configure({ openOnClick: false, autolink: true }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ...(ydoc ? [Collaboration.configure({ document: ydoc })] : []),
  ]
}
