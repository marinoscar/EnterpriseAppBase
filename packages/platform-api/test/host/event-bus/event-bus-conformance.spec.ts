import { describeEventBusConformance } from '../../../src/host/testing';
import { InProcessEventBus } from '../../../src/host/event-bus/in-process-event-bus';
import { PostgresEventBus } from '../../../src/host/event-bus/postgres-event-bus';

// =============================================================================
// The event bus conformance kit (PP-14.2, #920) run on both built-in adapters
// =============================================================================
//
// The Postgres adapter runs against a stub publisher and is never started (no
// LISTEN session), so this proves what every adapter owes ONE process: local
// delivery, order, isolation, isolated handlers, a publish that never rejects.
// Its cross-replica behaviour is `postgres-event-bus.spec.ts` and the
// real-database suite.
// =============================================================================

describe('InProcessEventBus', () => {
  describeEventBusConformance(() => new InProcessEventBus(), { describe, it, expect });
});

describe('PostgresEventBus (stub publisher, listener not started)', () => {
  describeEventBusConformance(
    () => new PostgresEventBus({ $executeRaw: async () => 1 }, { connectionString: 'postgresql://unused' }),
    { describe, it, expect },
  );
});

describe('a shared instance', () => {
  describeEventBusConformance(new InProcessEventBus(), { describe, it, expect });
});
