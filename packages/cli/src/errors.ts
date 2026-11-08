/**
 * Error taxonomy for the CLI. Every failure carries the process exit code that
 * documents it in README.md:
 *
 *   0 success, 1 general failure, 2 usage, 3 network/server,
 *   4 authentication/permission, 5 version conflict, 6 not found
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NETWORK: 3,
  AUTH: 4,
  CONFLICT: 5,
  NOT_FOUND: 6
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.ERROR) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.USAGE);
}

export function networkError(message: string): CliError {
  return new CliError(message, EXIT.NETWORK);
}

export function authError(message: string): CliError {
  return new CliError(message, EXIT.AUTH);
}

export function conflictError(message: string): CliError {
  return new CliError(message, EXIT.CONFLICT);
}

export function notFoundError(message: string): CliError {
  return new CliError(message, EXIT.NOT_FOUND);
}
