import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { CommandContext, CommandDefinition } from '../command.js';
import { CliError, EXIT, messageOf, usageError } from '../errors.js';
import type { ActivityEntry, Invite, Template, UploadFile, User } from '../types.js';
import {
  contentTypeFor,
  formatTimestamp,
  requirePositional,
  truncate,
  uuidArgument
} from './support.js';

async function members(ctx: CommandContext): Promise<void> {
  const response = await ctx.api().get<{ members?: User[] }>('/workspace/members');
  const list = response.members ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('members', { members: list });
    return;
  }
  ctx.out.table(
    [{ header: 'id' }, { header: 'email' }, { header: 'name' }, { header: 'role' }],
    list.map(member => [member.id, member.email, member.name, member.role])
  );
}

const INVITE_ROLES = ['member', 'admin'] as const;

async function invite(ctx: CommandContext): Promise<void> {
  const email = requirePositional(ctx, 0, 'invite email');
  const role = ctx.flags.choice('role', INVITE_ROLES) ?? 'member';
  const response = await ctx.api().post<{ invite?: Invite }>('/invites', { email, role });
  const created = response.invite;
  if (!created) throw new CliError('The server did not return an invite.', EXIT.NETWORK);
  if (ctx.out.json) {
    ctx.out.envelope('invite', { invite: created });
    return;
  }
  ctx.out.line('Invite for ' + created.email + ' created (role: ' + created.role + ').');
  ctx.out.line('Token: ' + created.token);
  ctx.out.line('Expires: ' + formatTimestamp(created.expiresAt));
  ctx.out.info('Delivery is up to the operator: share the token, the invitee runs "mdocs login" and accepts it in the web UI.');
}

async function templates(ctx: CommandContext): Promise<void> {
  const response = await ctx.api().get<{ templates?: Template[] }>('/templates');
  const list = response.templates ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('templates', { templates: list });
    return;
  }
  ctx.out.table(
    [{ header: 'id' }, { header: 'name' }, { header: 'description' }],
    list.map(template => [template.id, template.name, truncate(template.description ?? '', 72)])
  );
}

async function stats(ctx: CommandContext): Promise<void> {
  const response = await ctx.api().get<{ stats?: Record<string, number> }>('/workspace/stats');
  const values = response.stats ?? {};
  if (ctx.out.json) {
    ctx.out.envelope('stats', { stats: values });
    return;
  }
  ctx.out.table(
    [{ header: 'metric' }, { header: 'value', align: 'right' }],
    Object.entries(values).map(([name, value]) => [name, String(value)])
  );
}

async function activity(ctx: CommandContext): Promise<void> {
  const id = uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
  const limit = ctx.flags.integer('limit', { min: 1, max: 100 });
  const response = await ctx.api().get<{ activity?: ActivityEntry[] }>('/documents/' + encodeURIComponent(id) + '/activity', {
    query: { limit }
  });
  const entries = response.activity ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('activity', { documentId: id, activity: entries });
    return;
  }
  ctx.out.table(
    [{ header: 'time' }, { header: 'user' }, { header: 'action' }],
    entries.map(entry => [formatTimestamp(entry.createdAt), entry.userName || entry.userId, entry.action])
  );
}

async function upload(ctx: CommandContext): Promise<void> {
  const file = requirePositional(ctx, 0, 'file to upload');
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch (error) {
    throw usageError('Cannot read ' + file + ': ' + messageOf(error));
  }
  if (data.length === 0) throw usageError('Cannot upload ' + file + ': the file is empty.');
  const api = ctx.api();
  const response = await api.upload({ name: basename(file), data, contentType: contentTypeFor(file) }) as { file?: UploadFile };
  const uploaded = response.file;
  if (!uploaded) throw new CliError('The server did not return the uploaded file.', EXIT.NETWORK);
  const url = new URL(uploaded.url, api.origin).toString();
  if (ctx.out.json) {
    ctx.out.envelope('upload', { file: uploaded, url });
    return;
  }
  ctx.out.info('Uploaded ' + uploaded.name + ' (' + uploaded.size + ' bytes, ' + uploaded.mimeType + ').');
  ctx.out.line(url);
}

export const membersCommand: CommandDefinition = {
  name: 'members',
  category: 'Workspace',
  summary: 'List the members of the workspace',
  usage: 'members',
  flags: [],
  positionals: [],
  examples: ['mdocs members', 'mdocs members --json'],
  handler: members
};

export const inviteCommand: CommandDefinition = {
  name: 'invite',
  category: 'Workspace',
  summary: 'Create a one-time workspace invite (administrators only)',
  usage: 'invite EMAIL [--role member|admin]',
  details: 'The API returns the one-time invite token; delivery is up to the operator. Tokens expire after seven days.',
  flags: [{ name: 'role', description: 'Workspace role for the invitee: member or admin.', valueName: 'ROLE' }],
  positionals: [{ name: 'EMAIL', description: 'Email address to invite.' }],
  examples: ['mdocs invite new@example.com', 'mdocs invite new@example.com --role admin'],
  handler: invite
};

export const templatesCommand: CommandDefinition = {
  name: 'templates',
  category: 'Workspace',
  summary: 'List the built-in document templates',
  usage: 'templates',
  flags: [],
  positionals: [],
  examples: ['mdocs templates'],
  handler: templates
};

export const statsCommand: CommandDefinition = {
  name: 'stats',
  category: 'Workspace',
  summary: 'Show workspace counters',
  usage: 'stats',
  flags: [],
  positionals: [],
  examples: ['mdocs stats', 'mdocs stats --json'],
  handler: stats
};

export const activityCommand: CommandDefinition = {
  name: 'activity',
  category: 'Workspace',
  summary: 'Show the activity log of a document',
  usage: 'activity ID [--limit N]',
  details: 'Actions are view, edit, and restore, newest first.',
  flags: [{ name: 'limit', description: 'Maximum number of entries (1-100).', valueName: 'N' }],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs activity DOCUMENT_ID', 'mdocs activity DOCUMENT_ID --limit 50'],
  handler: activity
};

export const uploadCommand: CommandDefinition = {
  name: 'upload',
  category: 'Workspace',
  summary: 'Upload a file and print its URL',
  usage: 'upload FILE',
  details: 'Sends the raw file body to PUT /uploads with the content type derived from the extension\n(PNG, JPEG, GIF, WebP, PDF; anything else falls back to application/octet-stream). Files are limited to 20 MB.',
  flags: [],
  positionals: [{ name: 'FILE', description: 'Path of the file to upload.' }],
  examples: ['mdocs upload diagram.png', 'URL=$(mdocs upload report.pdf)'],
  handler: upload
};
