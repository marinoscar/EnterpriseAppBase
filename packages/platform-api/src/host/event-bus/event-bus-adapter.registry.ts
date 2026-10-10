// =============================================================================
// The event bus adapter registry (PP-14.2, issue #920)
// =============================================================================
//
// Rung 2 of the extension contract. `PlatformHostCoreModule.forRoot()` builds
// the process's one bus by looking the selected adapter id up here
// (`EVENT_BUS_ADAPTER`, or the `eventBusAdapter` option). The platform's own two
// adapters, `in-process` and `postgres`, register through the SAME function an
// app uses (`./builtin-event-bus-adapters.ts`), so there is no private fast path.
//
// An app (or a package it installs) registers an adapter AT IMPORT TIME, before
// the application bootstraps: the bus is built while the container is being
// created, and the registry freezes once the application has bootstrapped
// (`RegistryFreezeService`). Registering from `apps/api/src/app-registrations/`
// is the convention.
//
// Which adapter backs the bus is deployment topology, not a runtime setting, so
// there is deliberately no settings namespace and no admin form for it.
// =============================================================================

import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { defineRegistry, type Registry } from '../../core/index';
import type { EventBus } from './event-bus.interface';
import type { EventBusMetrics } from './event-bus.metrics';
import type { EventBusSqlPublisher } from './postgres-event-bus';

/**
 * The id pattern of an event bus adapter: lower-case, 2 to 32 characters,
 * starting with a letter (`in-process`, `postgres`, `redis`).
 *
 * @stability experimental
 */
export const EVENT_BUS_ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * What an adapter's {@link EventBusAdapterDef.create} receives.
 *
 * @stability experimental
 */
export interface EventBusAdapterContext {
  /** The id the adapter was selected by (the registered `id`). */
  readonly id: string;
  /** The application's configuration, for the adapter's own settings (a Redis URL, a key prefix). */
  readonly config: ConfigService;
  /** A logger named for the bus; use it instead of creating a second one. */
  readonly logger: Logger;
  /**
   * The app's Prisma client (`PLATFORM_PRISMA`) when it is bound; `undefined`
   * otherwise. Only an adapter that rides on the database needs it.
   */
  readonly prisma: EventBusSqlPublisher | undefined;
  /**
   * The `app.event_bus.*` counters, already labelled with this adapter's id.
   * Pass it to the adapter so its publishes and deliveries are counted.
   */
  readonly metrics: EventBusMetrics;
}

/**
 * One event bus adapter.
 *
 * The bus it returns must honour the rules at the top of `event-bus.interface.ts`
 * (local delivery on every adapter, JSON round trip, isolated handlers, a
 * `publish` that never rejects, an oversize payload refused locally) and
 * `describeEventBusConformance` (`@marinoscar/platform-api/host/testing`)
 * checks them. If it needs a lifecycle, implement Nest's `OnModuleInit` and
 * `OnModuleDestroy` on it: they run on the instance `create` returns.
 *
 * @stability experimental
 */
export interface EventBusAdapterDef {
  /** The id operators select it by (`EVENT_BUS_ADAPTER=redis`). See {@link EVENT_BUS_ADAPTER_ID_PATTERN}. */
  readonly id: string;
  /** A short human label, for logs and the Doctor (`Redis pub/sub`). */
  readonly label: string;
  /**
   * Builds the bus. Called once per process, while the container is created.
   * May be async; keep it free of long I/O (start a listener from
   * `onModuleInit`, never block boot).
   *
   * @param ctx - see {@link EventBusAdapterContext}.
   * @returns the bus, or a promise of it.
   */
  create(ctx: EventBusAdapterContext): EventBus | Promise<EventBus>;
}

/**
 * Every registered event bus adapter, in registration order (the two built-ins
 * first). Frozen when the application has bootstrapped.
 *
 * @stability experimental
 */
export const eventBusAdapterRegistry: Registry<EventBusAdapterDef> = defineRegistry<EventBusAdapterDef>({
  name: 'host.event-bus-adapters',
  idOf: (adapter) => adapter.id,
  idPattern: EVENT_BUS_ADAPTER_ID_PATTERN,
  validate: (adapter) => {
    if (typeof adapter.label !== 'string' || adapter.label.trim() === '') {
      throw new Error(`event bus adapter "${adapter.id}": label must be a non-empty string`);
    }
    if (typeof adapter.create !== 'function') {
      throw new Error(`event bus adapter "${adapter.id}": create must be a function`);
    }
  },
});

/**
 * Registers an event bus adapter. Call it at module load, before the
 * application is created; a duplicate id throws.
 *
 * @param adapter - the adapter.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerEventBusAdapter({
 *   id: 'redis',
 *   label: 'Redis pub/sub',
 *   create: ({ config, logger }) => new RedisEventBus(config.getOrThrow('redis.url'), logger),
 * });
 * // then: EVENT_BUS_ADAPTER=redis, or PlatformHostCoreModule.forRoot({ eventBusAdapter: 'redis' })
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerEventBusAdapter(adapter: EventBusAdapterDef): void {
  eventBusAdapterRegistry.register(adapter);
}

/**
 * The boot error for an adapter id nobody registered: names the id and lists
 * the registered ones.
 *
 * @param id - the id that was asked for.
 * @returns the error.
 *
 * @stability experimental
 */
export function unknownEventBusAdapterError(id: string): Error {
  return new Error(
    `Unknown event bus adapter "${id}". Registered adapters: ${eventBusAdapterRegistry.ids().join(', ') || '(none)'}. ` +
      'Register one with registerEventBusAdapter() at import time, before the application is created.',
  );
}
