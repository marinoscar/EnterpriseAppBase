import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

/**
 * A module `AndroidAppModule.forRoot` imports for the app.
 *
 * @stability experimental
 */
export type AndroidAppImport = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * `AndroidAppModule.forRoot` options.
 *
 * @stability experimental
 */
export interface AndroidAppModuleOptions {
  /** The product name, used in the test notification's title. Required. */
  appName: string;
  /**
   * The downloaded APK's file-name stem: `<apkStem>-<versionName>.apk`. The
   * reference app passes `androidIdentity(identity).apkStem` (default
   * `<repoSlug>-android`). Lower kebab case.
   */
  apkStem: string;
  /** Where the test notification's tap lands (root-relative). Default `/`. */
  testNotificationLink?: string;
  /** Extra modules the slice needs from the app (none by default). */
  imports?: AndroidAppImport[];
}

/**
 * The options after defaults and validation.
 *
 * @stability experimental
 */
export interface ResolvedAndroidAppModuleOptions {
  /** See {@link AndroidAppModuleOptions.appName}. */
  readonly appName: string;
  /** See {@link AndroidAppModuleOptions.apkStem}. */
  readonly apkStem: string;
  /** See {@link AndroidAppModuleOptions.testNotificationLink}. */
  readonly testNotificationLink: string;
  /** See {@link AndroidAppModuleOptions.imports}. */
  readonly imports: readonly AndroidAppImport[];
}

/**
 * Injection token of {@link ResolvedAndroidAppModuleOptions}.
 *
 * @stability experimental
 */
export const ANDROID_APP_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/android-app/OPTIONS');

const APK_STEM = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Applies defaults and validates.
 *
 * @param options - the raw options.
 * @returns the resolved options.
 * @throws Error when `appName` is empty, `apkStem` is not lower kebab case or the link is not root-relative.
 *
 * @stability experimental
 */
export function resolveAndroidAppModuleOptions(options: AndroidAppModuleOptions): ResolvedAndroidAppModuleOptions {
  if (typeof options?.appName !== 'string' || options.appName.trim() === '') {
    throw new Error('AndroidAppModule.forRoot: appName is required');
  }
  if (typeof options.apkStem !== 'string' || !APK_STEM.test(options.apkStem)) {
    throw new Error(`AndroidAppModule.forRoot: apkStem must match ${APK_STEM} (got ${JSON.stringify(options.apkStem)})`);
  }
  const link = options.testNotificationLink ?? '/';
  if (!link.startsWith('/') || link.startsWith('//')) {
    throw new Error('AndroidAppModule.forRoot: testNotificationLink must be root-relative');
  }
  return Object.freeze({
    appName: options.appName.trim(),
    apkStem: options.apkStem,
    testNotificationLink: link,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
