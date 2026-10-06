import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildDatabaseUrl } from '../database-url';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_BUS_SELECTION, EventBusSelection, parseEventBusAdapter } from './event-bus.config';
import { EVENT_BUS, type EventBus } from './event-bus.interface';
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

export function createEventBus(selection: EventBusSelection, prisma: PrismaService): EventBus {
  if (selection.adapter === 'postgres') {
    return new PostgresEventBus(prisma, { connectionString: buildDatabaseUrl() });
  }

  logger.log(
    'Event bus adapter "in-process": live events reach this process only. ' +
      'Set EVENT_BUS_ADAPTER=postgres before running more than one API replica.',
  );

  return new InProcessEventBus();
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
      inject: [EVENT_BUS_SELECTION, PrismaService],
      useFactory: createEventBus,
    },
  ],
  exports: [EVENT_BUS, EVENT_BUS_SELECTION],
})
export class EventBusModule {}
