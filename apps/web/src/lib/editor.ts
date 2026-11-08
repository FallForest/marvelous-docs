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
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { FontSize } from './font-size'

export type EditorExtensionOptions = { ydoc?: YDoc | null; placeholder?: string }

export function buildEditorExtensions(options: EditorExtensionOptions = {}) {
  const { ydoc, placeholder } = options
  return [
    StarterKit.configure(ydoc ? { history: false } : {}),
    Underline,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: true }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ...(ydoc ? [Collaboration.configure({ document: ydoc })] : []),
  ]
}