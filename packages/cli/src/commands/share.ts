import type { CommandContext, CommandDefinition } from '../command.js';
import { usageError } from '../errors.js';
import type { AclResponse, User } from '../types.js';
import {
  emitOk,
  requirePositional,
  uuidArgument
} from './support.js';

const ROLES = ['viewer', 'editor', 'owner'] as const;

function documentId(ctx: CommandContext): string {
  return uuidArgument(requirePositional(ctx, 0, 'document id'), 'Document id');
}

async function list(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const response = await ctx.api().get<AclResponse>('/documents/' + encodeURIComponent(id) + '/acl');
  const permissions = response.permissions ?? [];
  if (ctx.out.json) {
    ctx.out.envelope('share list', { documentId: id, restricted: response.restricted === true, permissions });
    return;
  }
  ctx.out.line('Restricted: ' + (response.restricted ? 'yes' : 'no'));
  ctx.out.table(
    [{ header: 'user id' }, { header: 'email' }, { header: 'name' }, { header: 'role' }],
    permissions.map(permission => [permission.userId, permission.email, permission.name, permission.role])
  );
}

async function grant(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const userId = uuidArgument(ctx.flags.required('user'), '--user');
  const role = ctx.flags.choice('role', ROLES);
  if (role === undefined) throw usageError('share grant requires --role viewer|editor|owner.');
  await ctx.api().put<unknown>('/documents/' + encodeURIComponent(id) + '/acl', { userId, role });
  emitOk(ctx, 'share grant', { documentId: id, userId, role, granted: true }, 'Granted ' + role + ' access to ' + userId + '.');
}

async function revoke(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  const userId = uuidArgument(ctx.flags.required('user'), '--user');
  await ctx.api().put<unknown>('/documents/' + encodeURIComponent(id) + '/acl', { userId, role: null });
  emitOk(ctx, 'share revoke', { documentId: id, userId, revoked: true }, 'Removed the explicit permission for ' + userId + '.');
}

async function restrict(ctx: CommandContext): Promise<void> {
  const id = documentId(ctx);
  ctx.flags.requireOne(['on', 'off'], 'share restrict requires exactly one of --on or --off.');
  const restricted = ctx.flags.bool('on');
  const api = ctx.api();
  const me = await api.get<{ user: User | null }>('/me');
  if (!me.user) throw usageError('share restrict needs an authenticated user.');
  const acl = await api.get<AclResponse>('/documents/' + encodeURIComponent(id) + '/acl');
  const own = (acl.permissions ?? []).find(permission => permission.userId === me.user?.id);
  const role = own ? own.role : 'owner';
  await api.put<unknown>('/documents/' + encodeURIComponent(id) + '/acl', {
    userId: me.user.id,
    role,
    restricted
  });
  emitOk(
    ctx,
    'share restrict',
    { documentId: id, restricted },
    restricted ? 'Restricted the document to explicitly listed members.' : 'Removed the restriction; workspace members can edit again.'
  );
}

export const shareListCommand: CommandDefinition = {
  name: 'share list',
  category: 'Sharing',
  summary: 'List explicit permissions of a document',
  usage: 'share list ID',
  flags: [],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs share list DOCUMENT_ID', 'mdocs share list DOCUMENT_ID --json'],
  handler: list
};

export const shareGrantCommand: CommandDefinition = {
  name: 'share grant',
  category: 'Sharing',
  summary: 'Grant a workspace member access to a document',
  usage: 'share grant ID --user UUID --role viewer|editor|owner',
  details: 'Granting a role turns on the restricted flag; the document becomes visible only to listed members and workspace admins.',
  flags: [
    { name: 'user', description: 'Workspace member UUID (see "mdocs members").', valueName: 'UUID' },
    { name: 'role', description: 'viewer, editor, or owner.', valueName: 'ROLE' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs share grant DOCUMENT_ID --user USER_ID --role editor'],
  handler: grant
};

export const shareRevokeCommand: CommandDefinition = {
  name: 'share revoke',
  category: 'Sharing',
  summary: 'Remove an explicit permission from a document',
  usage: 'share revoke ID --user UUID',
  flags: [{ name: 'user', description: 'Workspace member UUID.', valueName: 'UUID' }],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs share revoke DOCUMENT_ID --user USER_ID'],
  handler: revoke
};

export const shareRestrictCommand: CommandDefinition = {
  name: 'share restrict',
  category: 'Sharing',
  summary: 'Turn the restricted flag of a document on or off',
  usage: 'share restrict ID --on|--off',
  details: 'The API toggles the flag through PUT /documents/:id/acl, so the CLI re-sends the caller owner role together with restricted.',
  flags: [
    { name: 'on', kind: 'boolean', description: 'Restrict the document to explicit permissions.' },
    { name: 'off', kind: 'boolean', description: 'Allow every workspace member to edit again.' }
  ],
  positionals: [{ name: 'ID', description: 'Document UUID.' }],
  examples: ['mdocs share restrict DOCUMENT_ID --on', 'mdocs share restrict DOCUMENT_ID --off'],
  handler: restrict
};
