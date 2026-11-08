import type { CommandContext, CommandDefinition } from '../command.js';
import { CliError, EXIT } from '../errors.js';
import type { Cell, Column } from '../output.js';
import type { Comment } from '../types.js';
import {
  emitOk,
  formatTimestamp,
  requirePositional,
  truncate,
  uuidArgument
} from './support.js';

type CommentResponse = { comment?: Comment };

function requireComment(response: CommentResponse): Comment {
  if (!response.comment) throw new CliError('The server did not return a comment.', EXIT.NETWORK);
  return response.comment;
}

function documentId(ctx: CommandContext): string {
  return uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
}

const COMMENT_COLUMNS: Column[] = [
  { header: 'id' },
  { header: 'status' },
  { header: 'author' },
  { header: 'created' },
  { header: 'body' }
];

function commentRow(ctx: CommandContext, comment: Comment): Cell[] {
  return [
    comment.id,
    { text: comment.status, color: comment.status === 'resolved' ? 'dim' : 'yellow' },
    comment.userName || comment.userId,
    formatTimestamp(comment.createdAt),
    truncate(comment.body ?? '', 64)
  ];
}

async function list(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const response = await ctx.api().get<{ comments?: Comment[] }>('/documents/' + encodeURIComponent(id) + '/comments');
  const comments = response.comments ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('comments list', { documentId: id, comments });
    return;
  }
  ctx.out.table(COMMENT_COLUMNS, comments.map(comment => commentRow(ctx, comment)));
}

async function add(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const body = ctx.flags.required('body');
  const parentId = ctx.flags.str('parent');
  const payload: Record<string, unknown> = { body };
  if (parentId !== undefined) payload.parentId = uuidArgument(parentId, '--parent');
  const response = await ctx.api().post<CommentResponse>('/documents/' + encodeURIComponent(id) + '/comments', payload);
  const comment = requireComment(response);
  if (ctx.out.json) {
    ctx.out.envelope('comments add', { documentId: id, comment });
    return;
  }
  ctx.out.success('Added comment ' + comment.id + '.');
}

async function setStatus(ctx: CommandContext, status: 'open' | 'resolved', command: string, verb: string): Promise<void> {
  const id = documentId(ctx);
  const commentId = uuidArgument(requirePositional(ctx, 1, 'comment id'), 'Comment id');
  const response = await ctx.api().patch<CommentResponse>(
    '/documents/' + encodeURIComponent(id) + '/comments/' + encodeURIComponent(commentId),
    { status }
  );
  const comment = requireComment(response);
  emitOk(ctx, command, { documentId: id, comment }, verb + ' comment ' + commentId + '.');
}

export const commentsListCommand: CommandDefinition = {
  name: 'comments list',
  category: 'Comments',
  summary: 'List the comments of a document',
  usage: 'comments list ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs comments list DOCUMENT_ID', 'mdocs comments list DOCUMENT_ID --json'],
  handler: list
};

export const commentsAddCommand: CommandDefinition = {
  name: 'comments add',
  category: 'Comments',
  summary: 'Add a comment to a document',
  usage: 'comments add ID --body TEXT [--parent COMMENT_ID]',
  details: 'Reply to an existing thread with --parent COMMENTS come back as open and can be resolved later.',
  flags: [
    { name: 'body', description: 'Comment text.', valueName: 'TEXT' },
    { name: 'parent', description: 'Parent comment id for a reply.', valueName: 'COMMENT_ID' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs comments add DOCUMENT_ID --body "Can we split this section?"'],
  handler: add
};

export const commentsResolveCommand: CommandDefinition = {
  name: 'comments resolve',
  category: 'Comments',
  summary: 'Mark a comment thread as resolved',
  usage: 'comments resolve ID COMMENT_ID',
  flags: [],
  positionals: [
    { name: 'ID', description: 'Document UUID.' },
    { name: 'COMMENT_ID', description: 'Comment UUID.' }
  ],
  examples: ['mdocs comments resolve DOCUMENT_ID COMMENT_ID'],
  handler: (ctx: CommandContext) => setStatus(ctx, 'resolved', 'comments resolve', 'Resolved')
};

export const commentsReopenCommand: CommandDefinition = {
  name: 'comments reopen',
  category: 'Comments',
  summary: 'Reopen a resolved comment thread',
  usage: 'comments reopen ID COMMENT_ID',
  flags: [],
  positionals: [
    { name: 'ID', description: 'Document UUID.' },
    { name: 'COMMENT_ID', description: 'Comment UUID.' }
  ],
  examples: ['mdocs comments reopen DOCUMENT_ID COMMENT_ID'],
  handler: (ctx: CommandContext) => setStatus(ctx, 'open', 'comments reopen', 'Reopened')
};
