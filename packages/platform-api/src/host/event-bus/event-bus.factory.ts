import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppMetricsService, fallbackAppMetrics } from '../metrics/app-metrics.service';
import './builtin-event-bus-adapters';
import { eventBusAdapterRegistry, unknownEventBusAdapterError } from './event-bus-adapter.registry';
import { type EventBusSelection, parseEventBusAdapter } from './event-bus.config';
import type { EventBus } from './event-bus.interface';
import { eventBusMetricsVia } from './event-bus.metrics';
import type { EventBusSqlPublisher } from './postgres-event-bus';

// =============================================================================
// The process's one event bus (PP-1.11, issue #682; packaged by #867)
// =============================================================================
//
// `PlatformHostCoreModule.forRoot()` provides `EVENT_BUS` globally through
// these two factories, so `@Inject(EVENT_BUS)` works in every module without
// an import edge: the bus is infrastructure in the same sense the database is.
//
// The adapter is looked up by id in `eventBusAdapterRegistry`: the built-ins
// and any adapter the app registered with `registerEventBusAdapter` (PP-14.2).
// An app may also bind a whole bus instead (`forRoot({ eventBus })`), which
// bypasses this file.
//
// ONE INSTANCE PER PROCESS. The adapter's origin id is what lets a Postgres
// listener drop its own echo; two instances in one process would each treat
// the other's messages as remote and deliver them twice.
//
// The Postgres adapter's lifecycle hooks run on the factory-built instance:
// it starts listening in `onModuleInit` (without blocking boot) and closes its
// session in `onModuleDestroy`.
// =============================================================================

const logger = new Logger('EventBusModule');

/**
 * What {@link selectEventBus} may be told.
 *
 * @stability experimental
 */
export interface SelectEventBusOptions {
  /**
   * Throw for an unregistered id instead of falling back to `in-process`.
   * `PlatformHostCoreModule` sets it for the `eventBusAdapter` option (code, so
   * a wrong id is a programming error) and leaves it off for the
   * `EVENT_BUS_ADAPTER` environment variable (a typo there must not take the
   * API down).
   */
  strict?: boolean;
}

/**
 * Parses the configured adapter and warns once about an unregistered value.
 *
 * @param raw - the configured value (`EVENT_BUS_ADAPTER`, or the `eventBusAdapter` option).
 * @param options - see {@link SelectEventBusOptions}.
 * @returns the selection.
 * @throws Error naming the id and the registered ids, when `strict` and the id is not registered.
 */
export function selectEventBus(raw: string | undefined, options: SelectEventBusOptions = {}): EventBusSelection {
  const selection = parseEventBusAdapter(raw);
  if (!selection.recognised) {
    if (options.strict) throw unknownEventBusAdapterError(selection.configured.toLowerCase());
    logger.warn(
      `Unrecognised EVENT_BUS_ADAPTER "${selection.configured}"; registered adapters: ` +
        `${eventBusAdapterRegistry.ids().join(', ')}. Using "in-process": live events will not cross replicas.`,
    );
  }
  return selection;
}

/**
 * Builds the bus for a selection by calling its registered adapter.
 *
 * @param selection - which adapter.
 * @param sql - the app's Prisma client (`PLATFORM_PRISMA`); required by `postgres`.
 * @param appMetrics - where the `app.event_bus.*` counters go.
 * @param config - the application's configuration, handed to the adapter.
 * @returns the bus (a promise of it when the adapter is async).
 * @throws Error naming the id and listing the registered ones when no adapter has that id; or whatever the adapter throws (`postgres` without a client).
 */
export function createEventBus(
  selection: EventBusSelection,
  sql: EventBusSqlPublisher | undefined,
  appMetrics: AppMetricsService = fallbackAppMetrics(),
  config: ConfigService = new ConfigService(),
): EventBus | Promise<EventBus> {
  const adapter = eventBusAdapterRegistry.get(selection.adapter);
  if (!adapter) throw unknownEventBusAdapterError(selection.adapter);

  // `app.event_bus.*` (#680): declared in the app-metric registry, emitted
  // through the generic `add`.
  const metrics = eventBusMetricsVia((key, value, attributes) => appMetrics.add(key, value, attributes), selection.adapter);

  return adapter.create({ id: adapter.id, config, logger, prisma: sql, metrics });
}
