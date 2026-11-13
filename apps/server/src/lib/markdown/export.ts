/**
 * The export envelope: documentId / format / filename / content.
 *
 * One shape for every server-side format keeps the route and the CLI on the
 * same contract; a new format adds a branch here and nothing else.
 */
import { documentNodeFrom } from './nodes.js'
import { tiptapToHtml } from './html.js'
import { tiptapToMarkdown } from './serialize.js'

export type ExportFormat = 'markdown' | 'html' | 'json';

/** Converts a title into a filesystem-safe slug. */
export function slugifyFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
  return slug || 'document';
}

export type ExportRow = { id: string; title: string; content: unknown };

export type ExportEnvelope = {
  documentId: string;
  format: ExportFormat;
  filename: string;
  content: string;
};

/** Builds the documentId/format/filename/content export envelope. */
export function exportResponse(row: ExportRow, format: ExportFormat = 'markdown'): ExportEnvelope {
  const document = documentNodeFrom(row.content);
  const slug = slugifyFilename(row.title);
  if (format === 'json') {
    return {
      documentId: row.id,
      format,
      filename: slug + '.json',
      content: JSON.stringify(row.content ?? { schemaVersion: 1, doc: document }, null, 2),
    };
  }
  if (format === 'html') {
    return {
      documentId: row.id,
      format,
      filename: slug + '.html',
      content: tiptapToHtml(document, { title: row.title }),
    };
  }
  return {
    documentId: row.id,
    format: 'markdown',
    filename: slug + '.md',
    content: tiptapToMarkdown(document),
  };
}
