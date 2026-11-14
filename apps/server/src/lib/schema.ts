import { getSchema, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import { DocumentImage } from './image.js';
import { FontSize } from './font-size.js';

/**
 * Paragraph and heading indentation, in steps of one.
 *
 * Tab in prose used to only indent list items; a plain paragraph swallowed the key
 * with nothing to show for it. The attribute is the smallest representation that
 * works everywhere: one integer, no nested container, no change to how the document
 * is serialised - a reader who does not know the attribute still sees the text.
 *
 * Declared here and in the client extension because the two schemas must accept the
 * same documents. A node the client can produce and the server rejects makes every
 * REST save return 400 while collaboration keeps working, which is the trap recorded
 * in lib/editor/image.ts.
 */
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute('data-indent') || 0),
          renderHTML: (attributes) => (attributes.indent ? { 'data-indent': attributes.indent } : {}),
        },
      },
    }]
  },
})

/**
 * Editor extensions shared by the REST API and the collaboration layer. The
 * list mirrors `apps/web` so documents accepted here render identically in the
 * browser editor.
 */
export const editorExtensions = [
  StarterKit,
  Underline,
  Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  DocumentImage,
  Indent,
];

/** ProseMirror schema derived from {@link editorExtensions}. */
export const schema = getSchema(editorExtensions);

export type EditorSchema = typeof schema;