import { resolveApiVersion as resolvePlatformApiVersion } from '@marinoscar/platform-api/host';

/**
 * The version stamped into `info.version`, the about report and the telemetry
 * resource: `APP_VERSION`, then `npm_package_version`, then this app's
 * `package.json`, found by walking up from this directory (the walk is the
 * host slice's `resolveApiVersion`, #867). Never throws; `'0.0.0'` when
 * nothing resolves.
 */
export function resolveApiVersion(): string {
  return resolvePlatformApiVersion(__dirname);
}
