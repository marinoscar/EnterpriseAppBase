/**
 * A semantic version as the platform writes it: `x.y.z`, optionally followed by
 * a prerelease (`-next.1`) and build metadata (`+sha`). Prerelease packages
 * (`0.1.0-next.1`) are published, so the lock, the manifest and the version
 * comparisons all accept them.
 *
 * @stability experimental
 */
export const SEMVER_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
