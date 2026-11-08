import { extname } from 'node:path';
import type { CommandContext, CommandDefinition } from '../command.js';
import { CliError, EXIT, notFoundError, usageError } from '../errors.js';
import type { Cell, Column } from '../output.js';
import type { DocJson, Document, ExportPayload, SearchResult, Template } from '../types.js';
import {
  blankDocument,
  emitDocument,
  emitOk,
  fileStem,
  formatTimestamp,
  kindColor,
  parseDocJson,
  printDocuments,
  readInput,
  requirePositional,
  truncate,
  uuidArgument
} from './support.js';

type DocumentResponse = { document?: Document };
type DocumentListResponse = { documents?: Document[] };

function requireDocument(response: DocumentResponse, action: string): Document {
  if (!response.document) {
    throw new CliError('The server did not return a document for ' + action + '.', EXIT.NETWORK);
  }
  return response.document;
}

function parentOption(ctx: CommandContext): string | null {
  const parent = ctx.flags.str('parent') ?? ctx.flags.str('folder');
  if (parent === undefined) return null;
  return uuidArgument(parent, '--parent/--folder');
}

async function list(ctx: CommandContext): Promise<void> {
  ctx.flags.exclusive(['trash', 'favorites', 'recent'], 'Use only one of --trash, --favorites, and --recent.');
  const folder = ctx.flags.str('folder');
  if (folder !== undefined) uuidArgument(folder, '--folder');
  let path = '/documents';
  if (ctx.flags.bool('trash')) path = '/documents/trash';
  else if (ctx.flags.bool('favorites')) path = '/documents/favorites';
  else if (ctx.flags.bool('recent')) path = '/documents/recent';
  const response = await ctx.api().get<DocumentListResponse>(path);
  let documents = response.documents ?? [];
  if (folder !== undefined) documents = documents.filter(document => document.parentId === folder);
  if (ctx.out.json) {
    ctx.out.envelope('list', { documents });
    return;
  }
  printDocuments(ctx, documents);
}

function renderTree(ctx: CommandContext, documents: Document[]): void {
  const known = new Set(documents.map(document => document.id));
  const children = new Map<string, Document[]>();
  for (const document of documents) {
    const key = document.parentId !== null && known.has(document.parentId) ? document.parentId : '';
    const bucket = children.get(key);
    if (bucket) bucket.push(document);
    else children.set(key, [document]);
  }
  for (const bucket of children.values()) bucket.sort((left, right) => left.title.localeCompare(right.title));
  const roots = children.get('') ?? [];
  if (roots.length === 0) {
    ctx.out.info('No documents found.');
    return;
  }
  const walk = (parent: string, depth: number): void => {
    for (const document of children.get(parent) ?? []) {
      const indent = '  '.repeat(depth);
      const label = document.kind === 'folder' ? document.title + '/' : document.title;
      ctx.out.line(indent + ctx.out.paint(label, kindColor(document.kind)) + '  ' + ctx.out.paint(document.id, 'dim'));
      walk(document.id, depth + 1);
    }
  };
  walk('', 0);
}

async function tree(ctx: CommandContext): Promise<void> {
  const response = await ctx.api().get<DocumentListResponse>('/documents');
  const documents = response.documents ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('tree', { documents });
    return;
  }
  renderTree(ctx, documents);
}

const SEARCH_COLUMNS: Column[] = [
  { header: 'id' },
  { header: 'title' },
  { header: 'kind' },
  { header: 'updated' },
  { header: 'snippet' }
];

const SEARCH_SCOPES = ['all', 'title', 'content'] as const;

async function search(ctx: CommandContext): Promise<void> {
  const query = requirePositional(ctx, 0, 'search query');
  const scope = ctx.flags.choice('scope', SEARCH_SCOPES) ?? 'all';
  const limit = ctx.flags.integer('limit', { min: 1, max: 100 });
  const response = await ctx.api().get<{ results?: SearchResult[] }>('/documents/search', {
    query: { q: query, scope, limit }
  });
  const results = response.results ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('search', { query, scope, results });
    return;
  }
  const rows: Cell[][] = results.map(result => [
    result.id,
    result.title,
    { text: result.kind, color: kindColor(result.kind) },
    formatTimestamp(result.updatedAt),
    truncate(typeof result.snippet === 'string' ? result.snippet : '', 72)
  ]);
  ctx.out.table(SEARCH_COLUMNS, rows);
}

