import type { CommandDefinition } from '../command.js';
import { doctorCommand, loginCommand, logoutCommand, whoamiCommand } from './auth.js';
import {
  commentsAddCommand,
  commentsListCommand,
  commentsReopenCommand,
  commentsResolveCommand
} from './comments.js';
import {
  createCommand,
  deleteCommand,
  duplicateCommand,
  exportCommand,
  favoriteCommand,
  importCommand,
  listCommand,
  mkdirCommand,
  purgeCommand,
  readCommand,
  restoreCommand,
  searchCommand,
  trashCommand,
  treeCommand,
  updateCommand
} from './documents.js';
import { createCompletionCommand } from './misc.js';
import {
  shareGrantCommand,
  shareListCommand,
  shareRestrictCommand,
  shareRevokeCommand
} from './share.js';
import {
  versionsListCommand,
  versionsRestoreCommand,
  versionsShowCommand
} from './versions.js';
import {
  activityCommand,
  inviteCommand,
  membersCommand,
  statsCommand,
  templatesCommand,
  uploadCommand
} from './workspace.js';

const BASE_COMMANDS: CommandDefinition[] = [
  loginCommand,
  logoutCommand,
  whoamiCommand,
  doctorCommand,
  listCommand,
  treeCommand,
  searchCommand,
  createCommand,
  mkdirCommand,
  readCommand,
  exportCommand,
  importCommand,
  updateCommand,
  duplicateCommand,
  deleteCommand,
  trashCommand,
  restoreCommand,
  purgeCommand,
  favoriteCommand,
  commentsListCommand,
  commentsAddCommand,
  commentsResolveCommand,
  commentsReopenCommand,
  versionsListCommand,
  versionsShowCommand,
  versionsRestoreCommand,
  shareListCommand,
  shareGrantCommand,
  shareRevokeCommand,
  shareRestrictCommand,
  membersCommand,
  inviteCommand,
  templatesCommand,
  statsCommand,
  activityCommand,
  uploadCommand
];

const completionCommand = createCompletionCommand(BASE_COMMANDS);

/** Every command, including the generated completion command. */
export const COMMANDS: CommandDefinition[] = [...BASE_COMMANDS, completionCommand];

export type ResolvedCommand = {
  command: CommandDefinition;
  rest: string[];
};

/**
 * Resolves the longest command path ("comments add" beats "comments"), so
 * subcommands stay explicit and dispatch stays a single table lookup.
 */
export function resolveCommand(tokens: string[]): ResolvedCommand | undefined {
  for (const length of [2, 1]) {
    if (tokens.length < length) continue;
    const name = tokens.slice(0, length).join(' ');
    const command = COMMANDS.find(candidate => candidate.name === name);
    if (command) return { command, rest: tokens.slice(length) };
  }
  return undefined;
}

/** Helpful hint when a command group is used without its subcommand. */
export function subcommandHint(first: string): string {
  const subs = COMMANDS
    .filter(command => command.name.startsWith(first + ' '))
    .map(command => command.name.split(' ')[1] as string);
  if (subs.length === 0) return '';
  return 'Did you mean "mdocs ' + first + ' <' + subs.join('|') + '>"?';
}
