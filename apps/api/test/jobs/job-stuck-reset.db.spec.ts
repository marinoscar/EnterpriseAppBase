// =============================================================================
// Real-Postgres test: the lease reaper's three recovery signals (issue #263,
// epic #254)
// =============================================================================
//
// `stuckRunningWhere` is a claim about WHICH ROWS POSTGRES MATCHES, and a mock
// cannot make that claim: a mocked `updateMany` returns whatever the test told
// it to no matter what `where` it was handed, so a unit test can only assert
// the shape of an object. That is worth doing (and
// `src/jobs/job-stuck.service.spec.ts` does it), but it would keep passing if
// a signal quietly matched nothing — which is exactly how the zombie clause
// would break, since `NULL < threshold` is NULL rather than false and no
// TypeScript type notices.
//
// So this suite builds each stuck shape as a real row and asks the real
// service, one signal at a time, with the other two deliberately unable to
// fire.
//
// THIS IS A `*.db.spec.ts` FILE — see `db-test-support.ts` and
// `job-claim.db.spec.ts`'s header for the run/skip mechanics.
// =============================================================================

import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

import { JobStuckService } from '../../src/jobs/job-stuck.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SystemSettingsService } from '../../src/settings/system-settings/system-settings.service';
import { createDbClient, resolveDbSuite } from './db-test-support';

const { describeWithDb } = resolveDbSuite('job-stuck-reset.db.spec');

/** The stuck threshold every test in this suite runs with. */
const THRESHOLD_MINUTES = 30;

/** The attempt budget every test in this suite runs with. */
const MAX_ATTEMPTS = 3;

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/**
 * The real service over a bare client, with the two collaborators it does not
 * exercise here stubbed: the settings row belongs to the application rather
 * than to this suite, so the threshold is stated explicitly instead of being
 * read out of (and possibly written into) a shared database.
 */
function stuckServiceFor(client: PrismaClient): JobStuckService {
  const config = {
    get: (key: string) => (key === 'jobs.maxAttempts' ? MAX_ATTEMPTS : undefined),
  } as unknown as ConfigService;

  const systemSettings = {
    getJobsPolicy: async () => ({
      history: { retentionDays: 30, purgeEnabled: true },
      stuckThresholdMinutes: THRESHOLD_MINUTES,
    }),
  } as unknown as SystemSettingsService;

  return new JobStuckService(client as unknown as PrismaService, config, systemSettings);
}

