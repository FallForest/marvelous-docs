import type { FlagDefinition, Flags } from './args.js';
import type { ConfigFile } from './config.js';
import type { ApiClient } from './http.js';
import type { Output } from './output.js';

export type CommandContext = {
  out: Output;
  flags: Flags;
  positional: string[];
  /** Command path currently executing, for example "comments add". */
  commandName: string;
  config: ConfigFile;
  profileName: string;
  /** Explicit --token value; environment tokens are exposed through token instead. */
  flagToken?: string;
  server?: string;
  token?: string;
  /** Builds the HTTP client on demand so help/completion need no server. */
  api: () => ApiClient;
  saveConfig: (config: ConfigFile) => Promise<void>;
  readStdin: () => Promise<string>;
};

export type PositionalDefinition = {
  name: string;
  required?: boolean;
  description: string;
};

export type CommandDefinition = {
  /** Command path, for example "list" or "comments add". */
  name: string;
  category: string;
  summary: string;
  /** Usage without the leading "mdocs ". */
  usage: string;
  details?: string;
  flags: FlagDefinition[];
  positionals: PositionalDefinition[];
  examples: string[];
  handler: (ctx: CommandContext) => Promise<number | void>;
};

export function commandUsage(command: CommandDefinition): string {
  return 'mdocs ' + command.usage;
}