async function create(ctx: CommandContext): Promise<void> {
  const title = ctx.flags.required('title');
  const parentId = parentOption(ctx);
  const templateId = ctx.flags.str('template');
  const input = ctx.flags.str('input');
  const markdown = ctx.flags.str('markdown');
  if (input !== undefined && markdown !== undefined) throw usageError('Use only one of --input and --markdown.');
  if (templateId !== undefined && (input !== undefined || markdown !== undefined)) {
    throw usageError('--template cannot be combined with --input or --markdown.');
  }
  const api = ctx.api();
  let document: Document;
  if (markdown !== undefined) {
    const body = await readInput(markdown, ctx.readStdin);
    const response = await api.post<DocumentResponse>('/documents/import', {
      format: 'markdown',
      title,
      parentId,
      markdown: body
    });
    document = requireDocument(response, 'create');
  } else {
    let content: DocJson = blankDocument();
    if (input !== undefined) {
      content = parseDocJson(await readInput(input, ctx.readStdin));
    } else if (templateId !== undefined) {
      const templates = await api.get<{ templates?: Template[] }>('/templates');
      const available = templates.templates ?? [];
      const template = available.find(candidate => candidate.id === templateId);
      if (!template) {
        const ids = available.map(candidate => candidate.id).join(', ');
        throw notFoundError('Template "' + templateId + '" was not found.' + (ids === '' ? '' : ' Available templates: ' + ids + '.'));
      }
      content = template.content;
    }
    const response = await api.post<DocumentResponse>('/documents', {
      title,
      kind: 'document',
      parentId,
      content
    });
    document = requireDocument(response, 'create');
  }
  emitDocument(ctx, 'create', document, 'Created');
}

async function makeFolder(ctx: CommandContext): Promise<void> {
  const title = requirePositional(ctx, 0, 'folder title');
  const parentId = parentOption(ctx);
  const response = await ctx.api().post<DocumentResponse>('/documents', {
    title,
    kind: 'folder',
    parentId
  });
  const folder = requireDocument(response, 'mkdir');
  emitDocument(ctx, 'mkdir', folder, 'Created folder');
}

async function read(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  const response = await ctx.api().get<DocumentResponse>('/documents/' + encodeURIComponent(id));
  const document = requireDocument(response, 'read');
  await ctx.out.write(JSON.stringify(document, null, 2) + '\n', ctx.flags.str('output'));
}

const EXPORT_FORMATS = ['json', 'markdown', 'html'] as const;

async function exportDocument(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  const format = ctx.flags.choice('format', EXPORT_FORMATS) ?? 'json';
  const output = ctx.flags.str('output');
  const api = ctx.api();
  if (format === 'json') {
    const response = await api.get<DocumentResponse>('/documents/' + encodeURIComponent(id));
    const document = requireDocument(response, 'export');
    await ctx.out.write(JSON.stringify(document.content, null, 2) + '\n', output);
    return;
  }
  const payload = await api.get<ExportPayload>('/documents/' + encodeURIComponent(id) + '/export', {
    query: { format }
  });
  const text = typeof payload.content === 'string' ? payload.content : String(payload.content ?? '');
  await ctx.out.write(text.endsWith('\n') ? text : text + '\n', output);
}

function looksLikeDocJson(text: string): boolean {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.schemaVersion === 1 && typeof record.doc === 'object';
  } catch {
    return false;
  }
}

async function importFile(ctx: CommandContext): Promise<void> {
  const file = requirePositional(ctx, 0, 'input file');
  const parentId = parentOption(ctx);
  const title = ctx.flags.str('title');
  const body = await readInput(file, ctx.readStdin);
  let format: 'json' | 'markdown';
  if (file === '-') {
    format = looksLikeDocJson(body) ? 'json' : 'markdown';
  } else {
    const extension = extname(file).toLowerCase();
    if (extension === '.json') format = 'json';
    else if (extension === '.md' || extension === '.markdown') format = 'markdown';
    else format = looksLikeDocJson(body) ? 'json' : 'markdown';
  }
  const api = ctx.api();
  let document: Document;
  if (format === 'json') {
    const content = parseDocJson(body, 'Imported JSON');
    const response = await api.post<DocumentResponse>('/documents', {
      title: title ?? (file === '-' ? 'Imported document' : fileStem(file)),
      kind: 'document',
      parentId,
      content
    });
    document = requireDocument(response, 'import');
  } else {
    const payload: Record<string, unknown> = { format: 'markdown', parentId, markdown: body };
    if (title !== undefined) payload.title = title;
    const response = await api.post<DocumentResponse>('/documents/import', payload);
    document = requireDocument(response, 'import');
  }
  emitDocument(ctx, 'import', document, 'Imported');
}

