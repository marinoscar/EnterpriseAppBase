import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================================
// The platform CLI's own version, read at runtime  (#715)
// =============================================================================
//
// Not the APP's version: that one arrives through `createCli({ version })`
// (identity.ts, `cliVersion()`), because this package's package.json is the
// platform's. `--version` prints both: `<app> (platform <this>)`.
//
// Both `src/engine/package-info.ts` (vitest) and `dist/engine/package-info.js`
// (the build) sit exactly two directories below the package root, so the same
// `../../package.json` resolves in both. Read rather than imported as JSON: an
// import from outside `src/` would widen tsc's root and move the build output.
// =============================================================================

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const parsed: unknown = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    // An unusual install, not a reason to refuse to run.
  }
  return '0.0.0-unknown';
}

/**
 * The installed `@marinoscar/platform-cli` version.
 *
 * @stability experimental
 */
export const PLATFORM_CLI_VERSION = readVersion();
