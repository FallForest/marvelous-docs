export type ParsedVersion = number[];

function parseVersion(value: string): ParsedVersion {
  const core = value.replace(/^v/i, '').split(/[+-]/, 1)[0];
  return core.split('.').map(part => Number.parseInt(part, 10) || 0);
}

/**
 * Compare two dotted version strings. Build metadata and pre-release suffixes
 * are ignored; missing numeric segments count as zero.
 *
 * Returns a negative number when `left` is older, 0 when both are equal and a
 * positive number when `left` is newer.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
