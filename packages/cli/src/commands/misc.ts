import { completionScript, SHELLS, type Shell } from '../completion.js';
import type { CommandDefinition } from '../command.js';
import { usageError } from '../errors.js';
import { requirePositional } from './support.js';

export function createCompletionCommand(commands: CommandDefinition[]): CommandDefinition {
  return {
    name: 'completion',
    category: 'Completion',
    summary: 'Print a shell completion script',
    usage: 'completion bash|zsh|fish|powershell',
    details: 'Write the script to the location your shell loads:\n  bash        /etc/bash_completion.d/mdocs\n  zsh         ' + '$' + '{fpath[1]}/_mdocs\n  fish        ~/.config/fish/completions/mdocs.fish\n  powershell  Invoke-Expression (mdocs completion powershell | Out-String)',
    flags: [],
    positionals: [{ name: 'SHELL', description: 'bash, zsh, fish, or powershell.' }],
    examples: [
      'mdocs completion bash > /etc/bash_completion.d/mdocs',
      'mdocs completion zsh > ' + '$' + '{fpath[1]}/_mdocs',
      'mdocs completion fish > ~/.config/fish/completions/mdocs.fish',
      'mdocs completion powershell | Out-String | Invoke-Expression'
    ],
    handler: async ctx => {
      const shell = requirePositional(ctx, 0, 'shell name');
      if (!SHELLS.includes(shell as Shell)) {
        throw usageError('completion requires one of: ' + SHELLS.join(', ') + '. Received "' + shell + '".');
      }
      ctx.out.raw(completionScript(shell as Shell, commands));
    }
  };
}
