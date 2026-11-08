import { writeFile } from 'node:fs/promises';
import { CliError, EXIT, messageOf } from './errors.js';

export type ColorName = 'green' | 'yellow' | 'red' | 'cyan' | 'dim' | 'bold';

const ANSI: Record<ColorName, string> = {
  green: '32',
  yellow: '33',
  red: '31',
  cyan: '36',
  dim: '2',
  bold: '1'
};

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export type Cell = string | { text: string; color?: ColorName };

export type Column = {
  header: string;
  align?: 'left' | 'right';
};

export type OutputOptions = {
  json: boolean;
  quiet: boolean;
  color: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
};

export function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const width_ = visibleLength(text);
  if (width_ >= width) return text;
  const filler = ' '.repeat(width - width_);
  return align === 'right' ? filler + text : text + filler;
}

/** ANSI colours only apply when stdout is a TTY and colours were not disabled. */
export function colorEnabled(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  return true;
}

export class Output {
  private readonly options: OutputOptions;

  constructor(options: OutputOptions) {
    this.options = options;
  }

  get json(): boolean {
    return this.options.json;
  }

  get quiet(): boolean {
    return this.options.quiet;
  }

  paint(text: string, color?: ColorName): string {
    if (!color || !this.options.color) return text;
    return '\u001b[' + ANSI[color] + 'm' + text + '\u001b[0m';
  }

  /** Essential stdout line: never suppressed. */
  line(text = ''): void {
    this.options.stdout.write(text + '\n');
  }

  /** Raw stdout payload without an added newline. */
  raw(text: string): void {
    this.options.stdout.write(text);
  }

  /** Notes and confirmations: suppressed by --quiet. */
  info(text: string): void {
    if (this.options.quiet) return;
    this.line(text);
  }

  success(text: string): void {
    this.info(this.paint(text, 'green'));
  }

  warn(text: string): void {
    if (this.options.quiet) return;
    this.options.stderr.write(this.paint('mdocs: ' + text, 'yellow') + '\n');
  }

  error(message: string): void {
    this.options.stderr.write('mdocs: ' + message + '\n');
  }

  /** Machine-readable success envelope: { ok, command, data }. */
  envelope(command: string, data: unknown): void {
    this.line(JSON.stringify({ ok: true, command, data }, null, 2));
  }

  /** Raw JSON payload without an envelope, for pipeable document data. */
  value(data: unknown): void {
    this.line(JSON.stringify(data, null, 2));
  }

  table(columns: Column[], rows: Cell[][]): void {
    if (rows.length === 0) {
      this.info('No results.');
      return;
    }
    const cells = rows.map(row => row.map(cell => (typeof cell === 'string' ? { text: cell } : cell)));
    const widths = columns.map((column, index) => Math.max(
      visibleLength(column.header),
      ...cells.map(row => visibleLength(row[index]?.text ?? ''))
    ));
    const header = columns
      .map((column, index) => {
        const text = column.header.toUpperCase();
        return index === columns.length - 1 ? text : pad(text, widths[index] ?? 0, column.align);
      })
      .join('  ');
    this.line(this.paint(header, 'dim'));
    for (const row of cells) {
      const text = columns
        .map((column, index) => {
          const cell = row[index] ?? { text: '' };
          const padded = index === columns.length - 1 ? cell.text : pad(cell.text, widths[index] ?? 0, column.align);
          return this.paint(padded, cell.color);
        })
        .join('  ');
      this.line(text);
    }
  }

  /** Writes to a file, or to stdout when destination is absent or "-". */
  async write(text: string, destination?: string): Promise<void> {
    if (destination === undefined || destination === '-' || destination === '') {
      this.raw(text);
      return;
    }
    try {
      await writeFile(destination, text, 'utf8');
    } catch (error) {
      throw new CliError('Cannot write ' + destination + ': ' + messageOf(error), EXIT.USAGE);
    }
    this.info('Wrote ' + destination);
  }
}
