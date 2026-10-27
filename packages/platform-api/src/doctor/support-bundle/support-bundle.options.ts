// The support bundle's options, part of `DoctorModuleOptions` (issue #772).
// Kept apart from doctor.module.ts so the service and the controller factory
// can read them without importing the module.

import type { SupportBundlePrincipal } from './support-bundle-section.interface';

/**
 * Ceiling for one section's `collect()` when it declares no `timeoutMs`, in
 * milliseconds.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_SECTION_TIMEOUT_MS = 10_000;

/**
 * A section whose serialized data is larger than this many bytes is replaced
 * by `{ status: 'ok', data: null, truncated: true }`.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_SECTION_MAX_BYTES = 512 * 1024;

/**
 * The whole bundle's ceiling, in bytes of pretty-printed JSON. Above it the
 * largest sections are truncated first until it fits.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The route path under the Doctor's own path (`admin/doctor/support-bundle`).
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_SUBPATH = 'support-bundle';

/**
 * The audit action of one download.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_AUDIT_ACTION = 'support_bundle:download';

/**
 * What an app passes as `DoctorModuleOptions.supportBundle`.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface SupportBundleOptions {
  /**
   * The app's slug, used in the download's filename
   * (`support-bundle-<appSlug>-<yyyyMMdd'T'HHmmss'Z'>.json`). Lowercase
   * letters, digits and dashes. Default `'app'`.
   */
  appSlug?: string;
  /**
   * Resolves the signed-in caller from the request, after the route's access
   * check has passed. Default: `request.requestUser`, then `request.user`,
   * when either has a string `id` and a string-array `permissions`. Returning
   * `null` refuses the download with 403.
   */
  principal?: (request: unknown) => SupportBundlePrincipal | null;
  /** Per-section ceiling when a section declares none, in milliseconds. Default {@link SUPPORT_BUNDLE_SECTION_TIMEOUT_MS}. */
  sectionTimeoutMs?: number;
}

/**
 * `SupportBundleOptions` with every default applied.
 *
 * @stability experimental
 */
export interface ResolvedSupportBundleOptions {
  /** `false` when the app passed `supportBundle: false`: no route, no built-in sections. */
  readonly enabled: boolean;
  /** The slug in the download's filename. */
  readonly appSlug: string;
  /** Resolves the caller from the request. */
  readonly principal: (request: unknown) => SupportBundlePrincipal | null;
  /** Per-section ceiling when a section declares none, in milliseconds. */
  readonly sectionTimeoutMs: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The default {@link SupportBundleOptions.principal}: `request.requestUser`,
 * then `request.user`, when either carries a string `id` and a string-array
 * `permissions` (the reference app's `RequestUser`).
 *
 * @param request - the framework request.
 * @returns the caller, or `null` when neither property has that shape.
 *
 * @stability experimental
 */
export function defaultSupportBundlePrincipal(request: unknown): SupportBundlePrincipal | null {
  if (request === null || typeof request !== 'object') return null;
  const { requestUser, user } = request as { requestUser?: unknown; user?: unknown };
  for (const candidate of [requestUser, user]) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const { id, permissions } = candidate as { id?: unknown; permissions?: unknown };
    if (typeof id === 'string' && id !== '' && isStringArray(permissions)) return { userId: id, permissions };
  }
  return null;
}

/**
 * Validates `supportBundle` and applies its defaults.
 *
 * @param options - what the app passed (`undefined`, `false` or an object).
 * @param fail - throws the module's own error.
 * @returns the resolved, frozen options.
 */
export function resolveSupportBundleOptions(
  options: SupportBundleOptions | false | undefined,
  fail: (why: string) => never,
): ResolvedSupportBundleOptions {
  if (options === false) {
    return Object.freeze({
      enabled: false,
      appSlug: 'app',
      principal: defaultSupportBundlePrincipal,
      sectionTimeoutMs: SUPPORT_BUNDLE_SECTION_TIMEOUT_MS,
    });
  }
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    fail('`supportBundle` must be an object or false');
  }
  const appSlug = options?.appSlug ?? 'app';
  if (typeof appSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(appSlug)) {
    fail('`supportBundle.appSlug` must be lowercase letters, digits and dashes');
  }
  const principal = options?.principal ?? defaultSupportBundlePrincipal;
  if (typeof principal !== 'function') fail('`supportBundle.principal` must be a function');
  const sectionTimeoutMs = options?.sectionTimeoutMs ?? SUPPORT_BUNDLE_SECTION_TIMEOUT_MS;
  if (typeof sectionTimeoutMs !== 'number' || !Number.isFinite(sectionTimeoutMs) || sectionTimeoutMs <= 0) {
    fail('`supportBundle.sectionTimeoutMs` must be a positive number of milliseconds');
  }
  return Object.freeze({ enabled: true, appSlug, principal, sectionTimeoutMs });
}
