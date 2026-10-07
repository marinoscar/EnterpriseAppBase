// The Doctor module's resolved options and their injection token (issue #696).
// Kept apart from doctor.module.ts so the service and the controller factory
// can read them without importing the module that imports them.

import type { PlatformHost } from '../core/index';
import type { ResolvedSupportBundleOptions } from './support-bundle/support-bundle.options';

/**
 * Injection token of the Doctor's resolved options ({@link ResolvedDoctorModuleOptions}).
 * Inject it in a provider of the app that needs the configured permission,
 * path, category order, timeout or cache TTL.
 *
 * @example
 * ```ts
 * constructor(@Inject(DOCTOR_MODULE_OPTIONS) private readonly doctor: ResolvedDoctorModuleOptions) {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DOCTOR_MODULE_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/doctor/DOCTOR_MODULE_OPTIONS');

/**
 * `DoctorModuleOptions` with every default applied, as `DoctorModule.forRoot`
 * provides it under {@link DOCTOR_MODULE_OPTIONS}.
 *
 * @stability experimental
 */
export interface ResolvedDoctorModuleOptions {
  /** The validated, frozen platform host. */
  readonly host: PlatformHost;
  /** The permission `GET <path>` requires. */
  readonly permission: string;
  /** The route path under the global prefix. */
  readonly path: string;
  /** Category display and sort order. */
  readonly categoryOrder: readonly string[];
  /** Per-check ceiling when a check declares none, in milliseconds. */
  readonly defaultTimeoutMs: number;
  /** How long a report is served from memory, in milliseconds. */
  readonly cacheTtlMs: number;
  /** The support bundle's resolved options (`GET <path>/support-bundle`). */
  readonly supportBundle: ResolvedSupportBundleOptions;
}
