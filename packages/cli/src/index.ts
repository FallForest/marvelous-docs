#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Config = { server?: string; token?: string; updateCheckedAt?: number };
type DocumentJson = { schemaVersion: 1; doc: { type: 'doc'; content: Json[] } };

const usage = `mdocs - Marvelous Docs command line client

Usage:
  mdocs login --server URL --email EMAIL --password PASSWORD
  mdocs list
  mdocs create --title TITLE [--input FILE|-]
  mdocs read ID [--output FILE|-]
  mdocs update ID --expected-version N [--title TITLE] [--input FILE|-]
  mdocs export ID [--output FILE|-]

Environment: MDOCS_SERVER, MDOCS_TOKEN, MDOCS_PASSWORD, MDOCS_CONFIG_DIR`;

class CliError extends Error {
  constructor(message: string, readonly code = 1) { super(message); }
}

function configPath(): string {
  const base = process.env.MDOCS_CONFIG_DIR ?? process.env.XDG_CONFIG_HOME ??
    (process.env.APPDATA ? join(process.env.APPDATA, 'mdocs') : join(homedir(), '.config', 'mdocs'));
  return join(base, 'config.json');
}

async function loadConfig(): Promise<Config> {
  try {
    const value: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid config');
    return value as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CliError(`Cannot read config ${configPath()}: ${(error as Error).message}`);
  }
}

async function saveConfig(config: Config): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

function parseArgs(args: string[]): { positional: string[]; options: Map<string, string> } {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equal = arg.indexOf('=');
    const key = arg.slice(2, equal < 0 ? undefined : equal);
    if (!key || options.has(key)) throw new CliError(`Invalid or repeated option: ${arg}`, 2);
    const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
    if (value === undefined || value.startsWith('--')) throw new CliError(`Option --${key} requires a value`, 2);
    options.set(key, value);
  }
  return { positional, options };
}

function option(options: Map<string, string>, key: string, required = false): string | undefined {
  const value = options.get(key);
  if (required && !value) throw new CliError(`Missing required option --${key}`, 2);
  return value;
}

async function inputText(file: string): Promise<string> {
  if (file !== '-') return readFile(file, 'utf8');
  if (process.stdin.isTTY) throw new CliError('Input is stdin but no piped data was provided', 2);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parseDocument(text: string): DocumentJson {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new CliError(`Invalid document JSON: ${(error as Error).message}`, 2); }
  if (!value || typeof value !== 'object' || (value as any).schemaVersion !== 1 ||
      !(value as any).doc || (value as any).doc.type !== 'doc' || !Array.isArray((value as any).doc.content)) {
    throw new CliError('Document must match {"schemaVersion":1,"doc":{"type":"doc","content":[]}}', 2);
  }
  return value as DocumentJson;
}

async function request(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const server = process.env.MDOCS_SERVER ?? config.server;
  if (!server) throw new CliError('Server is not configured; run mdocs login --server URL ...', 2);
  let url: URL;
  try { url = new URL(path, server.endsWith('/') ? server : `${server}/`); }
  catch { throw new CliError('Configured server URL is invalid', 2); }
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const token = process.env.MDOCS_TOKEN ?? config.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(url, { ...init, headers }); }
  catch (error) { throw new CliError(`Cannot reach ${url.origin}: ${(error as Error).message}`, 3); }
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
  if (!response.ok) {
    const object = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const detail = object.message ?? object.error ?? (typeof payload === 'string' ? payload : response.statusText);
    const conflict = response.status === 409 ? ' (document version conflict; read the latest version before retrying)' : '';
    throw new CliError(`Request failed (${response.status})${conflict}: ${String(detail)}`, response.status === 401 || response.status === 403 ? 4 : response.status === 409 ? 5 : 3);
  }
  return payload;
}

function unwrapDocument(value: any): any {
  return value?.document ?? value;
}

async function emit(value: unknown, destination?: string): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!destination || destination === '-') process.stdout.write(text);
  else await writeFile(destination, text, 'utf8');
}

async function checkForUpdates(config: Config): Promise<void> {
  if (!config.token || !config.server) return;
  const now = Date.now();
  if (config.updateCheckedAt && now - config.updateCheckedAt < 24 * 60 * 60 * 1000) return;
  try {
    const result = await request(config, '/api/v1/system/update-check') as { updateAvailable?: boolean; latestVersion?: string | null; manifest?: { releaseUrl?: string } | null };
    config.updateCheckedAt = now;
    await saveConfig(config);
    if (result.updateAvailable && result.latestVersion) {
      process.stderr.write(`A new mdocs version is available: ${result.latestVersion}${result.manifest?.releaseUrl ? ` (${result.manifest.releaseUrl})` : ''}\n`);
    }
  } catch {
    // Update checks are advisory and must never break document commands.
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') { process.stdout.write(`${usage}\n`); return; }
  const { positional, options } = parseArgs(rest);
  let config = await loadConfig();
  if (command === 'login') {
    const server = option(options, 'server', true)!;
    const email = option(options, 'email', true)!;
    const password = option(options, 'password') ?? process.env.MDOCS_PASSWORD;
    if (!password) throw new CliError('Provide --password or MDOCS_PASSWORD', 2);
    const response = await request({ server }, '/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }) as any;
    const token = response?.token ?? response?.accessToken;
    if (typeof token !== 'string' || !token) throw new CliError('Login response did not include a token', 3);
    config = { ...config, server, token };
    await saveConfig(config);
    process.stdout.write('Logged in. Credentials saved to the local mdocs config.\n');
    return;
  }
  await checkForUpdates(config);
  if (command === 'list') {
    const result = await request(config, '/api/v1/documents');
    await emit((result as any)?.documents ?? result);
    return;
  }
  if (command === 'create') {
    const title = option(options, 'title', true)!;
    const input = option(options, 'input');
    const content = input === undefined ? { schemaVersion: 1, doc: { type: 'doc', content: [] } } : parseDocument(await inputText(input));
    const result = await request(config, '/api/v1/documents', { method: 'POST', body: JSON.stringify({ title, content }) });
    await emit(unwrapDocument(result));
    return;
  }
  if (command === 'read' || command === 'export') {
    const id = positional[0];
    if (!id) throw new CliError(`${command} requires a document ID`, 2);
    const result = unwrapDocument(await request(config, `/api/v1/documents/${encodeURIComponent(id)}`)) as any;
    if (command === 'export') {
      const document = result?.content;
      if (!document || document.schemaVersion !== 1) throw new CliError('Document response has no versioned JSON content', 3);
      await emit(document, option(options, 'output'));
    } else await emit(result, option(options, 'output'));
    return;
  }
  if (command === 'update') {
    const id = positional[0];
    if (!id) throw new CliError('update requires a document ID', 2);
    const expectedVersionText = option(options, 'expected-version', true)!;
    const expectedVersion = Number(expectedVersionText);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new CliError('--expected-version must be a non-negative integer', 2);
    const body: Record<string, unknown> = { expectedVersion };
    const title = option(options, 'title');
    if (title !== undefined) body.title = title;
    const input = option(options, 'input');
    if (input !== undefined) body.content = parseDocument(await inputText(input));
    if (title === undefined && input === undefined) throw new CliError('update requires --title and/or --input', 2);
    const result = await request(config, `/api/v1/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    await emit(unwrapDocument(result));
    return;
  }
  throw new CliError(`Unknown command: ${command}\n\n${usage}`, 2);
}

main().catch((error: unknown) => {
  const cliError = error instanceof CliError ? error : new CliError((error as Error).message);
  process.stderr.write(`mdocs: ${cliError.message}\n`);
  process.exitCode = cliError.code;
});
