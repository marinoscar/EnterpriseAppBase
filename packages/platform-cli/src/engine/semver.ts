// =============================================================================
// Strict semver 2.0.0 parsing and precedence  (issue #1033)
// =============================================================================
//
// The update notice compares the running version with a version read from the
// network or from a cache file, so BOTH sides must be proven well formed before
// they are compared or printed: the value ends up on a terminal, and a string
// that merely looks like a version could carry an escape sequence. A strict
// parse is the filter.
//
// This is not `deploy/app-version.ts`'s `parseSemVer`, which accepts only
// `x.y.z` because the deploy's version step writes plain release numbers. The
// notice has to order prereleases (`1.2.3-rc.1` < `1.2.3`), so it follows the
// precedence rules of semver.org §11 in full. Build metadata (`+build`) is
// accepted and ignored by precedence, as the spec says.
// =============================================================================

/** A parsed semantic version. */
export interface ParsedSemver {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  /** Dot-separated prerelease identifiers; empty for a release. */
  readonly prerelease: readonly string[];
}

/** The reference expression of semver.org (numbers without leading zeros). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** No real version is longer; bounds the work done on an untrusted string. */
const MAX_VERSION_LENGTH = 128;

/**
 * Parses a semantic version strictly: no leading `v`, no surrounding space.
 *
 * @param value - The candidate.
 * @returns The parsed version, or `undefined` when `value` is not a valid
 *   semver 2.0.0 string.
 */
export function parseSemver(value: unknown): ParsedSemver | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VERSION_LENGTH) return undefined;
  const match = SEMVER.exec(value);
  if (match === null) return undefined;
  return {
    major: match[1] as string,
    minor: match[2] as string,
    patch: match[3] as string,
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Compares two digit strings without leading zeros, with no overflow. */
function compareNumeric(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

const NUMERIC = /^\d+$/;

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks any prerelease of the same x.y.z.
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a[i] as string;
    const right = b[i] as string;
    if (left === right) continue;
    const leftNumeric = NUMERIC.test(left);
    const rightNumeric = NUMERIC.test(right);
    if (leftNumeric && rightNumeric) return compareNumeric(left, right);
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return left < right ? -1 : 1;
  }
  // All shared identifiers equal: the longer set has the higher precedence.
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * Orders two parsed versions by semver precedence.
 *
 * @returns Negative when `a` is older than `b`, positive when newer, 0 when equal.
 */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  return (
    compareNumeric(a.major, b.major) ||
    compareNumeric(a.minor, b.minor) ||
    compareNumeric(a.patch, b.patch) ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

/**
 * Whether `candidate` is strictly newer than `current`. `false` when either is
 * not a valid semver string, so a malformed value can never produce a notice.
 *
 * @param candidate - The version offered.
 * @param current - The version running.
 */
export function isNewerVersion(candidate: unknown, current: unknown): boolean {
  const left = parseSemver(candidate);
  const right = parseSemver(current);
  if (left === undefined || right === undefined) return false;
  return compareSemver(left, right) > 0;
}
