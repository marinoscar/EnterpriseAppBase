// =============================================================================
// The platform's own event bus adapters (PP-14.2, issue #920)
// =============================================================================
//
// `in-process` and `postgres`, registered through `registerEventBusAdapter`
// exactly as an app registers its own. Loaded by `event-bus.config.ts` and the
// factory, so the registry already holds them whenever an id is looked up.
// =============================================================================

import { buildDatabaseUrl } from '../../core/index';
import { registerEventBusAdapter, type EventBusAdapterDef } from './event-bus-adapter.registry';
import { InProcessEventBus } from './in-process-event-bus';
import { PostgresEventBus } from './postgres-event-bus';

/**
 * The single-process bus: one `Map` in this heap. The default.
 *
 * @stability experimental
 */
export const IN_PROCESS_EVENT_BUS_ADAPTER: EventBusAdapterDef = {
  id: 'in-process',
  label: 'In-process (single replica)',
  create: ({ logger, metrics }) => {
    logger.log(
      'Event bus adapter "in-process": live events reach this process only. ' +
        'Set EVENT_BUS_ADAPTER=postgres before running more than one API replica.',
    );
    return new InProcessEventBus(undefined, metrics);
  },
};

/**
 * The cross-replica bus: `pg_notify` to publish, one dedicated `LISTEN`
 * session to receive. Needs the app's Prisma client (`PLATFORM_PRISMA`).
 *
 * @stability experimental
 */
export const POSTGRES_EVENT_BUS_ADAPTER: EventBusAdapterDef = {
  id: 'postgres',
  label: 'PostgreSQL LISTEN/NOTIFY',
  create: ({ prisma, metrics }) => {
    if (!prisma) {
      throw new Error(
        'EVENT_BUS_ADAPTER=postgres needs the app\'s Prisma client: bind PLATFORM_PRISMA with PlatformHostModule.forRoot({ prisma }).',
      );
    }
    return new PostgresEventBus(prisma, { connectionString: buildDatabaseUrl(), metrics });
  },
};

registerEventBusAdapter(IN_PROCESS_EVENT_BUS_ADAPTER);
registerEventBusAdapter(POSTGRES_EVENT_BUS_ADAPTER);
