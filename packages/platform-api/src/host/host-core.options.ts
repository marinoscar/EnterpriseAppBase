import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

import { definePlatformHost, type PlatformHost, type PortBinding } from '../core/index';
import type { EventBus } from './event-bus/event-bus.interface';
import { DEFAULT_MAINTENANCE_READ_PERMISSION, DEFAULT_MAINTENANCE_WRITE_PERMISSION } from './maintenance/maintenance.controller';

/**
 * A module `PlatformHostCoreModule.forRoot` imports for the app.
 *
 * @stability experimental
 */
export type PlatformHostCoreImport = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * `PlatformHostCoreModule.forRoot` options. Every one is optional: the
 * defaults are the reference app's behaviour.
 *
 * @stability experimental
 */
export interface PlatformHostCoreOptions {
  /**
   * The event bus adapter: `in-process`, `postgres` or the id of any adapter
   * the app registered with `registerEventBusAdapter` (case-insensitive).
   * Default: `EVENT_BUS_ADAPTER`, read when the bus is built. An id nobody
   * registered passed HERE fails the boot (naming the id and the registered
   * ones); an unregistered `EVENT_BUS_ADAPTER` falls back to `in-process` with
   * one warning (and a Doctor `warn`), because a typo in the environment must
   * not take the API down.
   */
  eventBusAdapter?: string;
  /**
   * A whole event bus, bound as `EVENT_BUS` for every consumer in the
   * application. Wins over `eventBusAdapter` and `EVENT_BUS_ADAPTER`, which are
   * then ignored. `PlatformHostCoreModule` is global, so this is the way to
   * replace the bus: a provider of `EVENT_BUS` in the app's own module would
   * never be seen by the host core's consumers.
   *
   * The binding is resolved in the host core's context: a `useFactory`'s
   * `inject` tokens and a `useClass`'s dependencies come from `imports` and
   * from global modules. Implement Nest's `OnModuleDestroy` on the instance if
   * it holds resources.
   *
   * @example
   * ```ts
   * PlatformHostCoreModule.forRoot({ eventBus: { useClass: RedisEventBus } });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  eventBus?: PortBinding<EventBus>;
  /**
   * The app's access decorators (`definePlatformHost(...)`), so the maintenance
   * routes are guarded exactly as the app's own admin routes are, and the health
   * probes carry the app's public marker. Omitted, the host's controllers use
   * the identity slice's `@Auth()` and `@Public()`, which is what the reference
   * app binds.
   *
   * @example
   * ```ts
   * PlatformHostCoreModule.forRoot({ host: platformHost });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  host?: PlatformHost;
  /**
   * The permission strings the maintenance routes enforce. Defaults:
   * `system_settings:read` for `GET /api/admin/maintenance` and
   * `system_settings:write` for `PUT`. An app that changes one must change the
   * Maintenance settings card's `permission` to the same string.
   *
   * @extensionPoint option
   * @stability experimental
   */
  permissions?: PlatformHostCorePermissions;
  /**
   * Whether the database-backed gauges (queue depth, oldest pending job, last
   * backup) register. Default: `OTEL_ENABLED === 'true'`, read when the
   * metrics host is built, so a process without the SDK never queries for them.
   */
  metricsGauges?: boolean;
  /** Extra modules the host core's providers need from the app (none by default). */
  imports?: PlatformHostCoreImport[];
}

/**
 * The permissions of the host's controllers.
 *
 * @stability experimental
 */
export interface PlatformHostCorePermissions {
  /** `GET /api/admin/maintenance`. Default `system_settings:read`. */
  maintenanceRead?: string;
  /** `PUT /api/admin/maintenance`. Default `system_settings:write`. */
  maintenanceWrite?: string;
}

/**
 * The options after defaults.
 *
 * @stability experimental
 */
export interface ResolvedPlatformHostCoreOptions {
  /** See {@link PlatformHostCoreOptions.eventBusAdapter}; `undefined` reads the environment. */
  readonly eventBusAdapter: string | undefined;
  /** See {@link PlatformHostCoreOptions.eventBus}; `undefined` builds the selected adapter. */
  readonly eventBus: PortBinding<EventBus> | undefined;
  /** See {@link PlatformHostCoreOptions.host}; `undefined` uses the identity slice's decorators. */
  readonly host: PlatformHost | undefined;
  /** See {@link PlatformHostCoreOptions.permissions}, defaults applied. */
  readonly permissions: Readonly<Required<PlatformHostCorePermissions>>;
  /** See {@link PlatformHostCoreOptions.metricsGauges}; `undefined` reads the environment. */
  readonly metricsGauges: boolean | undefined;
  /** See {@link PlatformHostCoreOptions.imports}. */
  readonly imports: readonly PlatformHostCoreImport[];
}

/**
 * Injection token of {@link ResolvedPlatformHostCoreOptions}.
 *
 * @stability experimental
 */
export const PLATFORM_HOST_CORE_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/host/OPTIONS');

/**
 * Applies defaults and validates.
 *
 * @param options - the raw options.
 * @returns the resolved, frozen options.
 * @throws Error when `eventBusAdapter` is not a string, `eventBus` is not a binding with exactly one
 *   of `useExisting`, `useClass` or `useFactory`, `host` is not a valid platform host, a permission
 *   is not a non-empty string, or `metricsGauges` is not a boolean.
 *
 * @stability experimental
 */
export function resolvePlatformHostCoreOptions(options: PlatformHostCoreOptions = {}): ResolvedPlatformHostCoreOptions {
  if (options.eventBusAdapter !== undefined && typeof options.eventBusAdapter !== 'string') {
    throw new Error('PlatformHostCoreModule.forRoot: eventBusAdapter must be a string');
  }
  if (options.eventBus !== undefined) {
    const binding = options.eventBus as unknown;
    const kinds =
      binding && typeof binding === 'object'
        ? ['useExisting', 'useClass', 'useFactory'].filter((kind) => kind in (binding as object))
        : [];
    if (kinds.length !== 1) {
      throw new Error('PlatformHostCoreModule.forRoot: eventBus needs exactly one of useExisting, useClass or useFactory');
    }
  }
  if (options.host !== undefined) {
    // Validates and freezes it now, so a bad host fails the boot rather than a route.
    definePlatformHost(options.host);
  }
  for (const [key, value] of Object.entries(options.permissions ?? {})) {
    if (key !== 'maintenanceRead' && key !== 'maintenanceWrite') {
      throw new Error(`PlatformHostCoreModule.forRoot: permissions.${key} is not a host permission (maintenanceRead, maintenanceWrite)`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`PlatformHostCoreModule.forRoot: permissions.${key} must be a non-empty string`);
    }
  }
  if (options.metricsGauges !== undefined && typeof options.metricsGauges !== 'boolean') {
    throw new Error('PlatformHostCoreModule.forRoot: metricsGauges must be a boolean');
  }
  return Object.freeze({
    eventBusAdapter: options.eventBusAdapter,
    eventBus: options.eventBus,
    host: options.host,
    permissions: Object.freeze({
      maintenanceRead: options.permissions?.maintenanceRead ?? DEFAULT_MAINTENANCE_READ_PERMISSION,
      maintenanceWrite: options.permissions?.maintenanceWrite ?? DEFAULT_MAINTENANCE_WRITE_PERMISSION,
    }),
    metricsGauges: options.metricsGauges,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
