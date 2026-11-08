import { GLOBAL_FLAGS, type FlagDefinition } from './args.js';
import { commandUsage, type CommandDefinition } from './command.js';

const EXIT_CODES: { code: string; description: string }[] = [
  { code: '0', description: 'Success.' },
  { code: '1', description: 'Unexpected failure (for example an unreadable config file).' },
  { code: '2', description: 'Usage error: unknown command or option, missing value, invalid argument.' },
  { code: '3', description: 'Network or server failure, including timeouts and 5xx responses.' },
  { code: '4', description: 'Authentication or permission failure (401, 403).' },
  { code: '5', description: 'Version conflict: --expected-version did not match the stored document.' },
  { code: '6', description: 'Not found: document, folder, version, comment, template, or upload.' }
];

const ENVIRONMENT: { name: string; description: string }[] = [
  { name: 'MDOCS_SERVER', description: 'Server base URL; overrides the profile value.' },
  { name: 'MDOCS_TOKEN', description: 'Bearer token; overrides the profile value.' },
  { name: 'MDOCS_PASSWORD', description: 'Password for "mdocs login" so it stays out of shell history.' },
  { name: 'MDOCS_PROFILE', description: 'Profile name to use when --profile is absent.' },
  { name: 'MDOCS_CONFIG_DIR', description: 'Configuration directory (defaults to the platform config dir).' },
  { name: 'NO_COLOR', description: 'Disable ANSI colours, like --no-color.' }
];

function flagLabel(flag: FlagDefinition): string {
  const valueName = flag.valueName ?? 'VALUE';
  return (flag.kind ?? 'string') === 'boolean' ? '--' + flag.name : '--' + flag.name + ' ' + valueName;
}

function padName(name: string, width: number): string {
  return name.length >= width ? name : name + ' '.repeat(width - name.length);
}

function optionLines(flags: FlagDefinition[]): string[] {
  const width = Math.max(...flags.map(flag => flagLabel(flag).length)) + 2;
  return flags.map(flag => '  ' + padName(flagLabel(flag), width) + flag.description);
}

export function rootHelp(commands: CommandDefinition[], version: string): string {
  const lines: string[] = [];
  lines.push('mdocs ' + version + ' - Marvelous Docs command line client');
  lines.push('');
  lines.push('Usage:');
  lines.push('  mdocs <command> [options]');
  lines.push('');
  const categories: string[] = [];
  for (const command of commands) {
    if (!categories.includes(command.category)) categories.push(command.category);
  }
  const width = Math.max(...commands.map(command => ('mdocs ' + command.name).length)) + 2;
  lines.push('Commands:');
  for (const category of categories) {
    lines.push('');
    lines.push('  ' + category);
    for (const command of commands) {
      if (command.category !== category) continue;
      lines.push('    ' + padName('mdocs ' + command.name, width) + command.summary);
    }
  }
  lines.push('');
  lines.push('Global options:');
  lines.push(...optionLines(GLOBAL_FLAGS));
  lines.push('');
  lines.push('Document ids are UUIDs printed by "mdocs list" or "mdocs create".');
  lines.push('Run "mdocs <command> --help" for examples and command options.');
  lines.push('');
  lines.push('Environment:');
  lines.push(...ENVIRONMENT.map(item => '  ' + padName(item.name, 18) + item.description));
  lines.push('');
  lines.push('Exit codes:');
  lines.push(...EXIT_CODES.map(item => '  ' + padName(item.code, 4) + item.description));
  lines.push('');
  return lines.join('\n');
}

export function commandHelp(command: CommandDefinition): string {
  const lines: string[] = [];
  lines.push('Usage: ' + commandUsage(command));
  lines.push('');
  lines.push(command.summary);
  if (command.details) {
    lines.push('');
    for (const paragraph of command.details.split('\n')) lines.push(paragraph);
  }
  if (command.positionals.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    const width = Math.max(...command.positionals.map(item => item.name.length)) + 2;
    for (const item of command.positionals) {
      lines.push('  ' + padName(item.name, width) + item.description + (item.required === false ? ' (optional)' : ''));
    }
  }
  lines.push('');
  lines.push('Options:');
  if (command.flags.length === 0) {
    lines.push('  (command has no options of its own)');
  } else {
    lines.push(...optionLines(command.flags));
  }
  lines.push(...optionLines(GLOBAL_FLAGS));
  if (command.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    for (const example of command.examples) lines.push('  ' + example);
  }
  lines.push('');
  return lines.join('\n');
}

export function exitCodeSummary(): string {
  return EXIT_CODES.map(item => item.code + ' ' + item.description).join('\n');
}