async function update(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  const expectedVersion = ctx.flags.integer('expected-version', { min: 1 });
  if (expectedVersion === undefined) {
    throw usageError('update requires --expected-version N, the version reported by "mdocs read" or "mdocs list".');
  }
  const body: Record<string, unknown> = { expectedVersion };
  const title = ctx.flags.str('title');
  if (title !== undefined) body.title = title;
  const parent = ctx.flags.str('parent');
  if (parent !== undefined) body.parentId = uuidArgument(parent, '--parent');
  const input = ctx.flags.str('input');
  if (input !== undefined) body.content = parseDocJson(await readInput(input, ctx.readStdin));
  if (title === undefined && parent === undefined && input === undefined) {
    throw usageError('update requires at least one of --title, --parent, or --input.');
  }
  const response = await ctx.api().put<DocumentResponse>('/documents/' + encodeURIComponent(id), body);
  emitDocument(ctx, 'update', requireDocument(response, 'update'), 'Updated');
}

async function duplicate(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  const body: Record<string, unknown> = {};
  const title = ctx.flags.str('title');
  if (title !== undefined) body.title = title;
  const parent = ctx.flags.str('parent');
  if (parent !== undefined) body.parentId = uuidArgument(parent, '--parent');
  const response = await ctx.api().post<DocumentResponse>('/documents/' + encodeURIComponent(id) + '/duplicate', body);
  emitDocument(ctx, 'duplicate', requireDocument(response, 'duplicate'), 'Duplicated');
}

async function trash(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  await ctx.api().delete<unknown>('/documents/' + encodeURIComponent(id));
  emitOk(ctx, 'trash', { id, trashed: true }, 'Moved "' + id + '" to the trash. Restore it with "mdocs restore ' + id + '".');
}

async function restore(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  await ctx.api().post<unknown>('/documents/' + encodeURIComponent(id) + '/restore');
  emitOk(ctx, 'restore', { id, restored: true }, 'Restored "' + id + '".');
}

async function purge(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  if (!ctx.flags.bool('yes')) {
    throw usageError('purge permanently deletes "' + id + '" and cannot be undone. Re-run with --yes to confirm.');
  }
  await ctx.api().delete<unknown>('/documents/' + encodeURIComponent(id) + '/permanent');
  emitOk(ctx, 'purge', { id, purged: true }, 'Permanently deleted "' + id + '".');
}

async function favorite(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  ctx.flags.requireOne(['on', 'off'], 'favorite requires exactly one of --on or --off.');
  const value = ctx.flags.bool('on');
  await ctx.api().put<{ favorite?: boolean }>('/documents/' + encodeURIComponent(id) + '/favorite', { favorite: value });
  emitOk(ctx, 'favorite', { id, favorite: value }, (value ? 'Added "' : 'Removed "') + id + '" ' + (value ? 'to' : 'from') + ' favorites.');
}

export const listCommand: CommandDefinition = {
  name: 'list',
  category: 'Documents',
  summary: 'List documents and folders in a table',
  usage: 'list [--folder ID] [--trash] [--favorites] [--recent] [--json]',
  details: 'Without flags every visible document and folder is listed newest first.\n--folder filters the result to the direct children of a folder id.',
  flags: [
    { name: 'folder', description: 'Only list direct children of this folder.', valueName: 'ID' },
    { name: 'trash', kind: 'boolean', description: 'List trashed documents.' },
    { name: 'favorites', kind: 'boolean', description: 'List favourited documents.' },
    { name: 'recent', kind: 'boolean', description: 'List the 50 documents opened most recently.' }
  ],
  positionals: [],
  examples: ['mdocs list', 'mdocs list --trash', 'mdocs list --folder FOLDER_ID --json'],
  handler: list
};

