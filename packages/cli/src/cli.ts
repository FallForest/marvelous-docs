import { readFile } from 'node:fs/promises';
import { Flags, parseArgs, splitGlobals } from './args.js';
import type { CommandContext } from './command.js';
import { COMMANDS, resolveCommand, subcommandHint } from './commands/index.js';
import type { ConfigFile, Profile } from './config.js';
import { credentialsFor, loadConfig, profileFor, profileNameFor, saveConfig } from './config.js';
import { CliError, EXIT, messageOf, usageError } from './errors.js';
import { commandHelp, rootHelp } from './help.js';
import { ApiClient } from './http.js';
import { Output, colorEnabled } from './output.js';
import { maybeCheckForUpdates } from './update-check.js';

const UPDATE_CHECK_SKIPPED = new Set(['login', 'logout', 'completion', 'doctor']);

/** Commands that must work without any stored profile or credentials. */
const OFFLINE_COMMANDS = new Set(['login', 'logout', 'completion']);

let cachedVersion: string | undefined;

async function cliVersion(): Promise<string> {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw usageError('No data was piped to stdin.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function optionString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Entry point. Parses global options, resolves the command, builds the
 * context, and maps failures to documented exit codes.
 */
export async function main(argv: string[]): Promise<void> {
  const { parsed: globals, rest } = splitGlobals(argv);
  const json = globals.values.get('json') === true;
  const quiet = globals.values.get('quiet') === true;
  const noColor = globals.values.get('no-color') === true;
  const helpRequested = globals.values.get('help') === true;
  const version = await cliVersion();
  const output = new Output({
    json,
    quiet,
    color: noColor ? false : colorEnabled(),
    stdout: process.stdout,
    stderr: process.stderr
  });
  try {
    if (globals.values.get('version') === true) {
      output.line('mdocs ' + version);
      return;
    }
    const helpAlias = rest[0] === 'help';
    const tokens = helpAlias ? rest.slice(1) : rest;
    if (tokens.length === 0) {
      output.line(rootHelp(COMMANDS, version));
      return;
    }
    const resolved = resolveCommand(tokens);
    if (!resolved) {
      const unknown = tokens.slice(0, 2).join(' ');
      const hint = subcommandHint(tokens[0] ?? '');
      throw usageError(
        'Unknown command: ' + unknown + '.' +
        (hint === '' ? ' Run "mdocs --help" for the list of commands.' : ' ' + hint)
      );
    }
    if (helpRequested || helpAlias) {
      output.line(commandHelp(resolved.command));
      return;
    }
    const command = resolved.command;
    const flags = new Flags(parseArgs(resolved.rest, command.flags, command.name));
    const config: ConfigFile = await loadConfig();
    const requestedProfile = optionString(globals.values.get('profile'));
    const profileName = profileNameFor(config, requestedProfile);
    const serverFlag = optionString(globals.values.get('server'));
    const tokenFlag = optionString(globals.values.get('token'));
    const explicitProfile = requestedProfile !== undefined || (process.env.MDOCS_PROFILE ?? '').trim() !== '';
    const credentialOverrides = serverFlag !== undefined || tokenFlag !== undefined ||
      (process.env.MDOCS_SERVER ?? '').trim() !== '' || (process.env.MDOCS_TOKEN ?? '').trim() !== '';
    let profile: Profile = config.profiles[profileName] ?? {};
    if (config.profiles[profileName] === undefined && !OFFLINE_COMMANDS.has(command.name)) {
      if (explicitProfile || !credentialOverrides) profile = profileFor(config, profileName);
    }
    const credentials = credentialsFor(profile);
    const server = serverFlag ?? credentials.server;
    const token = tokenFlag ?? credentials.token;
    let client: ApiClient | undefined;
    const api = (): ApiClient => {
      if (client) return client;
      if (server === undefined) {
        throw usageError('Server is not configured. Run "mdocs login --server URL --email EMAIL" or set MDOCS_SERVER.');
      }
      client = new ApiClient({ server, token });
      return client;
    };
    const ctx: CommandContext = {
      out: output,
      flags,
      positional: flags.positional,
      commandName: command.name,
      config,
      profileName,
      flagToken: tokenFlag,
      server,
      token,
      api,
      saveConfig,
      readStdin
    };
    if (!UPDATE_CHECK_SKIPPED.has(command.name) && token !== undefined) {
      try {
        await maybeCheckForUpdates({ api: api(), out: output, config, saveConfig });
      } catch {
        // Advisory only: never break the command.
      }
    }
    const code = await command.handler(ctx);
    if (typeof code === 'number') process.exitCode = code;
  } catch (error) {
    const cliError = error instanceof CliError ? error : new CliError(messageOf(error));
    output.error(cliError.message);
    process.exitCode = cliError.exitCode;
  }
}

export const EXIT_CODES = EXIT;