describeWithDb('JobStuckService.resetStuck (real Postgres)', () => {
  let client: PrismaClient;
  let stuck: JobStuckService;

  // The same per-process scoping discipline as the other queue suites: every
  // row this file creates carries a type prefixed with this, so cleanup
  // removes exactly this suite's rows from a database it shares with the
  // other `*.db.spec.ts` files (and, locally, with a developer's dev data).
  const TYPE_PREFIX = `test.stuck.${process.pid}.`;
  let typeCounter = 0;
  const nextType = (): string => `${TYPE_PREFIX}${(typeCounter += 1)}`;

  beforeAll(async () => {
    client = createDbClient();
    await client.$connect();
    stuck = stuckServiceFor(client);
  });

  afterEach(async () => {
    await client.job.deleteMany({ where: { type: { startsWith: TYPE_PREFIX } } });
  });

  afterAll(async () => {
    await client?.job.deleteMany({ where: { type: { startsWith: TYPE_PREFIX } } });
    await client?.$disconnect();
  });

  /** Inserts one row and returns its id. */
  async function seed(data: Omit<Prisma.JobCreateInput, 'reason'>): Promise<string> {
    const row = await client.job.create({
      data: { reason: 'backfill', ...data } as Prisma.JobCreateInput,
    });

    return row.id;
  }

  const read = (id: string) => client.job.findUniqueOrThrow({ where: { id } });

  // ===========================================================================
  // Each of the three signals, independently
  // ===========================================================================

  it('reclaims an AGED claim: startedAt older than the threshold', async () => {
    // Signal 1 alone: the lease is still valid and `startedAt` is set, so
    // neither of the other two signals can be what matched.
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 5),
      leaseExpiresAt: new Date(Date.now() + 60 * 60_000),
      claimedByNodeId: null,
      executor: 'server',
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ reset: 1, failed: 0 });
    await expect(read(id)).resolves.toMatchObject({ status: 'pending' });
  });

  it('reclaims a ZOMBIE: running with no startedAt, aged by createdAt', async () => {
    // Signal 2 alone, and the one a mock cannot catch. `startedAt` is NULL,
    // so signal 1's comparison is NULL (never true); `leaseExpiresAt` is NULL
    // too, so signal 3 cannot fire either. If this row comes back, the
    // `createdAt` arm is the only thing that could have matched it — and
    // without that arm the row would sit `running` forever, holding its dedup
    // key with it.
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: null,
      leaseExpiresAt: null,
      createdAt: minutesAgo(THRESHOLD_MINUTES + 5),
      executor: 'server',
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ reset: 1, failed: 0 });
    await expect(read(id)).resolves.toMatchObject({ status: 'pending' });
  });

  it('reclaims a DEAD OWNER: an expired lease, however recently the job started', async () => {
    // Signal 3 alone: the job started seconds ago, so it is nowhere near the
    // stuck threshold — the only thing wrong with it is that whoever claimed
    // it promised to renew the lease and did not. This is the node-fleet
    // case: a laptop that closed its lid mid-job.
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: new Date(),
      leaseExpiresAt: minutesAgo(1),
      claimedByNodeId: '11111111-1111-4111-8111-111111111111',
      executor: 'node',
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ reset: 1, failed: 0 });
    await expect(read(id)).resolves.toMatchObject({ status: 'pending' });
  });

  it('leaves a healthy running job alone: young, stamped, and holding a live lease', async () => {
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: minutesAgo(1),
      leaseExpiresAt: new Date(Date.now() + 60 * 60_000),
      executor: 'server',
    });

    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 0, failed: 0 });
    await expect(read(id)).resolves.toMatchObject({ status: 'running' });
  });

  it('never touches a pending, succeeded or failed row, however old', async () => {
    const ancient = minutesAgo(60 * 24 * 30);
    const ids = await Promise.all(
      (['pending', 'succeeded', 'failed'] as const).map((status) =>
        seed({
          type: nextType(),
          status,
          attempts: 9,
          createdAt: ancient,
          startedAt: status === 'pending' ? null : ancient,
          finishedAt: status === 'pending' ? null : ancient,
        })
      )
    );

    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 0, failed: 0 });

    const rows = await client.job.findMany({ where: { id: { in: ids } } });
    expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'pending', 'succeeded']);
  });

  // ===========================================================================
  // The two phases
  // ===========================================================================

  it('requeues a row under the cap with its claim, lease and executor released', async () => {
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: MAX_ATTEMPTS - 1,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
      leaseExpiresAt: minutesAgo(1),
      claimedByNodeId: '22222222-2222-4222-8222-222222222222',
      executor: 'node',
      finishedAt: null,
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ reset: 1, failed: 0 });

    const row = await read(id);

    expect(row.status).toBe('pending');
    expect(row.claimedByNodeId).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    expect(row.executor).toBeNull();
    expect(row.scheduledFor).toBeNull();
    // Eligible again, and its already-charged attempt is left exactly as it
    // was: the attempt genuinely happened.
    expect(row.attempts).toBe(MAX_ATTEMPTS - 1);
    expect(row.lastError).toContain('lease reaper');
  });

  it('fails a row at the cap, with its own attempt count in the message', async () => {
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: MAX_ATTEMPTS,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
      executor: 'server',
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ reset: 0, failed: 1 });

    const row = await read(id);

    expect(row.status).toBe('failed');
    expect(row.finishedAt).not.toBeNull();
    expect(row.claimedByNodeId).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    // Kept on a terminal row, exactly as `JobTerminalService` keeps it: which
    // side the job died on is worth knowing later.
    expect(row.executor).toBe('server');
    expect(row.lastError).toContain(`after ${MAX_ATTEMPTS} attempt(s)`);
  });

  it('fails a row OVER the cap too, so a raised budget cannot strand old rows', async () => {
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: MAX_ATTEMPTS + 4,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
    });

    await expect(stuck.resetStuck()).resolves.toMatchObject({ failed: 1 });
    await expect(read(id)).resolves.toMatchObject({ status: 'failed' });
  });

  it('splits a mixed sweep between the two phases in one pass', async () => {
    const type = nextType();
    const doomed = await seed({
      type,
      status: 'running',
      attempts: MAX_ATTEMPTS,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
    });
    const retryable = await seed({
      type,
      status: 'running',
      attempts: 1,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
    });

    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 1, failed: 1 });
    await expect(read(doomed)).resolves.toMatchObject({ status: 'failed' });
    await expect(read(retryable)).resolves.toMatchObject({ status: 'pending' });
  });

  it('is idempotent: a second sweep finds nothing left to do', async () => {
    // The reaper runs every ten minutes forever, and two replicas may sweep
    // at once. A second pass over rows it has already reclaimed must be a
    // no-op rather than, say, re-failing a job it just requeued.
    await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: minutesAgo(THRESHOLD_MINUTES + 1),
    });

    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 1, failed: 0 });
    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 0, failed: 0 });
  });

  it('honours an explicit threshold, so an operator can reclaim more aggressively', async () => {
    const id = await seed({
      type: nextType(),
      status: 'running',
      attempts: 1,
      startedAt: minutesAgo(5),
      leaseExpiresAt: new Date(Date.now() + 60 * 60_000),
    });

    // Five minutes old: untouched at the configured 30-minute threshold...
    await expect(stuck.resetStuck()).resolves.toEqual({ reset: 0, failed: 0 });
    // ...and reclaimed when the caller says two.
    await expect(stuck.resetStuck(2)).resolves.toMatchObject({ reset: 1 });
    await expect(read(id)).resolves.toMatchObject({ status: 'pending' });
  });
});
