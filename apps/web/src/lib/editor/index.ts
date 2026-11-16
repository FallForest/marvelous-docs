import type { Doc as YDoc } from 'yjs'
import type { NodeViewRenderer } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
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
import { DocumentImage } from './image'
import { wordCount } from '../format'
import { FontSize } from './font-size'
import { CodeBlockBoundary } from './code-block'
import { CommentMarks } from './comment-marks'
import { BlockShortcuts } from './block-shortcuts'
import { Indent, TabInProse } from './tab-in-prose'
import { uploadPlaceholderPlugin } from './upload-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from './highlight'

export type EditorExtensionOptions = {
  ydoc?: YDoc | null
  placeholder?: string
  codeBlockNodeView?: NodeViewRenderer
  /** Called when the writer taps 重试 on a failed in-place image upload. */
  onRetryUpload?: (id: string) => void
}

export function buildEditorExtensions(options: EditorExtensionOptions = {}) {
  const { ydoc, placeholder, codeBlockNodeView, onRetryUpload } = options
  const CodeBlock = codeBlockNodeView ? CodeBlockLowlight.extend({ addNodeView() { return codeBlockNodeView } }) : CodeBlockLowlight
  return [
    // The code block comes from CodeBlockLowlight instead of StarterKit, so the
    // node carries syntax tokens; the node type and `language` attribute are
    // identical, which is what keeps the server schema in step.
    StarterKit.configure({ ...(ydoc ? { history: false } : {}), codeBlock: false }),
    CodeBlock.configure({
      lowlight,
      // The node stores our own language id (`csharp`), while the grammar is
      // looked up through grammarFor. Passing the id straight through would leave
      // the aliases unhighlighted.
      languageClassPrefix: 'language-',
      // Boundary keys are owned by CodeBlockBoundary below: it needs to rewrite
      // both handlers, and leaving the stock ones in place would keep the old
      // "Backspace demotes the block to a paragraph" behaviour alive.
      exitOnTripleEnter: false,
      exitOnArrowDown: false,
    }),
    CodeBlockBoundary,
    Indent,
    TabInProse,
    BlockShortcuts,
    CommentMarks,
    Underline,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    /*
     * CharacterCount's storage is what the footer reads, so the *number* has to
     * mean what the label says.
     *
     * The default `wordCounter` is `text.split(' ').filter(Boolean).length`, i.e.
     * space-delimited tokens. Chinese prose has no spaces, so a 200-character
     * paragraph counted as one "word" while the footer said 字数. `wordCount`
     * from lib/format.ts already counts CJK characters plus Latin words, and it
     * is the same function the rest of the app uses, so the footer and any other
     * count cannot drift apart again.
     */
    CharacterCount.configure({ wordCounter: wordCount }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    DocumentImage,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    // The uploading-image placeholder is a decoration plugin, so it is added by
    // hand rather than as a Tiptap extension: it must not contribute nodes.
    Extension.create({ name: 'uploadPlaceholder', addProseMirrorPlugins: () => [uploadPlaceholderPlugin(onRetryUpload || (() => undefined))] }),
    ...(ydoc ? [Collaboration.configure({ document: ydoc })] : []),
  ]
}
