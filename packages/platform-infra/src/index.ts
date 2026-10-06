import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The npm name of this package, which holds Compose fragments, nginx and OpenTelemetry collector configuration of the platform.
 *
 * A placeholder export so the build, the pack check and the smoke imports in
 * CI have something to load end to end. Real slices arrive as subpath
 * exports (`@marinoscar/platform-infra/<slice>`).
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-infra' as const;

/**
 * The package root as a URL. `../` from this module is the package root both
 * from the built `dist/index.js` and from `src/index.ts` under the tests.
 */
const PACKAGE_ROOT_URL = new URL('../', import.meta.url);
const PACKAGE_ROOT = fileURLToPath(PACKAGE_ROOT_URL);

/**
 * Absolute path of a file shipped inside this package, for example
 * `infraFile('compose/base.compose.yml')`, so a consumer can hand it to
 * `docker compose -f` without knowing where npm installed the package.
 *
 * @param relativePath - Path relative to the package root, using `/`.
 * @returns The absolute filesystem path.
 * @throws Error when `relativePath` is empty, absolute, or resolves outside
 *   the package root (for example `../../etc/passwd`).
 * @stability experimental
 */
export function infraFile(relativePath: string): string {
  if (relativePath.trim() === '' || isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new Error(`infraFile: expected a path relative to the package root, got "${relativePath}"`);
  }
  const encoded = relativePath.split(/[\\/]/).map(encodeURIComponent).join('/');
  const resolved = fileURLToPath(new URL(encoded, PACKAGE_ROOT_URL));
  const fromRoot = relative(PACKAGE_ROOT, resolved);
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`infraFile: "${relativePath}" resolves outside @marinoscar/platform-infra`);
  }
  return resolved;
}
