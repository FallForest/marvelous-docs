import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, EXIT, messageOf, usageError } from './errors.js';

export type Profile = {
  server?: string;
  token?: string;
};

/**
 * On-disk configuration. Version 1 keeps named profiles:
 *
 *   { "version": 1, "defaultProfile": "default", "profiles": { ... } }
 *
 * The legacy shape { server, token } is migrated on read.
 */
export type ConfigFile = {
  version: 1;
  defaultProfile: string;
  profiles: Record<string, Profile>;
  updateCheckedAt?: number;
};

export const DEFAULT_PROFILE = 'default';

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function configDirectory(): string {
  const override = envValue('MDOCS_CONFIG_DIR');
  if (override) return override;
  const xdg = envValue('XDG_CONFIG_HOME');
  if (xdg) return join(xdg, 'mdocs');
  const appData = envValue('APPDATA');
  if (appData && process.platform === 'win32') return join(appData, 'mdocs');
  return join(homedir(), '.config', 'mdocs');
}

export function configFile(): string {
  return join(configDirectory(), 'config.json');
}

export function emptyConfig(): ConfigFile {
  return { version: 1, defaultProfile: DEFAULT_PROFILE, profiles: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanProfile(value: unknown): Profile {
  const profile: Profile = {};
  if (!isRecord(value)) return profile;
  const server = value.server;
  if (typeof server === 'string' && server.trim() !== '') profile.server = server.trim();
  const token = value.token;
  if (typeof token === 'string' && token !== '') profile.token = token;
  return profile;
}

export type NormalizedConfig = {
  config: ConfigFile;
  migrated: boolean;
};

export function normalizeConfig(raw: unknown): NormalizedConfig {
  if (!isRecord(raw)) {
    throw new CliError('Config file ' + configFile() + ' is not a JSON object. Remove it and run "mdocs login" again.', EXIT.USAGE);
  }
  if (raw.version !== 1) {
    const legacyServer = typeof raw.server === 'string' ? raw.server.trim() : '';
    const legacyToken = typeof raw.token === 'string' ? raw.token : '';
    const profiles: Record<string, Profile> = {};
    if (legacyServer !== '' || legacyToken !== '') {
      profiles[DEFAULT_PROFILE] = cleanProfile({ server: legacyServer, token: legacyToken });
    }
    const config: ConfigFile = { version: 1, defaultProfile: DEFAULT_PROFILE, profiles };
    if (typeof raw.updateCheckedAt === 'number') config.updateCheckedAt = raw.updateCheckedAt;
    return { config, migrated: true };
  }
  const profiles: Record<string, Profile> = {};
  if (isRecord(raw.profiles)) {
    for (const [name, value] of Object.entries(raw.profiles)) {
      if (name.trim() === '') continue;
      profiles[name] = cleanProfile(value);
    }
  }
  const defaultProfile = typeof raw.defaultProfile === 'string' && raw.defaultProfile.trim() !== ''
    ? raw.defaultProfile.trim()
    : DEFAULT_PROFILE;
  const config: ConfigFile = { version: 1, defaultProfile, profiles };
  if (typeof raw.updateCheckedAt === 'number') config.updateCheckedAt = raw.updateCheckedAt;
  return { config, migrated: false };
}

export async function loadConfig(): Promise<ConfigFile> {
  let text: string;
  const file = configFile();
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig();
    throw new CliError('Cannot read config ' + file + ': ' + messageOf(error));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CliError('Config file ' + file + ' is not valid JSON. Remove it and run "mdocs login" again.', EXIT.USAGE);
  }
  const { config, migrated } = normalizeConfig(raw);
  if (migrated) {
    try {
      await saveConfig(config);
    } catch {
      // A read-only config directory must not make read commands fail.
    }
  }
  return config;
}

export async function saveConfig(config: ConfigFile): Promise<void> {
  const directory = configDirectory();
  const file = configFile();
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    if (process.platform !== 'win32') {
      await chmod(directory, 0o700);
      await chmod(file, 0o600);
    }
  } catch (error) {
    throw new CliError('Cannot write config ' + file + ': ' + messageOf(error));
  }
}

export function profileNameFor(config: ConfigFile, requested?: string): string {
  const explicit = requested !== undefined && requested.trim() !== '' ? requested.trim() : envValue('MDOCS_PROFILE');
  if (explicit) return explicit;
  return config.defaultProfile !== '' ? config.defaultProfile : DEFAULT_PROFILE;
}

export function profileFor(config: ConfigFile, name: string): Profile {
  const profile = config.profiles[name];
  if (profile) return profile;
  const available = Object.keys(config.profiles);
  const detail = available.length > 0
    ? 'Available profiles: ' + available.join(', ') + '.'
    : 'No profiles are configured; run "mdocs login --server URL --email EMAIL" first.';
  throw usageError('Unknown profile "' + name + '". ' + detail);
}

export type Credentials = {
  server?: string;
  token?: string;
};

/** Environment variables win over the stored profile. */
export function credentialsFor(profile: Profile): Credentials {
  return {
    server: envValue('MDOCS_SERVER') ?? profile.server,
    token: envValue('MDOCS_TOKEN') ?? profile.token
  };
}

export function withProfile(config: ConfigFile, name: string, profile: Profile): ConfigFile {
  const known = config.profiles[name] !== undefined;
  const defaultProfile = known || config.profiles[config.defaultProfile] !== undefined
    ? config.defaultProfile
    : name;
  return {
    ...config,
    defaultProfile,
    profiles: { ...config.profiles, [name]: profile }
  };
}
