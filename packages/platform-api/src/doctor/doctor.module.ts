import { DynamicModule, Module } from '@nestjs/common';

import { definePlatformHost } from '../core/index';
import type { PlatformHost } from '../core/index';
import { PLATFORM_DOCTOR_CATEGORIES } from './doctor-check.interface';
import { DoctorCheckRegistry } from './doctor-check.registry';
import { createDoctorController } from './doctor.controller.factory';
import { DOCTOR_MODULE_OPTIONS, ResolvedDoctorModuleOptions } from './doctor.options';
import { DOCTOR_CACHE_TTL_MS, DOCTOR_DEFAULT_TIMEOUT_MS, DoctorService } from './doctor.service';
import { EgressRegistry } from './egress/egress.registry';
import { DoctorSupportBundleSection } from './support-bundle/sections/doctor.section';
import { EgressSupportBundleSection } from './support-bundle/sections/egress.section';
import { MetaSupportBundleSection } from './support-bundle/sections/meta.section';
import { createSupportBundleController } from './support-bundle/support-bundle.controller';
import { resolveSupportBundleOptions } from './support-bundle/support-bundle.options';
import type { SupportBundleOptions } from './support-bundle/support-bundle.options';
import { SupportBundleRegistry } from './support-bundle/support-bundle.registry';
import { SupportBundleService } from './support-bundle/support-bundle.service';

// =============================================================================
// DoctorModule.forRoot() (issue #634; packaged by #696)
// =============================================================================
//
// GLOBAL, so a feature module contributes a check by providing it — the check
// injects `DoctorCheckRegistry` and registers itself — WITHOUT importing this
// module. That keeps every edge one-way: features know the registry, the
// doctor knows no feature. Importing a feature module here instead would put
// the doctor in the middle of every module graph in the application.
//
// This module imports nothing of the app. The checks live in the app's owning
// modules, under `<module>/doctor/`, and reach their services through those
// modules' own providers. The route's access check comes from the app's host
// (`options.host`); without one, `forRoot` throws: the route is never public.
// =============================================================================

/**
 * The permission `GET /api/admin/doctor` requires unless an app passes another:
 * the existing `system_settings:read`. The report describes the deployment's
 * configuration, which is exactly what that permission already covers, and
 * every check is read-only, so there is no new capability to grant (no
 * `doctor:read`). A web settings card reaching the route must declare this same
 * literal (Settings UI Pattern rule 3).
 *
 * @stability stable
 */
export const DEFAULT_DOCTOR_PERMISSION = 'system_settings:read';

/**
 * The route path under the app's global prefix unless an app passes another.
 *
 * @stability stable
 */
export const DEFAULT_DOCTOR_PATH = 'admin/doctor';

/**
 * What an app passes to {@link DoctorModule.forRoot}.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DoctorModuleOptions {
  /** From definePlatformHost(); required. Without it forRoot throws: the route is never public. */
  host: PlatformHost;
  /** Permission required to read the report. Default {@link DEFAULT_DOCTOR_PERMISSION}. Must be a permission the app's RBAC grants. */
  permission?: string;
  /** Route path under the global prefix. Default {@link DEFAULT_DOCTOR_PATH} (`'admin/doctor'`). */
  path?: string;
  /** Category display/sort order. Default `PLATFORM_DOCTOR_CATEGORIES`; unknown categories sort after, in registration order. */
  categoryOrder?: readonly string[];
  /** Per-check ceiling when a check declares none, in milliseconds. Default 5_000. */
  defaultTimeoutMs?: number;
  /** Report cache TTL, in milliseconds. Default 15_000. */
  cacheTtlMs?: number;
  /**
   * The support bundle (`GET <path>/support-bundle`): the filename slug, how
   * the caller is resolved, the per-section timeout. Pass `false` for no
   * bundle route and no built-in sections (`SupportBundleRegistry` is still
   * provided, so sections an app registers need no change). Default: enabled.
   */
  supportBundle?: SupportBundleOptions | false;
}

function invalid(why: string): never {
  throw new Error(`DoctorModule.forRoot: ${why}.`);
}

