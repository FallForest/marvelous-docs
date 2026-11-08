import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer, TOKEN } from './mock-server.mjs';

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

const MANAGED_ENV = ['MDOCS_CONFIG_DIR', 'MDOCS_SERVER', 'MDOCS_TOKEN', 'MDOCS_PROFILE', 'MDOCS_PASSWORD'];

/**
 * Runs the built CLI with a clean environment: no inherited MDOCS_* values, no
 * colour, and deterministic stdio pipes.
 */
export function runCli(args, options = {}) {
  const env = { ...process.env };
  for (const key of MANAGED_ENV) delete env[key];
  if (options.configDir !== undefined) env.MDOCS_CONFIG_DIR = options.configDir;
  if (options.server !== undefined) env.MDOCS_SERVER = options.server;
  if (options.token !== undefined) env.MDOCS_TOKEN = options.token;
  if (options.password !== undefined) env.MDOCS_PASSWORD = options.password;
  Object.assign(env, options.env ?? {});
  env.NO_COLOR = '1';
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: null, stdout, stderr: stderr + '\n[timed out after 60s]' });
    }, 60000);
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: stderr + '\n' + error.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

export function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error('Expected JSON on stdout, received:\n' + result.stdout + '\n(' + error.message + ')');
  }
}

/**
 * Fresh mock API and isolated config directory per test. Ports are ephemeral
 * (127.0.0.1:0) and the config directory is removed in t.after.
 */
export async function createHarness(t) {
  const server = await startMockServer();
  const configDir = await mkdtemp(join(tmpdir(), 'mdocs-cli-'));
  t.after(async () => {
    await server.close();
    await rm(configDir, { recursive: true, force: true });
  });
  return {
    server,
    configDir,
    configPath: join(configDir, 'config.json'),
    run: (args, options = {}) => runCli(args, { configDir, server: server.url, token: TOKEN, ...options }),
    runAnonymous: (args, options = {}) => runCli(args, { configDir, server: server.url, ...options })
  };
}