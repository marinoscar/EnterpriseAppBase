// =============================================================================
// PostgresEventBus against a real Postgres (PP-1.11, issue #682)
// =============================================================================
//
// Two bus instances, each with its own Prisma client (publisher) and its own
// LISTEN session, stand in for two API replicas sharing one database. What a
// fake client cannot prove is proven here: that `pg_notify` through Prisma's
// `$executeRaw` really reaches another session's LISTEN, that the listener
// really drops its own echo, and that a session killed with
// `pg_terminate_backend` really comes back.
// =============================================================================

import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { EVENT_BUS_MAX_PAYLOAD_BYTES, EventBusMeta, PostgresEventBus } from '@marinoscar/platform-api/host';
import { ConfigService } from '@nestjs/config';
import { Job } from '@prisma/client';

import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { JobsService } from '@marinoscar/platform-api/jobs';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('postgres-event-bus.db.spec');

/** The suite's own URL: `DATABASE_URL` from `.env.test` must not win (see db-test-support). */
function connectionString(): string {
  const { DATABASE_URL: _ignored, ...env } = process.env;
  return buildDatabaseUrl(env);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describeWithDb('PostgresEventBus (real Postgres)', () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let busA: PostgresEventBus;
  let busB: PostgresEventBus;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prismaA = createDbClient();
    prismaB = createDbClient();
    await Promise.all([prismaA.$connect(), prismaB.$connect()]);
  });

  beforeEach(async () => {
    busA = new PostgresEventBus(prismaA, { connectionString: connectionString(), initialBackoffMs: 50 });
    busB = new PostgresEventBus(prismaB, { connectionString: connectionString(), initialBackoffMs: 50 });
    busA.start();
    busB.start();
    await waitFor(() => busA.health().connected && busB.health().connected);
  });

  afterEach(async () => {
    await Promise.all([busA.close(), busB.close()]);
  });

  afterAll(async () => {
    await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()]);
    jest.restoreAllMocks();
  });

  it('delivers a message from A to B within 1 s, and to A’s own subscribers exactly once', async () => {
    const onA: Array<[unknown, EventBusMeta]> = [];
    const onB: Array<[unknown, EventBusMeta]> = [];
    busA.subscribe('test.crossing', (payload, meta) => {
      onA.push([payload, meta]);
    });
    busB.subscribe('test.crossing', (payload, meta) => {
      onB.push([payload, meta]);
    });

    const started = Date.now();
    await busA.publish('test.crossing', { hello: 'replica' });
    await waitFor(() => onB.length === 1, 1_000);
    const elapsed = Date.now() - started;

    // Give A's listener time to hear its own NOTIFY and (correctly) drop it.
    await settle();

    expect(elapsed).toBeLessThan(1_000);
    expect(onB).toEqual([[{ hello: 'replica' }, { origin: busA.origin, local: false }]]);
    expect(onA).toEqual([[{ hello: 'replica' }, { origin: busA.origin, local: true }]]);
  });

  it('routes by logical channel across replicas', async () => {
    const wrong = jest.fn();
    const right = jest.fn();
    busB.subscribe('test.other', wrong);
    busB.subscribe('test.routed', right);

    await busA.publish('test.routed', { n: 1 });
    await waitFor(() => right.mock.calls.length === 1);
    await settle(100);

    expect(wrong).not.toHaveBeenCalled();
  });

  it('rejects an oversize payload: nobody receives it and nothing is thrown', async () => {
    const onB = jest.fn();
    busB.subscribe('test.oversize', onB);

    await expect(
      busA.publish('test.oversize', { blob: 'x'.repeat(EVENT_BUS_MAX_PAYLOAD_BYTES) }),
    ).resolves.toBeUndefined();
    await settle();

    expect(onB).not.toHaveBeenCalled();
    expect(busA.health().publishFailures).toBe(1);
  });

  it('a payload just under the limit crosses intact', async () => {
    const onB = jest.fn();
    busB.subscribe('test.large', onB);
    const body = 'é'.repeat(3_500); // 7,000 UTF-8 bytes

    await busA.publish('test.large', { body });
    await waitFor(() => onB.mock.calls.length === 1);

    expect(onB.mock.calls[0][0]).toEqual({ body });
  });

  it('wakes an idle worker on replica B when replica A enqueues, well inside its poll', async () => {
    const type = `test.event-bus-wake.${process.pid}`;
    const registry = new JobHandlerRegistry();
    registry.register({ type, process: async () => undefined });

    const settings: Record<string, unknown> = {
      'jobs.workerMode': 'all',
      'jobs.workerConcurrency': 1,
      'jobs.pollMs': 60_000,
      'jobs.jobTimeoutMs': 0,
      'jobs.systemModeExtraTypes': [],
    };
    // The claim and settle are stubbed (their real-Postgres behaviour has its
    // own suites); what crosses the database here is the wake-up itself.
    const claim = jest.fn().mockResolvedValueOnce([]);
    const completeSucceeded = jest.fn().mockResolvedValue('succeeded');
    const worker = new JobWorker(
      { get: (key: string) => settings[key] } as unknown as ConfigService,
      registry,
      { claim } as never,
      { completeSucceeded, completeFailed: jest.fn() } as never,
      { acquire: jest.fn().mockResolvedValue(0) } as never,
      { renew: jest.fn().mockResolvedValue(true) } as never,
      {} as never,
      undefined,
      busB,
    );
    const jobsOnA = new JobsService(prismaA as unknown as PrismaService, undefined, busA);

    worker.start(1);
    await waitFor(() => claim.mock.calls.length === 1);
    await settle(50);

    // Reads replica B's view of the table and hands the row out exactly ONCE,
    // as the real claim would.
    let handedOut = false;
    claim.mockImplementation(async (): Promise<Job[]> => {
      if (handedOut) return [];
      const row = await prismaB.job.findFirst({ where: { type, status: 'pending' } });
      if (!row) return [];
      handedOut = true;
      return [{ ...row, status: 'running' }];
    });

    const started = Date.now();
    try {
      await jobsOnA.enqueue({ type, reason: 'upload', skipDedup: true });
      await waitFor(() => completeSucceeded.mock.calls.length === 1, 2_000);
      // ~100 ms is typical across a local database; the poll is 60 s.
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await worker.stop();
      await prismaA.job.deleteMany({ where: { type } });
    }
  });

  it('reconnects after pg_terminate_backend and delivers messages published afterwards', async () => {
    const pid = busB.listenerPid();
    expect(pid).not.toBeNull();

    const onB = jest.fn();
    busB.subscribe('test.reconnect', onB);

    await prismaA.$executeRaw`SELECT pg_terminate_backend(${pid}::int)`;
    await waitFor(() => !busB.health().connected);
    expect(busB.health().lastError).not.toBeNull();

    await waitFor(() => busB.health().connected, 5_000);
    expect(busB.health().reconnects).toBeGreaterThanOrEqual(1);
    expect(busB.listenerPid()).not.toBe(pid);

    await busA.publish('test.reconnect', { after: true });
    await waitFor(() => onB.mock.calls.length === 1);
    expect(onB).toHaveBeenCalledWith({ after: true }, { origin: busA.origin, local: false });
  });
});
