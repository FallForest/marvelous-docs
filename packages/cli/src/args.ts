import { usageError } from './errors.js';

export type FlagKind = 'string' | 'boolean';

export type FlagDefinition = {
  /** Name without the leading dashes, for example "expected-version". */
  name: string;
  description: string;
  /** Defaults to "string". */
  kind?: FlagKind;
  /** Placeholder shown in help, for example "ID". */
  valueName?: string;
};

export type FlagValue = string | boolean;

export type ParsedArgs = {
  positional: string[];
  values: Map<string, FlagValue>;
};

/**
 * Global options are accepted before or after the command name, so they are
 * lifted out of the token stream before command dispatch.
 */
export const GLOBAL_FLAGS: FlagDefinition[] = [
  { name: 'server', description: 'Server base URL; overrides the active profile.', valueName: 'URL' },
  { name: 'token', description: 'Bearer token; overrides the active profile.', valueName: 'TOKEN' },
  { name: 'profile', description: 'Configuration profile to use.', valueName: 'NAME' },
  { name: 'json', kind: 'boolean', description: 'Emit a machine-readable JSON envelope.' },
  { name: 'quiet', kind: 'boolean', description: 'Suppress confirmations and notes.' },
  { name: 'no-color', kind: 'boolean', description: 'Disable ANSI colours even on a TTY.' },
  { name: 'version', kind: 'boolean', description: 'Print the CLI version and exit.' },
  { name: 'help', kind: 'boolean', description: 'Print help for the CLI or a command and exit.' }
];

const GLOBAL_NAMES = new Set(GLOBAL_FLAGS.map(flag => flag.name));

function isLongOption(token: string): boolean {
  return token.startsWith('--') && token.length > 2;
}

function optionName(token: string): string {
  const equals = token.indexOf('=');
  return equals < 0 ? token.slice(2) : token.slice(2, equals);
}

export function parseArgs(tokens: string[], definitions: FlagDefinition[], commandName: string): ParsedArgs {
  const known = new Map(definitions.map(definition => [definition.name, definition]));
  const values = new Map<string, FlagValue>();
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === '--') {
      positional.push(...tokens.slice(index + 1));
      break;
    }
    if (!isLongOption(token)) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const name = optionName(token);
    const definition = known.get(name);
    if (!definition) {
      throw usageError('Unknown option --' + name + ' for "mdocs ' + commandName + '". Run "mdocs ' + commandName + ' --help" to list supported options.');
    }
    if (values.has(name)) throw usageError('Option --' + name + ' was provided more than once.');
    if ((definition.kind ?? 'string') === 'boolean') {
      if (equals < 0) {
        values.set(name, true);
        continue;
      }
      const raw = token.slice(equals + 1).trim().toLowerCase();
      if (raw === 'true' || raw === '') {
        values.set(name, true);
        continue;
      }
      if (raw === 'false') {
        values.set(name, false);
        continue;
      }
      throw usageError('Option --' + name + ' accepts true or false, received "' + raw + '".');
    }
    let value: string | undefined;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = tokens[index + 1];
      if (next !== undefined && !isLongOption(next)) {
        value = next;
        index += 1;
      }
    }
    if (value === undefined || value === '') throw usageError('Option --' + name + ' requires a value.');
    values.set(name, value);
  }
  return { positional, values };
}

export type GlobalArgs = {
  parsed: ParsedArgs;
  rest: string[];
};

/**
 * Splits global options from command tokens. A global option that takes a value
 * consumes the following token unless it is written as --name=value.
 */
export function splitGlobals(tokens: string[]): GlobalArgs {
  const globals: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === '--') {
      rest.push(...tokens.slice(index));
      break;
    }
    const normalised = token === '-h' ? '--help' : token === '-V' ? '--version' : token;
    if (isLongOption(normalised) && GLOBAL_NAMES.has(optionName(normalised))) {
      globals.push(normalised);
      const definition = GLOBAL_FLAGS.find(flag => flag.name === optionName(normalised)) as FlagDefinition;
      if ((definition.kind ?? 'string') === 'string' && normalised.indexOf('=') < 0) {
        const next = tokens[index + 1];
        if (next !== undefined && !isLongOption(next)) {
          globals.push(next);
          index += 1;
        }
      }
      continue;
    }
    rest.push(token);
  }
  return { parsed: parseArgs(globals, GLOBAL_FLAGS, ' <global>'), rest };
}

export class Flags {
  readonly positional: string[];

  private readonly values: Map<string, FlagValue>;

  constructor(parsed: ParsedArgs) {
    this.positional = parsed.positional;
    this.values = parsed.values;
  }

  has(name: string): boolean {
    return this.values.get(name) === true;
  }

  bool(name: string): boolean {
    return this.values.get(name) === true;
  }

  str(name: string): string | undefined {
    const value = this.values.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  required(name: string): string {
    const value = this.str(name);
    if (!value) throw usageError('Missing required option --' + name + '.');
    return value;
  }

  integer(name: string, options: { min?: number; max?: number } = {}): number | undefined {
    const raw = this.str(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw usageError('Option --' + name + ' must be an integer, received "' + raw + '".');
    if (options.min !== undefined && value < options.min) throw usageError('Option --' + name + ' must be at least ' + options.min + '.');
    if (options.max !== undefined && value > options.max) throw usageError('Option --' + name + ' must be at most ' + options.max + '.');
    return value;
  }

  choice<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    const raw = this.str(name);
    if (raw === undefined) return undefined;
    if (!allowed.includes(raw as T)) {
      throw usageError('Option --' + name + ' must be one of: ' + allowed.join(', ') + '. Received "' + raw + '".');
    }
    return raw as T;
  }

  /** Rejects combined options that cannot be used together. */
  exclusive(names: string[], message: string): void {
    const present = names.filter(name => this.has(name));
    if (present.length > 1) throw usageError(message);
  }

  requireOne(names: string[], message: string): void {
    const present = names.filter(name => this.has(name));
    if (present.length !== 1) throw usageError(message);
  }
}
