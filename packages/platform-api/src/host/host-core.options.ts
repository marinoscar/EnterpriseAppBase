import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

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
   * The event bus adapter, `in-process` or `postgres` (case-insensitive).
   * Default: `EVENT_BUS_ADAPTER`, read when the bus is built. Unrecognised
   * falls back to `in-process` with one warning (and a Doctor `warn`).
   */
  eventBusAdapter?: string;
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
 * The options after defaults.
 *
 * @stability experimental
 */
export interface ResolvedPlatformHostCoreOptions {
  /** See {@link PlatformHostCoreOptions.eventBusAdapter}; `undefined` reads the environment. */
  readonly eventBusAdapter: string | undefined;
  /** See {@link PlatformHostCoreOptions.metricsGauges}; `undefined` reads the environment. */
  readonly metricsGauges: boolean | undefined;
  /** See {@link PlatformHostCoreOptions.imports}. */
  readonly imports: readonly PlatformHostCoreImport[];
}

/**
 * Injection token of {@link ResolvedPlatformHostCoreOptions}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const PLATFORM_HOST_CORE_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/host/OPTIONS');

/**
 * Applies defaults and validates.
 *
 * @param options - the raw options.
 * @returns the resolved, frozen options.
 * @throws Error when `eventBusAdapter` is not a string or `metricsGauges` not a boolean.
 *
 * @stability experimental
 */
export function resolvePlatformHostCoreOptions(options: PlatformHostCoreOptions = {}): ResolvedPlatformHostCoreOptions {
  if (options.eventBusAdapter !== undefined && typeof options.eventBusAdapter !== 'string') {
    throw new Error('PlatformHostCoreModule.forRoot: eventBusAdapter must be a string');
  }
  if (options.metricsGauges !== undefined && typeof options.metricsGauges !== 'boolean') {
    throw new Error('PlatformHostCoreModule.forRoot: metricsGauges must be a boolean');
  }
  return Object.freeze({
    eventBusAdapter: options.eventBusAdapter,
    metricsGauges: options.metricsGauges,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
