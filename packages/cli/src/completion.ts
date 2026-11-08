import { GLOBAL_FLAGS } from './args.js';
import type { CommandDefinition } from './command.js';

export const SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;

export type Shell = (typeof SHELLS)[number];

const D = '$';

function ref(value: string): string {
  return D + '{' + value + '}';
}

type CommandNode = {
  group: string;
  sub?: string;
  flags: string[];
  description: string;
};

function globalFlags(): string[] {
  return GLOBAL_FLAGS.map(flag => '--' + flag.name);
}

function nodes(commands: CommandDefinition[]): CommandNode[] {
  return commands.map(command => {
    const parts = command.name.split(' ');
    const flags = [...command.flags.map(flag => '--' + flag.name), ...globalFlags()];
    return {
      group: parts[0] as string,
      sub: parts[1],
      flags,
      description: command.summary.replace(/"/g, "'")
    };
  });
}

function topLevelWords(commands: CommandNode[]): string[] {
  const words: string[] = [];
  for (const command of commands) {
    if (!words.includes(command.group)) words.push(command.group);
  }
  words.push('help');
  return words;
}

function bashScript(commands: CommandNode[]): string {
  const words = topLevelWords(commands);
  const lines: string[] = [];
  lines.push('# bash completion for mdocs');
  lines.push('# Install: mdocs completion bash > /etc/bash_completion.d/mdocs');
  lines.push('_mdocs_complete() {');
  lines.push('  local cur key');
  lines.push('  COMPREPLY=()');
  lines.push('  cur="' + ref('COMP_WORDS[COMP_CWORD]') + '"');
  lines.push('  if [ "' + ref('COMP_CWORD') + '" -eq 1 ]; then');
  lines.push('    COMPREPLY=( $(' + 'compgen -W "' + words.join(' ') + '" -- "' + ref('cur') + '") )');
  lines.push('    return 0');
  lines.push('  fi');
  lines.push('  key="' + ref('COMP_WORDS[1]') + ':' + ref('COMP_WORDS[2]') + '"');
  lines.push('  case "' + ref('key') + '" in');
  for (const command of commands) {
    if (command.sub === undefined) continue;
    lines.push('    ' + command.group + ':' + command.sub + ') COMPREPLY=( $(' + 'compgen -W "' + command.flags.join(' ') + '" -- "' + ref('cur') + '") );;');
  }
  const groups: string[] = [];
  for (const command of commands) {
    if (command.sub === undefined) continue;
    if (!groups.includes(command.group)) groups.push(command.group);
  }
  for (const group of groups) {
    const subs = commands.filter(command => command.group === group && command.sub !== undefined).map(command => command.sub as string);
    lines.push('    ' + group + ':*) COMPREPLY=( $(' + 'compgen -W "' + subs.concat('--help').join(' ') + '" -- "' + ref('cur') + '") );;');
  }
  for (const command of commands) {
    if (command.sub !== undefined) continue;
    lines.push('    ' + command.group + ':*) COMPREPLY=( $(' + 'compgen -W "' + command.flags.join(' ') + '" -- "' + ref('cur') + '") );;');
  }
  lines.push('    *) COMPREPLY=( $(' + 'compgen -W "' + words.join(' ') + '" -- "' + ref('cur') + '") );;');
  lines.push('  esac');
  lines.push('  return 0');
  lines.push('}');
  lines.push('complete -F _mdocs_complete mdocs');
  lines.push('');
  return lines.join('\n');
}

function zshScript(commands: CommandNode[]): string {
  const words = topLevelWords(commands);
  const lines: string[] = [];
  lines.push('#compdef mdocs');
  lines.push('# zsh completion for mdocs');
  lines.push('# Install: mdocs completion zsh > ' + '"' + ref('fpath[1]') + '/_mdocs"');
  lines.push('_mdocs() {');
  lines.push('  local -a candidates');
  lines.push('  if (( CURRENT == 2 )); then');
  lines.push('    candidates=(' + words.join(' ') + ')');
  lines.push('    compadd -- ' + ref('candidates') + '');
  lines.push('    return');
  lines.push('  fi');
  const groups: string[] = [];
  for (const command of commands) {
    if (command.sub !== undefined && !groups.includes(command.group)) groups.push(command.group);
  }
  for (const group of groups) {
    const subs = commands.filter(command => command.group === group && command.sub !== undefined).map(command => command.sub as string);
    lines.push('  if [[ ' + ref('words[2]') + ' == ' + group + ' ]]; then');
    lines.push('    if (( CURRENT == 3 )); then');
    lines.push('      candidates=(' + subs.join(' ') + ')');
    lines.push('      compadd -- ' + ref('candidates'));
    lines.push('      return');
    lines.push('    fi');
    lines.push('    case ' + ref('words[3]') + ' in');
    for (const command of commands) {
      if (command.group !== group || command.sub === undefined) continue;
      lines.push('      ' + command.sub + ') candidates=(' + command.flags.join(' ') + ');;');
    }
    lines.push('      *) candidates=(' + subs.concat('--help').join(' ') + ');;');
    lines.push('    esac');
    lines.push('    compadd -- ' + ref('candidates'));
    lines.push('    return');
    lines.push('  fi');
  }
  lines.push('  case ' + ref('words[2]') + ' in');
  for (const command of commands) {
    if (command.sub !== undefined) continue;
    lines.push('    ' + command.group + ') candidates=(' + command.flags.join(' ') + ');;');
  }
  lines.push('    *) candidates=(' + words.join(' ') + ');;');
  lines.push('  esac');
  lines.push('  compadd -- ' + ref('candidates'));
  lines.push('}');
  lines.push('compdef _mdocs mdocs');
  lines.push('');
  return lines.join('\n');
}

function fishScript(commands: CommandNode[]): string {
  const lines: string[] = [];
  lines.push('# fish completion for mdocs');
  lines.push('# Install: mdocs completion fish > ~/.config/fish/completions/mdocs.fish');
  lines.push('complete -c mdocs -f');
  const seen: string[] = [];
  for (const command of commands) {
    if (seen.includes(command.group)) continue;
    seen.push(command.group);
    const summary = command.description.replace(/'/g, '');
    lines.push("complete -c mdocs -n '__fish_use_subcommand' -a '" + command.group + "' -d '" + summary + "'");
  }
  for (const command of commands) {
    const condition = '__fish_seen_subcommand_from ' + command.group;
    for (const flag of command.flags) {
      if (flag === '--json' || flag === '--quiet' || flag === '--no-color' || flag === '--help' || flag === '--token' || flag === '--server' || flag === '--profile' || flag === '--version') continue;
      lines.push("complete -c mdocs -n '" + condition + "' -l " + flag.slice(2) + ' -r');
    }
    if (command.sub !== undefined) {
      lines.push("complete -c mdocs -n '__fish_seen_subcommand_from " + command.group + "' -a '" + command.sub + "'");
    }
  }
  lines.push("complete -c mdocs -l json -d 'Emit a machine-readable JSON envelope'");
  lines.push("complete -c mdocs -l quiet -d 'Suppress confirmations and notes'");
  lines.push("complete -c mdocs -l no-color -d 'Disable ANSI colours'");
  lines.push("complete -c mdocs -l help -d 'Print help'");
  lines.push('');
  return lines.join('\n');
}

function powershellScript(commands: CommandNode[]): string {
  const words = topLevelWords(commands);
  const lines: string[] = [];
  lines.push('# PowerShell completion for mdocs');
  lines.push('# Install: mdocs completion powershell | Out-String | Invoke-Expression');
  lines.push('Register-ArgumentCompleter -Native -CommandName mdocs -ScriptBlock {');
  lines.push('  param(' + D + 'wordToComplete, ' + D + 'commandAst, ' + D + 'cursorPosition)');
  lines.push('  ' + D + 'commands = @(' + words.map(word => "'" + word + "'").join(', ') + ')');
  lines.push('  ' + D + 'options = @{');
  for (const command of commands) {
    const key = command.sub === undefined ? command.group : command.group + ' ' + command.sub;
    lines.push("    '" + key + "' = @(" + command.flags.map(flag => "'" + flag + "'").join(', ') + ')');
  }
  lines.push('  }');
  lines.push('  ' + D + 'words = @(' + D + 'commandAst.CommandElements | ForEach-Object { ' + D + '_.ToString() })');
  lines.push('  ' + D + 'candidates = if (' + D + 'words.Count -le 2) { ' + D + 'commands } else {');
  lines.push('    ' + D + 'key = if (' + D + 'words.Count -ge 3 -and ' + D + 'options.ContainsKey((' + D + 'words[1] + " " + ' + D + 'words[2]))) { ' + D + 'words[1] + " " + ' + D + 'words[2] } else { ' + D + 'words[1] }');
  lines.push('    if (' + D + 'options.ContainsKey(' + D + 'key)) { ' + D + 'options[' + D + 'key] } else { ' + D + 'commands }');
  lines.push('  }');
  lines.push('  ' + D + 'candidates | Where-Object { ' + D + '_ -like "' + D + 'wordToComplete*" } | ForEach-Object {');
  lines.push('    [System.Management.Automation.CompletionResult]::new(' + D + '_, ' + D + '_, "ParameterValue", ' + D + '_)');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export function completionScript(shell: Shell, commands: CommandDefinition[]): string {
  const commandNodes = nodes(commands);
  if (shell === 'bash') return bashScript(commandNodes);
  if (shell === 'zsh') return zshScript(commandNodes);
  if (shell === 'fish') return fishScript(commandNodes);
  return powershellScript(commandNodes);
}
