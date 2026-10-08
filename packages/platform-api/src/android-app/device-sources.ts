// =============================================================================
// The device-source registry (issue #746, PP-9.4)
// =============================================================================
//
// Both apps listed the Android apps their paired devices actually run by
// grouping a DOMAIN table (EvoPath `health_sync_devices`, MemoriaHub
// `media_sync_devices`). The platform owns no device table: each native
// capability registers a source that reports its (packageName, signingSha256)
// pairs, and the service merges them by `trustedAppKey`. An app without a
// native capability registers nothing (or the reference app's empty source),
// and the list is empty.
// =============================================================================

import { defineRegistry, type Registry } from '../core/index';
import { normalizeSha256Fingerprint, trustedAppKey } from '@marinoscar/platform-contract/android-app';
import type { ReportedAndroidApp, TrustedAndroidApp } from '@marinoscar/platform-contract/android-app';

/**
 * One (package, signing key) pair a device source saw on its paired devices.
 *
 * @stability experimental
 */
export interface AndroidDeviceSourceRow {
  /** The application id the devices run. */
  packageName: string;
  /** The signing fingerprint they reported, in any accepted form. */
  signingSha256: string;
  /** How many active devices report the pair. */
  deviceCount: number;
  /** The latest sighting, or null. */
  lastSeenAt: Date | null;
}

/**
 * A native capability's paired devices, as the Android app page and the
 * doctor see them. Read-only: a source never writes.
 *
 * @stability experimental
 */
export interface AndroidDeviceSource {
  /** Stable id, lower kebab case (`health-sync`). */
  readonly id: string;
  /** Groups of (packageName, signingSha256) seen on active paired devices, with counts. */
  reportedApps(): Promise<AndroidDeviceSourceRow[]>;
  /**
   * How many active devices run `packageName` with a build older than
   * `versionCode`. Optional: a source that does not record the installed
   * build omits it, and the releases doctor check counts none behind for it.
   */
  devicesBehind?(packageName: string, versionCode: number): Promise<number>;
}

/**
 * Every registered device source, in registration order.
 *
 * @stability experimental
 */
export const androidDeviceSourceRegistry: Registry<AndroidDeviceSource> = defineRegistry<AndroidDeviceSource>({
  name: 'android-device-sources',
  idOf: (source) => source.id,
  idPattern: /^[a-z0-9][a-z0-9-]*$/,
  validate: (source) => {
    if (typeof source.reportedApps !== 'function') throw new Error('a device source needs reportedApps()');
    if (source.devicesBehind !== undefined && typeof source.devicesBehind !== 'function') {
      throw new Error('devicesBehind must be a function when present');
    }
  },
});

/**
 * Registers a device source: the seam a native capability (EvoPath's Health
 * Connect sync, MemoriaHub's media sync) plugs its paired devices in through.
 * Call it from the app's manifest, before `AndroidAppModule` composes.
 *
 * @param source - the source; its id must be unique.
 * @throws RegistryError on a duplicate or malformed source, or after the registries froze.
 *
 * @example
 * ```ts
 * registerAndroidDeviceSource({ id: 'health-sync', reportedApps: () => healthSyncDevices.reportedApps() });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAndroidDeviceSource(source: AndroidDeviceSource): void {
  androidDeviceSourceRegistry.register(source);
}

/**
 * Merges every source's rows by `trustedAppKey(packageName, sha256)`: counts
 * add, the latest sighting wins. Sorted as both apps did: most devices first,
 * then package name, then fingerprint. Untrusted pairs stay listed, so an
 * administrator can trust them.
 *
 * @param rows - every source's rows, concatenated.
 * @param trusted - the trusted list, to mark each pair.
 * @returns the merged, sorted list.
 *
 * @stability experimental
 */
export function mergeReportedApps(
  rows: readonly AndroidDeviceSourceRow[],
  trusted: readonly TrustedAndroidApp[],
): ReportedAndroidApp[] {
  const trustedKeys = new Set(trusted.map((app) => trustedAppKey(app.packageName, app.sha256)));
  const merged = new Map<string, { packageName: string; sha256: string; deviceCount: number; lastSeenAt: Date | null }>();
  for (const row of rows) {
    if (!row.packageName || !row.signingSha256) continue;
    const sha256 = normalizeSha256Fingerprint(row.signingSha256);
    const key = trustedAppKey(row.packageName, sha256);
    const existing = merged.get(key);
    if (existing) {
      existing.deviceCount += row.deviceCount;
      if (row.lastSeenAt && (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)) existing.lastSeenAt = row.lastSeenAt;
    } else {
      merged.set(key, { packageName: row.packageName, sha256, deviceCount: row.deviceCount, lastSeenAt: row.lastSeenAt });
    }
  }
  return [...merged.entries()]
    .map(([key, app]) => ({
      packageName: app.packageName,
      sha256: app.sha256,
      deviceCount: app.deviceCount,
      lastSeenAt: app.lastSeenAt ? app.lastSeenAt.toISOString() : null,
      trusted: trustedKeys.has(key),
    }))
    .sort(
      (a, b) => b.deviceCount - a.deviceCount || a.packageName.localeCompare(b.packageName) || a.sha256.localeCompare(b.sha256),
    );
}
