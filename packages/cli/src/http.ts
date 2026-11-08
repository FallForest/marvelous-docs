import { CliError, EXIT, messageOf, usageError } from './errors.js';

export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = {
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Request /healthz and other paths that live outside /api/v1. */
  absolute?: boolean;
};

export type ApiClientOptions = {
  server: string;
  token?: string;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
};

export type UploadInput = {
  name: string;
  data: Buffer;
  contentType: string;
};

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120000;

type ErrorEnvelope = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

function exitCodeForStatus(status: number, code: string | undefined): number {
  if (status === 409 && code === 'VERSION_CONFLICT') return EXIT.CONFLICT;
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 429) return EXIT.NETWORK;
  if (status >= 500) return EXIT.NETWORK;
  if (status >= 400) return EXIT.USAGE;
  return EXIT.ERROR;
}

function parsePayload(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function networkFailure(url: URL, error: unknown, timeoutMs: number): CliError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new CliError(
      'Request to ' + url.origin + ' timed out after ' + Math.round(timeoutMs / 1000) + 's. Check the server URL and network.',
      EXIT.NETWORK
    );
  }
  return new CliError(
    'Cannot reach ' + url.origin + ': ' + messageOf(error) + '. Check that the server is running and the URL is correct.',
    EXIT.NETWORK
  );
}

function apiFailure(response: Response, payload: unknown): CliError {
  const envelope: ErrorEnvelope = payload !== null && typeof payload === 'object' ? (payload as ErrorEnvelope) : {};
  const code = typeof envelope.error?.code === 'string' ? envelope.error.code : undefined;
  const detail = typeof envelope.error?.message === 'string' && envelope.error.message !== ''
    ? envelope.error.message
    : typeof payload === 'string' && payload !== ''
      ? payload
      : response.statusText;
  const label = 'Request failed (' + response.status + (code ? ' ' + code : '') + ')';
  const exitCode = exitCodeForStatus(response.status, code);
  if (code === 'VERSION_CONFLICT' || (response.status === 409 && code === undefined)) {
    return new CliError(label + ' (document version conflict; read the latest version before retrying): ' + detail, exitCode);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const hint = retryAfter ? ' retry after ' + retryAfter + 's' : '';
    return new CliError(label + hint + ': ' + detail, exitCode);
  }
  return new CliError(label + ': ' + detail, exitCode);
}

/**
 * Thin JSON client for the versioned REST API. Writes are never retried:
 * callers see the first failure and decide what to do.
 */
export class ApiClient {
  readonly server: string;

  readonly origin: string;

  private readonly base: string;

  private readonly token?: string;

  private readonly timeoutMs: number;

  private readonly uploadTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    const trimmed = options.server.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw usageError('Invalid server URL: ' + options.server);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw usageError('Server URL must use http or https: ' + options.server);
    }
    const prefix = parsed.pathname.replace(/\/+$/, '');
    this.server = parsed.origin + prefix;
    this.origin = parsed.origin;
    this.base = this.server + '/api/v1';
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  }

  buildUrl(path: string, query?: Record<string, QueryValue>, absolute = false): URL {
    const suffix = path.startsWith('/') ? path : '/' + path;
    const url = new URL(absolute ? this.origin + suffix : this.base + suffix);
    if (query) {
      for (const [name, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(name, String(value));
      }
    }
    return url;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query, options.absolute === true);
    const headers = new Headers();
    headers.set('accept', 'application/json');
    for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }
    if (this.token) headers.set('authorization', 'Bearer ' + this.token);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw networkFailure(url, error, timeoutMs);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw networkFailure(url, error, timeoutMs);
    }
    const payload = parsePayload(text);
    if (!response.ok) throw apiFailure(response, payload);
    return payload as T;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  async upload(input: UploadInput): Promise<unknown> {
    const url = this.buildUrl('/uploads');
    const headers = new Headers();
    headers.set('accept', 'application/json');
    headers.set('content-type', input.contentType);
    headers.set('x-file-name', input.name);
    if (this.token) headers.set('authorization', 'Bearer ' + this.token);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers,
        body: new Uint8Array(input.data),
        signal: AbortSignal.timeout(this.uploadTimeoutMs)
      });
    } catch (error) {
      throw networkFailure(url, error, this.uploadTimeoutMs);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw networkFailure(url, error, this.uploadTimeoutMs);
    }
    const payload = parsePayload(text);
    if (!response.ok) throw apiFailure(response, payload);
    return payload;
  }
}
