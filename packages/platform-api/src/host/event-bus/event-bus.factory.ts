import { Logger } from '@nestjs/common';

import { buildDatabaseUrl } from '../../core/index';
import { AppMetricsService, fallbackAppMetrics } from '../metrics/app-metrics.service';
import { type EventBusSelection, parseEventBusAdapter } from './event-bus.config';
import type { EventBus } from './event-bus.interface';
import { eventBusMetricsVia } from './event-bus.metrics';
import { InProcessEventBus } from './in-process-event-bus';
import { PostgresEventBus, type EventBusSqlPublisher } from './postgres-event-bus';

// =============================================================================
// The process's one event bus (PP-1.11, issue #682; packaged by #867)
// =============================================================================
//
// `PlatformHostCoreModule.forRoot()` provides `EVENT_BUS` globally through
// these two factories, so `@Inject(EVENT_BUS)` works in every module without
// an import edge: the bus is infrastructure in the same sense the database is.
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
 * Parses the configured adapter and warns once about an unrecognised value.
 *
 * @param raw - the configured value (`EVENT_BUS_ADAPTER`).
 * @returns the selection.
 */
export function selectEventBus(raw: string | undefined): EventBusSelection {
  const selection = parseEventBusAdapter(raw);
  if (!selection.recognised) {
    logger.warn(
      `Unrecognised EVENT_BUS_ADAPTER "${selection.configured}"; expected "postgres" or ` +
        '"in-process". Using "in-process": live events will not cross replicas.',
    );
  }
  return selection;
}

/**
 * Builds the bus for a selection.
 *
 * @param selection - which adapter.
 * @param sql - the app's Prisma client (`PLATFORM_PRISMA`); required for `postgres`.
 * @param appMetrics - where the `app.event_bus.*` counters go.
 * @returns the bus.
 * @throws Error when `postgres` is selected and no client is bound.
 */
export function createEventBus(
  selection: EventBusSelection,
  sql: EventBusSqlPublisher | undefined,
  appMetrics: AppMetricsService = fallbackAppMetrics(),
): EventBus {
  // `app.event_bus.*` (#680): declared in the app-metric registry, emitted
  // through the generic `add`.
  const metrics = eventBusMetricsVia((key, value, attributes) => appMetrics.add(key, value, attributes), selection.adapter);

  if (selection.adapter === 'postgres') {
    if (!sql) {
      throw new Error(
        'EVENT_BUS_ADAPTER=postgres needs the app\'s Prisma client: bind PLATFORM_PRISMA with PlatformHostModule.forRoot({ prisma }).',
      );
    }
    return new PostgresEventBus(sql, { connectionString: buildDatabaseUrl(), metrics });
  }

  logger.log(
    'Event bus adapter "in-process": live events reach this process only. ' +
      'Set EVENT_BUS_ADAPTER=postgres before running more than one API replica.',
  );

  return new InProcessEventBus(undefined, metrics);
}
