import type { CommandContext, CommandDefinition } from '../command.js';
import { type ConfigFile, withProfile } from '../config.js';
import { CliError, EXIT, messageOf, usageError } from '../errors.js';
import { ApiClient } from '../http.js';
import type { LoginResponse, User } from '../types.js';

type MeResponse = { user: User | null };

async function login(ctx: CommandContext): Promise<void> {
  const server = ctx.server;
  if (!server) throw usageError('login requires --server URL (or set MDOCS_SERVER).');
  let token: string;
  let user: User | null = null;
  if (ctx.flagToken) {
    const client = new ApiClient({ server, token: ctx.flagToken });
    const me = await client.get<MeResponse>('/me');
    token = ctx.flagToken;
    user = me.user;
  } else {
    const email = ctx.flags.required('email');
    const password = ctx.flags.str('password') ?? process.env.MDOCS_PASSWORD;
    if (password === undefined || password === '') {
      throw usageError('login requires --password or the MDOCS_PASSWORD environment variable.');
    }
    const client = new ApiClient({ server });
    const response = await client.post<LoginResponse>('/auth/login', { email, password });
    if (typeof response.token !== 'string' || response.token === '') {
      throw new CliError('The server did not return an access token.', EXIT.NETWORK);
    }
    token = response.token;
    user = response.user ?? null;
  }
  const existing = ctx.config.profiles[ctx.profileName] ?? {};
  const config: ConfigFile = withProfile(ctx.config, ctx.profileName, { ...existing, server, token });
  await ctx.saveConfig(config);
  if (ctx.out.json) {
    ctx.out.envelope('login', { profile: ctx.profileName, server, user });
    return;
  }
  const who = user ? user.name + ' <' + user.email + '>' : 'the supplied token';
  ctx.out.success('Logged in as ' + who + ' on ' + server + ' (profile: ' + ctx.profileName + ').');
}

async function logout(ctx: CommandContext): Promise<void> {
  const profile = ctx.config.profiles[ctx.profileName];
  if (!profile || !profile.token) {
    if (ctx.out.json) {
      ctx.out.envelope('logout', { profile: ctx.profileName, loggedOut: false });
      return;
    }
    ctx.out.info('No saved credentials for profile "' + ctx.profileName + '".');
    return;
  }
  const next: ConfigFile = withProfile(ctx.config, ctx.profileName, { server: profile.server });
  await ctx.saveConfig(next);
  if (ctx.out.json) {
    ctx.out.envelope('logout', { profile: ctx.profileName, loggedOut: true });
    return;
  }
  ctx.out.success('Logged out of profile "' + ctx.profileName + '".');
}

async function whoami(ctx: CommandContext): Promise<void> {
  const response = await ctx.api().get<MeResponse>('/me');
  if (ctx.out.json) {
    ctx.out.envelope('whoami', { user: response.user, profile: ctx.profileName, server: ctx.server ?? null });
    return;
  }
  if (!response.user) {
    ctx.out.info('The server did not return a user for the current token.');
    return;
  }
  const user = response.user;
  ctx.out.table(
    [{ header: 'field' }, { header: 'value' }],
    [
      ['id', user.id],
      ['email', user.email],
      ['name', user.name],
      ['role', user.role],
      ['profile', ctx.profileName],
      ['server', ctx.server ?? '-']
    ]
  );
}

type DoctorCheck = {
  name: string;
  status: string;
  detail: string;
  ok: boolean;
};

function check(name: string, status: string, detail: string, ok: boolean): DoctorCheck {
  return { name, status, detail, ok };
}