export const treeCommand: CommandDefinition = {
  name: 'tree',
  category: 'Documents',
  summary: 'Print the document hierarchy as an indented tree',
  usage: 'tree',
  flags: [],
  positionals: [],
  examples: ['mdocs tree'],
  handler: tree
};

export const searchCommand: CommandDefinition = {
  name: 'search',
  category: 'Documents',
  summary: 'Search document titles and content',
  usage: 'search QUERY [--scope all|title|content] [--limit N]',
  flags: [
    { name: 'scope', description: 'Where to look: all, title, or content.', valueName: 'SCOPE' },
    { name: 'limit', description: 'Maximum number of results (1-100).', valueName: 'N' }
  ],
  positionals: [{ name: 'QUERY', description: 'Case-insensitive search text.' }],
  examples: ['mdocs search "quarterly plan"', 'mdocs search roadmap --scope title --json'],
  handler: search
};

export const createCommand: CommandDefinition = {
  name: 'create',
  category: 'Documents',
  summary: 'Create a document, optionally from a template or a file',
  usage: 'create --title TITLE [--folder ID|--parent ID] [--template ID] [--input FILE|-] [--markdown FILE|-]',
  details: 'Without --input, --markdown, or --template the document starts blank.\n--template resolves the template through GET /templates and creates the document with its content.',
  flags: [
    { name: 'title', description: 'Document title.', valueName: 'TITLE' },
    { name: 'folder', description: 'Parent folder id (alias of --parent).', valueName: 'ID' },
    { name: 'parent', description: 'Parent folder id.', valueName: 'ID' },
    { name: 'template', description: 'Template id, for example meeting-notes.', valueName: 'ID' },
    { name: 'input', description: 'Tiptap JSON content file, or - for stdin.', valueName: 'FILE' },
    { name: 'markdown', description: 'Markdown file converted by POST /documents/import, or - for stdin.', valueName: 'FILE' }
  ],
  positionals: [],
  examples: [
    'mdocs create --title "Project notes"',
    'mdocs create --title "Weekly report" --template weekly-report',
    'mdocs create --title "Notes" --markdown notes.md',
    'mdocs create --title "Notes" --input document.json --parent FOLDER_ID'
  ],
  handler: create
};

export const mkdirCommand: CommandDefinition = {
  name: 'mkdir',
  category: 'Documents',
  summary: 'Create a folder, optionally inside another folder',
  usage: 'mkdir TITLE [--parent ID|--folder ID]',
  details: 'Folders are first-class tree nodes. Only folders can be a document parent.',
  flags: [
    { name: 'parent', description: 'Parent folder id.', valueName: 'ID' },
    { name: 'folder', description: 'Parent folder id (alias of --parent).', valueName: 'ID' }
  ],
  positionals: [{ name: 'TITLE', description: 'Folder title.' }],
  examples: ['mdocs mkdir "Projects"', 'mdocs mkdir "2026" --parent FOLDER_ID'],
  handler: makeFolder
};

export const readCommand: CommandDefinition = {
  name: 'read',
  category: 'Documents',
  summary: 'Print a document as JSON',
  usage: 'read ID [--output FILE|-]',
  details: 'Prints the full Document object, including its versioned content. Use --output to write it to a file.',
  flags: [{ name: 'output', description: 'Write to FILE instead of stdout; - means stdout.', valueName: 'FILE' }],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs read DOCUMENT_ID', 'mdocs read DOCUMENT_ID --output document.json'],
  handler: read
};

