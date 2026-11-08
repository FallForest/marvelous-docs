import type { CommandContext, CommandDefinition } from '../command.js';
import { CliError, EXIT, usageError } from '../errors.js';
import type { Cell, Column } from '../output.js';
import type { Document, DocumentVersion } from '../types.js';
import {
  emitDocument,
  formatTimestamp,
  requirePositional,
  uuidArgument
} from './support.js';

type VersionResponse = { version?: DocumentVersion };
type DocumentResponse = { document?: Document };

function requireVersion(response: VersionResponse): DocumentVersion {
  if (!response.version) throw new CliError('The server did not return a version.', EXIT.NETWORK);
  return response.version;
}

function documentId(ctx: CommandContext): string {
  return uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
}

const VERSION_COLUMNS: Column[] = [
  { header: 'id' },
  { header: 'version', align: 'right' },
  { header: 'title' },
  { header: 'author' },
  { header: 'created' }
];

async function list(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const response = await ctx.api().get<{ versions?: DocumentVersion[] }>('/documents/' + encodeURIComponent(id) + '/versions');
  const versions = response.versions ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('versions list', { documentId: id, versions });
    return;
  }
  const rows: Cell[][] = versions.map(version => [
    version.id,
    String(version.version),
    version.title,
    version.createdByName ?? version.createdBy,
    formatTimestamp(version.createdAt)
  ]);
  ctx.out.table(VERSION_COLUMNS, rows);
}

async function show(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const versionId = uuidArgument(requirePositional(ctx, 1, 'version id'), 'Version id');
  const response = await ctx.api().get<VersionResponse>(
    '/documents/' + encodeURIComponent(id) + '/versions/' + encodeURIComponent(versionId)
  );
  const version = requireVersion(response);
  if (ctx.out.json) {
    ctx.out.envelope('versions show', { documentId: id, version });
    return;
  }
  ctx.out.table(
    [{ header: 'field' }, { header: 'value' }],
    [
      ['id', version.id],
      ['version', String(version.version)],
      ['title', version.title],
      ['author', version.createdByName ?? version.createdBy],
      ['created', formatTimestamp(version.createdAt)]
    ]
  );
  ctx.out.line('');
  ctx.out.value(version.content);
}

async function restore(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const versionId = uuidArgument(requirePositional(ctx, 1, 'version id'), 'Version id');
  const expectedVersion = ctx.flags.integer('expected-version', { min: 1 });
  if (expectedVersion === undefined) {
    throw usageError('versions restore requires --expected-version N, the version reported by "mdocs read".');
  }
  const response = await ctx.api().post<DocumentResponse>(
    '/documents/' + encodeURIComponent(id) + '/versions/' + encodeURIComponent(versionId) + '/restore',
    { expectedVersion }
  );
  if (!response.document) throw new CliError('The server did not return the restored document.', EXIT.NETWORK);
  emitDocument(ctx, 'versions restore', response.document, 'Restored version ' + versionId + ' as');
}

export const versionsListCommand: CommandDefinition = {
  name: 'versions list',
  category: 'Versions',
  summary: 'List the version history of a document',
  usage: 'versions list ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs versions list DOCUMENT_ID'],
  handler: list
};

export const versionsShowCommand: CommandDefinition = {
  name: 'versions show',
  category: 'Versions',
  summary: 'Show one stored version and its content',
  usage: 'versions show ID VERSION_ID',
  flags: [],
  positionals: [
    { name: 'ID', description: 'Document UUID.' },
    { name: 'VERSION_ID', description: 'Version UUID.' }
  ],
  examples: ['mdocs versions show DOCUMENT_ID VERSION_ID --json'],
  handler: show
};

export const versionsRestoreCommand: CommandDefinition = {
  name: 'versions restore',
  category: 'Versions',
  summary: 'Restore a stored version as the current document',
  usage: 'versions restore ID VERSION_ID --expected-version N',
  details: 'Restoring is an optimistic-concurrency write: a stale --expected-version returns 409 and exit code 5.',
  flags: [{ name: 'expected-version', description: 'Current document version.', valueName: 'N' }],
  positionals: [
    { name: 'ID', description: 'Document UUID.' },
    { name: 'VERSION_ID', description: 'Version UUID.' }
  ],
  examples: ['mdocs versions restore DOCUMENT_ID VERSION_ID --expected-version 7'],
  handler: restore
};
