import { SEMVER_PATTERN } from '../lock/index.js';

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

function parse(version: string): Parsed {
  const m = SEMVER_PATTERN.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

const isNumeric = (id: string): boolean => /^\d+$/.test(id);

/**
 * Compares two versions by semantic-version precedence: the three numbers
 * first, then a version without a prerelease outranks one with it
 * (`1.0.0` outranks `1.0.0-next.9`), then prerelease identifiers left to right
 * (numeric ones numerically and below alphanumeric ones, a longer list above
 * its prefix). Build metadata is ignored.
 *
 * @param a - The first version.
 * @param b - The second version.
 * @returns Negative, zero or positive, like `Array.prototype.sort`.
 * @throws Error when either is not a version.
 * @stability experimental
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) if (pa.core[i] !== pb.core[i]) return pa.core[i]! - pb.core[i]!;
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i += 1) {
    const x = pa.pre[i]!;
    const y = pb.pre[i]!;
    if (x === y) continue;
    if (isNumeric(x) && isNumeric(y)) return Number(x) - Number(y);
    if (isNumeric(x)) return -1;
    if (isNumeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  return pa.pre.length - pb.pre.length;
}

/**
 * The version a newly promoted migration ships in. For a stable package
 * version it is the next minor; for a prerelease (`0.1.0-next.1`) it is the
 * release that prerelease leads to (`0.1.0`). The newest `since` already in the
 * manifest wins when it is higher (several migrations of one release share a
 * version).
 *
 * @param packageVersion - `version` of the package's `package.json`.
 * @param sinceValues - The `since` of every manifest entry.
 * @returns A stable version, for example `0.1.0`.
 * @stability experimental
 */
export function nextPlatformVersion(packageVersion: string, sinceValues: readonly string[]): string {
  const { core, pre } = parse(packageVersion);
  const next = pre.length > 0 ? `${core[0]}.${core[1]}.${core[2]}` : `${core[0]}.${core[1] + 1}.0`;
  return sinceValues.reduce((best, since) => (compareVersions(since, best) > 0 ? since : best), next);
}
