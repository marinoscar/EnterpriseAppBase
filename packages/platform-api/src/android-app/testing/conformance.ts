import type { Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ANDROID_RELEASES_KEY_PREFIX } from '@marinoscar/platform-contract/android-app';

import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../identity/index';
import { notificationChannelRegistry } from '../../notifications/index';
import { storageKeyPrefixRegistry } from '../../storage/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { AndroidAppController } from '../android-app.controller';
import { AssetLinksController } from '../asset-links.controller';
import { AndroidReleaseAdminController } from '../releases/android-release-admin.controller';
import { AndroidReleaseController } from '../releases/android-release.controller';
import { ONE_CURRENT_RELEASE_INDEX } from '../releases/android-release.service';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The android-app slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/android-app/testing`. */
    'android-app'?: AndroidAppConformanceOptions | false;
  }
}

/**
 * What the `android-app` suite takes: the app's data, never its code.
 *
 * @stability experimental
 */
export interface AndroidAppConformanceOptions {
  /**
   * The names of the raw-SQL indexes the app's migrations install (the
   * reference app passes `RAW_SQL_INDEXES` of `@marinoscar/platform-db`), so
   * the suite proves the one-current index is on the tripwire list.
   */
  readonly rawSqlIndexNames: readonly string[];
  /** Whether the app declared the `android_app` channel (default true). */
  readonly expectAndroidAppChannel?: boolean;
}

/**
 * One route of the slice, as the suite sees it.
 *
 * @stability experimental
 */
export interface AndroidAppRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The HTTP method name. */
  readonly method: string;
  /** Whether it is `@Public()`. */
  readonly isPublic: boolean;
  /** Whether it is authenticated (`@Auth(...)` put a guard on it). */
  readonly authenticated: boolean;
  /** The permissions it requires. */
  readonly permissions: readonly string[];
}

const ADMIN_PERMISSIONS = new Set(['system_settings:read', 'system_settings:write']);

/**
 * The routes of the slice's four controllers, read from their metadata.
 *
 * @returns every handler.
 *
 * @stability experimental
 */
export function discoverAndroidAppRoutes(): AndroidAppRoute[] {
  const controllers: Array<Type<unknown>> = [AndroidAppController, AssetLinksController, AndroidReleaseAdminController, AndroidReleaseController];
  const routes: AndroidAppRoute[] = [];
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const guards = [...((Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[]), ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
      routes.push({
        id: `${controller.name}#${name}`,
        method: RequestMethod[method] ?? String(method),
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true,
        authenticated: guards.length > 0,
        permissions: [...((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as string[])],
      });
    }
  }
  return routes;
}

/**
 * Every invariant of the slice, as findings.
 *
 * @param options - the suite's options.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkAndroidApp(options: AndroidAppConformanceOptions): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const route of discoverAndroidAppRoutes()) {
    const isAssetLinks = route.id.startsWith(`${AssetLinksController.name}#`);
    const isDownload = route.id === `${AndroidReleaseController.name}#download`;
    if (isAssetLinks) {
      if (!route.isPublic) findings.push({ file: route.id, message: 'assetlinks must be @Public(): Chrome and the verifier fetch it unauthenticated' });
      if (route.method !== 'GET') findings.push({ file: route.id, message: 'assetlinks must be read-only (GET only)' });
      continue;
    }
    if (isDownload) {
      if (!route.isPublic || route.method !== 'GET') findings.push({ file: route.id, message: 'the signed download must be a public GET (the token is the credential)' });
      continue;
    }
    if (route.isPublic) findings.push({ file: route.id, message: 'only assetlinks and the signed download may be public' });
    if (!route.authenticated) findings.push({ file: route.id, message: 'declares no @Auth(...)' });
    const isAdmin = route.id.startsWith(`${AndroidAppController.name}#`) || route.id.startsWith(`${AndroidReleaseAdminController.name}#`);
    if (isAdmin) {
      const wanted = route.method === 'GET' ? 'system_settings:read' : 'system_settings:write';
      if (route.permissions.length !== 1 || route.permissions[0] !== wanted) {
        findings.push({ file: route.id, message: `admin route must require exactly ${wanted} (got ${route.permissions.join(', ') || 'none'})` });
      }
    } else if (route.permissions.some((permission) => ADMIN_PERMISSIONS.has(permission))) {
      findings.push({ file: route.id, message: 'a user route must not require an admin permission' });
    }
  }
  if (!options.rawSqlIndexNames.includes(ONE_CURRENT_RELEASE_INDEX)) {
    findings.push({ file: 'raw-sql-indexes', message: `${ONE_CURRENT_RELEASE_INDEX} is not on the raw-SQL index list` });
  }
  const prefix = storageKeyPrefixRegistry.list().find((def) => def.prefix === ANDROID_RELEASES_KEY_PREFIX);
  if (!prefix) findings.push({ file: 'storage-key-prefixes', message: `${ANDROID_RELEASES_KEY_PREFIX} is not registered (registerAndroidAppKeyPrefixes)` });
  else if (prefix.survivesFactoryReset !== true) findings.push({ file: 'storage-key-prefixes', message: `${ANDROID_RELEASES_KEY_PREFIX} must survive the factory reset` });
  if (options.expectAndroidAppChannel !== false && notificationChannelRegistry.get('android_app')?.coveredBy !== 'push') {
    findings.push({ file: 'notification-channels', message: 'the android_app channel is not registered covered by push (registerAndroidAppNotificationChannel)' });
  }
  return findings;
}

/**
 * The `android-app` conformance suite.
 *
 * @stability experimental
 */
export const androidAppConformanceSuite: ConformanceSuite<AndroidAppConformanceOptions> = {
  id: 'android-app',
  title: 'the android-app slice keeps its invariants',
  description:
    'assetlinks is public and read-only, the signed download is the only other public route, admin routes require exactly system_settings:read/write, the one-current index is on the raw-SQL list, android-releases/ survives the factory reset and the android_app channel is covered by push.',
  check(_context, options): ConformanceReport {
    const routes = discoverAndroidAppRoutes();
    return {
      scanned: { routes: routes.length },
      scannedFiles: { routes: routes.map((route) => route.id) },
      findings: checkAndroidApp(options),
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'routes: assetlinks public and read-only, admin routes permissioned with system_settings:*',
        run: (report, expect) => {
          expect(report.findings.filter((f) => !['raw-sql-indexes', 'storage-key-prefixes', 'notification-channels'].includes(f.file))).toEqual([]);
        },
      },
      {
        name: 'data: the one-current index is on the raw-SQL index list',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'raw-sql-indexes')).toEqual([]);
        },
      },
      {
        name: 'storage: android-releases/ is registered and survives the factory reset',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'storage-key-prefixes')).toEqual([]);
        },
      },
      {
        name: 'notifications: the android_app channel is registered, covered by push',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'notification-channels')).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(androidAppConformanceSuite.id)) conformanceSuites.register(androidAppConformanceSuite);
