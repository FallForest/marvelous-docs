import { getSchema } from '@tiptap/core';
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
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
];

/** ProseMirror schema derived from {@link editorExtensions}. */
export const schema = getSchema(editorExtensions);

export type EditorSchema = typeof schema;