async function doctor(ctx: CommandContext): Promise<number> {
  const api = ctx.api();
  const server = ctx.server ?? api.server;
  const checks: DoctorCheck[] = [];
  let exitCode: number = EXIT.OK;
  try {
    const health = await api.get<{ status?: string }>('/healthz', { absolute: true, timeoutMs: 8000 });
    const ok = health.status === 'ok';
    checks.push(check('server', ok ? 'ok' : 'degraded', server, ok));
    if (!ok) exitCode = EXIT.NETWORK;
  } catch (error) {
    checks.push(check('server', 'unreachable', messageOf(error), false));
    exitCode = error instanceof CliError ? error.exitCode : EXIT.NETWORK;
  }
  let user: User | null = null;
  if (exitCode === EXIT.OK) {
    try {
      const me = await api.get<MeResponse>('/me', { timeoutMs: 8000 });
      user = me.user;
      const ok = user !== null;
      checks.push(check('authentication', ok ? 'ok' : 'no user', ok && user ? user.email + ' (' + user.role + ')' : 'token accepted but no membership was returned', ok));
      if (!ok) exitCode = EXIT.AUTH;
    } catch (error) {
      checks.push(check('authentication', 'failed', messageOf(error), false));
      exitCode = error instanceof CliError ? error.exitCode : EXIT.AUTH;
    }
  } else {
    checks.push(check('authentication', 'skipped', 'server is unreachable', false));
  }
  let version: string | null = null;
  if (checks[0]?.ok === true) {
    try {
      const payload = await api.get<{ version?: string }>('/system/version', { timeoutMs: 8000 });
      version = payload.version ?? null;
      checks.push(check('version', version === null ? 'unknown' : 'ok', version ?? 'server did not report a version', true));
    } catch (error) {
      checks.push(check('version', 'unavailable', messageOf(error), true));
    }
  } else {
    checks.push(check('version', 'skipped', 'server is unreachable', false));
  }
  if (ctx.out.json) {
    ctx.out.envelope('doctor', { server, version, user, checks });
    return exitCode;
  }
  ctx.out.table(
    [{ header: 'check' }, { header: 'status' }, { header: 'detail' }],
    checks.map(item => [
      item.name,
      { text: item.status, color: item.ok ? 'green' : 'red' },
      item.detail
    ])
  );
  if (exitCode === EXIT.OK) ctx.out.info('All checks passed.');
  else ctx.out.info('One or more checks failed.');
  return exitCode;
}

export const loginCommand: CommandDefinition = {
  name: 'login',
  category: 'Authentication',
  summary: 'Save the server URL and a token for a profile',
  usage: 'login --server URL (--email EMAIL [--password PASSWORD] | --token TOKEN) [--profile NAME]',
  details: 'The password may also come from MDOCS_PASSWORD so it never lands in shell history.\nCredentials are written with owner-only permissions and the token is never printed.',
  flags: [
    { name: 'email', description: 'Account email address.', valueName: 'EMAIL' },
    { name: 'password', description: 'Account password (or set MDOCS_PASSWORD).', valueName: 'PASSWORD' }
  ],
  positionals: [],
  examples: [
    'mdocs login --server https://docs.example.com --email ada@example.com',
    'MDOCS_PASSWORD=secret mdocs login --server https://docs.example.com --email ada@example.com',
    'mdocs login --server https://docs.example.com --token TOKEN --profile ci'
  ],
  handler: login
};

export const logoutCommand: CommandDefinition = {
  name: 'logout',
  category: 'Authentication',
  summary: 'Remove the saved token for a profile',
  usage: 'logout [--profile NAME]',
  details: 'The server URL stays in the profile so the next "mdocs login" can reuse it.',
  flags: [],
  positionals: [],
  examples: ['mdocs logout', 'mdocs logout --profile ci'],
  handler: logout
};

export const whoamiCommand: CommandDefinition = {
  name: 'whoami',
  category: 'Authentication',
  summary: 'Show the authenticated user and active profile',
  usage: 'whoami',
  flags: [],
  positionals: [],
  examples: ['mdocs whoami', 'mdocs whoami --json'],
  handler: whoami
};

export const doctorCommand: CommandDefinition = {
  name: 'doctor',
  category: 'Authentication',
  summary: 'Check server reachability, the token, and the server version',
  usage: 'doctor',
  details: 'Runs GET /healthz, GET /me, and GET /system/version, and reports which check failed.\nExit code 3 means the server is unreachable or unhealthy; 4 means the token was rejected.',
  flags: [],
  positionals: [],
  examples: ['mdocs doctor', 'mdocs doctor --json'],
  handler: doctor
};

