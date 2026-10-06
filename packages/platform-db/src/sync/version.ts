function parse(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compares two `x.y.z` versions.
 *
 * @param a - The first version.
 * @param b - The second version.
 * @returns Negative, zero or positive, like `Array.prototype.sort`.
 * @stability experimental
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/**
 * The version a newly promoted migration ships in: the next minor after the
 * package's current version, or the newest `since` already in the manifest
 * when that is higher (several migrations of one release share a version).
 *
 * @param packageVersion - `version` of the package's `package.json`.
 * @param sinceValues - The `since` of every manifest entry.
 * @returns A version, for example `0.1.0`.
 * @stability experimental
 */
export function nextPlatformVersion(packageVersion: string, sinceValues: readonly string[]): string {
  const [major, minor] = parse(packageVersion);
  const next = `${major}.${minor! + 1}.0`;
  return sinceValues.reduce((best, since) => (compareVersions(since, best) > 0 ? since : best), next);
}
