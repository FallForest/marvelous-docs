import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { CommandContext } from '../command.js';
import { CliError, messageOf, usageError } from '../errors.js';
import type { Cell, ColorName, Column } from '../output.js';
import type { DocJson, Document } from '../types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function requirePositional(ctx: CommandContext, index: number, label: string): string {
  const value = ctx.positional[index];
  if (value === undefined || value === '') {
    throw usageError('Missing ' + label + '. Run "mdocs ' + ctx.commandName + ' --help" for usage.');
  }
  return value;
}

export function optionalPositional(ctx: CommandContext, index: number): string | undefined {
  const value = ctx.positional[index];
  return value === undefined || value === '' ? undefined : value;
}

export function uuidArgument(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw usageError(label + ' must be a UUID, received "' + value + '".');
  return value;
}

export async function readInput(file: string, readStdin: () => Promise<string>): Promise<string> {
  if (file === '-') return readStdin();
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw usageError('Cannot read ' + file + ': ' + messageOf(error));
  }
}

function isDocJson(value: unknown): value is DocJson {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return false;
  const doc = record.doc;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const document = doc as Record<string, unknown>;
  return document.type === 'doc' && Array.isArray(document.content);
}

export function parseDocJson(text: string, label = 'Document content'): DocJson {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw usageError(label + ' is not valid JSON: ' + messageOf(error));
  }
  if (!isDocJson(value)) {
    throw usageError(label + ' must match {"schemaVersion":1,"doc":{"type":"doc","content":[]}}.');
  }
  return value;
}

export const EMPTY_DOC: DocJson = { schemaVersion: 1, doc: { type: 'doc', content: [] } };

export function blankDocument(): DocJson {
  return { schemaVersion: 1, doc: { type: 'doc', content: [] } };
}

export function formatTimestamp(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

export function collapseWhitespace(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  return single.slice(0, Math.max(0, max - 1)).trimEnd() + '\u2026';
}

export function kindColor(kind: string): ColorName | undefined {
  return kind === 'folder' ? 'cyan' : undefined;
}

export const DOCUMENT_COLUMNS: Column[] = [
  { header: 'id' },
  { header: 'title' },
  { header: 'kind' },
  { header: 'version', align: 'right' },
  { header: 'updated' }
];

export function documentRow(document: Document): Cell[] {
  return [
    document.id,
    document.title,
    { text: document.kind, color: kindColor(document.kind) },
    String(document.version),
    formatTimestamp(document.updatedAt)
  ];
}

export function printDocuments(ctx: CommandContext, documents: Document[]): void {
  ctx.out.table(DOCUMENT_COLUMNS, documents.map(documentRow));
}

export function emitDocument(ctx: CommandContext, command: string, document: Document, verb: string): void {
  if (ctx.out.json) {
    ctx.out.envelope(command, { document });
    return;
  }
  ctx.out.success(verb + ' "' + document.title + '" (' + document.id + ') version ' + document.version + '.');
}

export function emitOk(ctx: CommandContext, command: string, data: Record<string, unknown>, message: string): void {
  if (ctx.out.json) {
    ctx.out.envelope(command, data);
    return;
  }
  ctx.out.success(message);
}

export function fileStem(file: string): string {
  const name = basename(file);
  const extension = extname(name);
  return extension === '' ? name : name.slice(0, name.length - extension.length);
}

export function errorMessage(error: unknown): string {
  return error instanceof CliError ? error.message : messageOf(error);
}
