/**
 * `@marinoscar/platform-infra`: the platform's Compose fragments, nginx
 * configuration and env templates, the app overlay order, and identity
 * rendering. The files ship in the package and are materialised into the app
 * by `platform-infra sync`.
 *
 * @packageDocumentation
 */
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export { PLATFORM_PACKAGE } from './package-name.js';
export type { InfraFile, InfraFragmentFiles } from './fragment.js';
export type { PlatformInfraFragment } from './fragments.js';
export { composeInfraFragment, envInfraFragment, nginxInfraFragment } from './fragments.js';
export type { ComposeFilesOptions, ComposeMode } from './compose-order.js';
export { appComposeOverlays, COMPOSE_MODES, composeFilesForMode } from './compose-order.js';
export type { InfraIdentity, InfraIdentityInput } from './identity.js';
export { DEFAULT_WORKER_IMAGE, deriveInfraIdentity, INFRA_PLACEHOLDERS, renderInfraText } from './identity.js';

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