export const exportCommand: CommandDefinition = {
  name: 'export',
  category: 'Documents',
  summary: 'Export a document as JSON, Markdown, or HTML',
  usage: 'export ID [--format json|markdown|html] [--output FILE|-]',
  details: 'The default json format prints the DocJson object ({"schemaVersion":1,"doc":...}) exactly like earlier releases.\nmarkdown and html come from GET /documents/:id/export.',
  flags: [
    { name: 'format', description: 'Output format: json, markdown, or html.', valueName: 'FORMAT' },
    { name: 'output', description: 'Write to FILE instead of stdout; - means stdout.', valueName: 'FILE' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: [
    'mdocs export DOCUMENT_ID',
    'mdocs export DOCUMENT_ID --format markdown --output notes.md',
    'mdocs export DOCUMENT_ID --format html --output notes.html'
  ],
  handler: exportDocument
};

export const importCommand: CommandDefinition = {
  name: 'import',
  category: 'Documents',
  summary: 'Import a Markdown or Tiptap JSON file as a new document',
  usage: 'import FILE [--title TITLE] [--parent ID]',
  details: 'FILE ending in .json is treated as Tiptap JSON; .md and .markdown are converted by POST /documents/import.\nUse - to read from stdin, where the content is sniffed.',
  flags: [
    { name: 'title', description: 'Override the inferred document title.', valueName: 'TITLE' },
    { name: 'parent', description: 'Parent folder id.', valueName: 'ID' }
  ],
  positionals: [{ name: 'FILE', description: 'Markdown or JSON file, or - for stdin.' }],
  examples: ['mdocs import notes.md', 'mdocs import document.json --title "Imported"', 'cat notes.md | mdocs import -'],
  handler: importFile
};

export const updateCommand: CommandDefinition = {
  name: 'update',
  category: 'Documents',
  summary: 'Update a document title, parent, or content',
  usage: 'update ID --expected-version N [--title TITLE] [--parent ID] [--input FILE|-]',
  details: 'expectedVersion enables optimistic concurrency. The server returns 409 VERSION_CONFLICT\n(exit code 5) when the document moved on, so read the latest version before retrying.',
  flags: [
    { name: 'expected-version', description: 'Version the change is based on.', valueName: 'N' },
    { name: 'title', description: 'New title.', valueName: 'TITLE' },
    { name: 'parent', description: 'New parent folder id.', valueName: 'ID' },
    { name: 'input', description: 'Tiptap JSON content file, or - for stdin.', valueName: 'FILE' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: [
    'mdocs update DOCUMENT_ID --expected-version 3 --title "Renamed"',
    'mdocs read DOCUMENT_ID --output doc.json && mdocs update DOCUMENT_ID --expected-version 3 --input doc.json'
  ],
  handler: update
};

export const duplicateCommand: CommandDefinition = {
  name: 'duplicate',
  category: 'Documents',
  summary: 'Copy a document',
  usage: 'duplicate ID [--title TITLE] [--parent ID]',
  flags: [
    { name: 'title', description: 'Title for the copy; defaults to "<title> (copy)".', valueName: 'TITLE' },
    { name: 'parent', description: 'Parent folder id for the copy.', valueName: 'ID' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs duplicate DOCUMENT_ID', 'mdocs duplicate DOCUMENT_ID --title "Draft copy"'],
  handler: duplicate
};

export const trashCommand: CommandDefinition = {
  name: 'trash',
  category: 'Documents',
  summary: 'Move a document to the trash',
  usage: 'trash ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs trash DOCUMENT_ID'],
  handler: trash
};

export const deleteCommand: CommandDefinition = {
  name: 'delete',
  category: 'Documents',
  summary: 'Move a document to the trash (alias of trash)',
  usage: 'delete ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs delete DOCUMENT_ID'],
  handler: trash
};

export const restoreCommand: CommandDefinition = {
  name: 'restore',
  category: 'Documents',
  summary: 'Restore a document from the trash',
  usage: 'restore ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs restore DOCUMENT_ID'],
  handler: restore
};

export const purgeCommand: CommandDefinition = {
  name: 'purge',
  category: 'Documents',
  summary: 'Permanently delete a trashed document',
  usage: 'purge ID --yes',
  details: 'Purge is irreversible, so it refuses to run without --yes.',
  flags: [{ name: 'yes', kind: 'boolean', description: 'Confirm the permanent deletion.' }],
  positionals: [{ name: 'ID', description: 'Trashed document UUID.' }],
  examples: ['mdocs purge DOCUMENT_ID --yes'],
  handler: purge
};

export const favoriteCommand: CommandDefinition = {
  name: 'favorite',
  category: 'Documents',
  summary: 'Add or remove a document from favorites',
  usage: 'favorite ID --on|--off',
  flags: [
    { name: 'on', kind: 'boolean', description: 'Mark as favorite.' },
    { name: 'off', kind: 'boolean', description: 'Remove from favorites.' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs favorite DOCUMENT_ID --on', 'mdocs favorite DOCUMENT_ID --off'],
  handler: favorite
};