function positive(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(`\`${name}\` must be a positive number of milliseconds`);
  return value;
}

/** Validates the options and applies every default. */
function resolveOptions(options: DoctorModuleOptions): ResolvedDoctorModuleOptions {
  if (!options || typeof options !== 'object' || options.host === undefined || options.host === null) {
    invalid(
      '`host` is required (pass the app\'s definePlatformHost(...)). Without it the doctor route would have ' +
        'no access check, and the route is never public',
    );
  }
  const host = definePlatformHost(options.host);

  const permission = options.permission ?? DEFAULT_DOCTOR_PERMISSION;
  if (typeof permission !== 'string' || permission.trim() === '') invalid('`permission` must be a non-empty string');

  const path = options.path ?? DEFAULT_DOCTOR_PATH;
  if (typeof path !== 'string' || path.trim() === '') invalid('`path` must be a non-empty string');

  const categoryOrder = options.categoryOrder ?? PLATFORM_DOCTOR_CATEGORIES;
  if (!Array.isArray(categoryOrder) || categoryOrder.some((c) => typeof c !== 'string' || c === '')) {
    invalid('`categoryOrder` must be an array of non-empty strings');
  }

  return Object.freeze({
    host,
    permission,
    path,
    categoryOrder: Object.freeze([...categoryOrder]),
    defaultTimeoutMs: positive(options.defaultTimeoutMs, 'defaultTimeoutMs', DOCTOR_DEFAULT_TIMEOUT_MS),
    cacheTtlMs: positive(options.cacheTtlMs, 'cacheTtlMs', DOCTOR_CACHE_TTL_MS),
    supportBundle: resolveSupportBundleOptions(options.supportBundle, invalid),
  });
}

/**
 * The admin Doctor: `GET /api/admin/doctor`, the check registry and the
 * service that runs it. Import it once, with {@link DoctorModule.forRoot}.
 *
 * @stability stable
 */
@Module({})
export class DoctorModule {
  /**
   * The Doctor, configured for one app: a global module providing
   * `DoctorCheckRegistry`, `DoctorService`, `DOCTOR_MODULE_OPTIONS`,
   * `EgressRegistry`, `SupportBundleRegistry` and `SupportBundleService`, with
   * the Doctor's and the support bundle's controllers created from the app's
   * host access decorators. The built-in `meta`, `doctor` and `egress` bundle
   * sections register themselves.
   *
   * @param options - see {@link DoctorModuleOptions}; `host` is required.
   * @returns the dynamic module to import in the app's root module.
   * @throws Error when `host` is missing or invalid (the route is never
   *   public), or an option is malformed.
   *
   * @example
   * ```ts
   * // apps/api/src/doctor/doctor.config.ts
   * export const doctorModule = DoctorModule.forRoot({ host: platformHost });
   * ```
   *
   * @extensionPoint option
   */
  static forRoot(options: DoctorModuleOptions): DynamicModule {
    const resolved = resolveOptions(options);

    const bundle = resolved.supportBundle.enabled;

    return {
      global: true,
      module: DoctorModule,
      controllers: [createDoctorController(resolved), ...(bundle ? [createSupportBundleController(resolved)] : [])],
      providers: [
        { provide: DOCTOR_MODULE_OPTIONS, useValue: resolved },
        DoctorCheckRegistry,
        DoctorService,
        // The egress inventory (#773): the registry every module's contributor
        // registers with. The `network.egress` check that reads it is the
        // app's to provide (`NetworkEgressDoctorCheck`), like every check.
        EgressRegistry,
        SupportBundleRegistry,
        ...(bundle
          ? [SupportBundleService, MetaSupportBundleSection, DoctorSupportBundleSection, EgressSupportBundleSection]
          : []),
      ],
      exports: [
        DoctorCheckRegistry,
        DoctorService,
        DOCTOR_MODULE_OPTIONS,
        EgressRegistry,
        SupportBundleRegistry,
        ...(bundle ? [SupportBundleService] : []),
      ],
    };
  }
}
