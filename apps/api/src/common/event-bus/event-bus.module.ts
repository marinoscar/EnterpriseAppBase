import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildDatabaseUrl } from '../database-url';
import { AppMetricsService, fallbackAppMetrics } from '../otel/app-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBusDoctorCheck } from './doctor/event-bus.doctor-check';
import { EVENT_BUS_SELECTION, EventBusSelection, parseEventBusAdapter } from './event-bus.config';
import { EVENT_BUS, type EventBus } from './event-bus.interface';
import { eventBusMetricsVia } from './event-bus.metrics';
import { InProcessEventBus } from './in-process-event-bus';
import { PostgresEventBus } from './postgres-event-bus';

// =============================================================================
// EventBusModule (PP-1.11, issue #682)
// =============================================================================
//
// `@Global()` and imported ONCE, in `app.module.ts` next to `PrismaModule`, so
// `@Inject(EVENT_BUS)` works in every feature module without an import edge —
// the bus is infrastructure in the same sense the database is.
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

export function createEventBus(
  selection: EventBusSelection,
  prisma: PrismaService,
  appMetrics: AppMetricsService = fallbackAppMetrics(),
): EventBus {
  // `app.event_bus.*` (#680): declared in the app-metric registry, emitted
  // through the generic `add`.
  const metrics = eventBusMetricsVia((key, value, attributes) => appMetrics.add(key, value, attributes), selection.adapter);

  if (selection.adapter === 'postgres') {
    return new PostgresEventBus(prisma, { connectionString: buildDatabaseUrl(), metrics });
  }

  logger.log(
    'Event bus adapter "in-process": live events reach this process only. ' +
      'Set EVENT_BUS_ADAPTER=postgres before running more than one API replica.',
  );

  return new InProcessEventBus(undefined, metrics);
}

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS_SELECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EventBusSelection => {
        const selection = parseEventBusAdapter(config.get<string>('eventBus.adapter'));

        if (!selection.recognised) {
          logger.warn(
            `Unrecognised EVENT_BUS_ADAPTER "${selection.configured}"; expected "postgres" or ` +
              '"in-process". Using "in-process": live events will not cross replicas.',
          );
        }

        return selection;
      },
    },
    {
      provide: EVENT_BUS,
      // `AppMetricsModule` is global; optional so a test module without it still builds.
      inject: [EVENT_BUS_SELECTION, PrismaService, { token: AppMetricsService, optional: true }],
      useFactory: (selection: EventBusSelection, prisma: PrismaService, appMetrics?: AppMetricsService) =>
        createEventBus(selection, prisma, appMetrics ?? undefined),
    },
    // `core.event-bus`. Injects the @Global doctor registry, so it adds no
    // import edge to this module.
    EventBusDoctorCheck,
  ],
  exports: [EVENT_BUS, EVENT_BUS_SELECTION],
})
export class EventBusModule {}
