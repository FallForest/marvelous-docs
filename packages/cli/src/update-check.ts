import type { ConfigFile } from './config.js';
import type { ApiClient } from './http.js';
import type { Output } from './output.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateCheckResponse = {
  currentVersion?: string;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  manifest?: { releaseUrl?: string; notesUrl?: string } | null;
};

/**
 * Advisory update check: at most once per day, never fails a command, and never
 * touches stdout so pipes stay clean.
 */
export async function maybeCheckForUpdates(input: {
  api: ApiClient;
  out: Output;
  config: ConfigFile;
  saveConfig: (config: ConfigFile) => Promise<void>;
}): Promise<void> {
  if (input.out.quiet || input.out.json) return;
  const now = Date.now();
  const checkedAt = input.config.updateCheckedAt;
  if (typeof checkedAt === 'number' && now - checkedAt < DAY_MS) return;
  try {
    const result = await input.api.get<UpdateCheckResponse>('/system/update-check', { timeoutMs: 3000 });
    input.config.updateCheckedAt = now;
    try {
      await input.saveConfig({ ...input.config, updateCheckedAt: now });
    } catch {
      // A read-only config must not break the command that triggered the check.
    }
    if (result.updateAvailable === true && typeof result.latestVersion === 'string' && result.latestVersion !== '') {
      const releaseUrl = result.manifest?.releaseUrl;
      const suffix = typeof releaseUrl === 'string' && releaseUrl !== '' ? ' (' + releaseUrl + ')' : '';
      input.out.warn('A new server version is available: ' + result.latestVersion + suffix);
    }
  } catch {
    // Advisory only.
  }
}
