// =============================================================================
// Real-Postgres test: the atomic `FOR UPDATE SKIP LOCKED` claim (issue #260,
// epic #254)
// =============================================================================
//
// THE HEADLINE ACCEPTANCE CRITERION OF #260 IS IN THIS FILE, and it is the one
// claim epic #254 cares about most: *two claimers running concurrently never
// receive the same row.* That statement is unprovable against a mock — a
// mocked `$queryRaw` returns whatever the test told it to, so a test built on
// one proves the test's own arrangement and nothing about `SKIP LOCKED`,
// about row locks, or about the fact that the claim is a single statement.
// The queue's entire safety argument rests on Postgres's behaviour, so it is
// Postgres that has to be asked.
//
// The suite therefore runs `JobClaimService` ITSELF — not a copy of its SQL —
// over two INDEPENDENT `PrismaClient` instances, each with its own connection
// pool, which is as close to "two API replicas" as one process gets.
//
// THIS IS A `*.db.spec.ts` FILE, excluded from `npm test`/`test:unit`/
// `test:cov`/`test:ci` and run by `npm run test:db`, which CI's `smoke` job
// invokes after `prisma:migrate`. See `db-test-support.ts` for the
// reachability probe and for why `DATABASE_URL` is stripped before connecting.
// =============================================================================

import { Job, PrismaClient, Prisma } from '@prisma/client';

import { JobClaimService } from '../../src/jobs/job-claim.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from './db-test-support';

const { describeWithDb } = resolveDbSuite('job-claim.db.spec');

/** Lease length used throughout; long enough that nothing expires mid-test. */
const LEASE_MS = 60_000;

/**
 * `JobClaimService` only ever touches `PrismaService.$queryRaw`, which is
 * inherited unchanged from `PrismaClient`. Constructing the real service over
 * a bare client is what keeps this suite testing the shipped query rather
 * than a transcription of it.
 */
function claimServiceFor(client: PrismaClient): JobClaimService {
  return new JobClaimService(client as unknown as PrismaService);
}

describeWithDb('JobClaimService.claim (real Postgres)', () => {
  // Two clients, two pools — the whole point. `clientA` doubles as the
  // suite's fixture/cleanup connection.
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let claimerA: JobClaimService;
  let claimerB: JobClaimService;

  /**
   * Every job this suite creates carries a type prefixed with this, so
   * cleanup can delete exactly the rows this suite made and nothing else —
   * the database it runs against is shared with the other `*.db.spec.ts`
   * suites and, locally, may be a developer's seeded dev database.
   */
  const TYPE_PREFIX = `test.claim.${process.pid}.`;
  let typeCounter = 0;

  /** A fresh, unique job type, so no two tests can see each other's rows. */
  const nextType = (): string => `${TYPE_PREFIX}${(typeCounter += 1)}`;

  beforeAll(async () => {
    clientA = createDbClient();
    clientB = createDbClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);
    claimerA = claimServiceFor(clientA);
    claimerB = claimServiceFor(clientB);
  });

  afterEach(async () => {
    // Delete only what this suite created, so repeated runs stay green and
    // nothing else in the database is disturbed.
    await clientA.job.deleteMany({ where: { type: { startsWith: TYPE_PREFIX } } });
  });

  afterAll(async () => {
    await clientA?.job.deleteMany({ where: { type: { startsWith: TYPE_PREFIX } } });
    await Promise.all([clientA?.$disconnect(), clientB?.$disconnect()]);
  });

  /** Seeds `count` immediately-runnable pending jobs of `type`. */
  async function seedPending(
    type: string,
    count: number,
    overrides: Partial<Prisma.JobCreateManyInput> = {}
  ): Promise<string[]> {
    const base = Date.now();
    await clientA.job.createMany({
      data: Array.from({ length: count }, (_unused, index) => ({
        type,
        reason: 'backfill' as const,
        // Explicit, strictly increasing timestamps rather than relying on
        // `now()` resolving differently for each row: the ordering assertions
        // below must not depend on how fast the insert ran.
        createdAt: new Date(base + index),
        ...overrides,
      })),
    });

    // Ordered by `createdAt` so the returned ids are in the order the claim
    // query is expected to hand them back — the ordering assertions compare
    // against this array directly.
    const rows = await clientA.job.findMany({
      where: { type },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  // ===========================================================================
  // The concurrency guarantee
  // ===========================================================================

  it('never hands the same row to two claimers racing for a single job', async () => {
    // The DETERMINISTIC form of the guarantee: one row, two simultaneous
    // claimers, repeated. Exactly one of the two must win every single round
    // — there is no sampling and no "very likely" about it, which is what
    // makes this the assertion that would actually fail if the claim were
    // ever split into a SELECT plus an UPDATE, or guarded by an in-process
    // mutex that a second process cannot see.
    const rounds = 10;

    for (let round = 0; round < rounds; round += 1) {
      const type = nextType();
      const [onlyId] = await seedPending(type, 1);

      const [fromA, fromB] = await Promise.all([
        claimerA.claim({
          nodeId: null,
          executor: 'server',
          eligibleTypes: [type],
          limit: 1,
          leaseMs: LEASE_MS,
        }),
        claimerB.claim({
          nodeId: null,
          executor: 'server',
          eligibleTypes: [type],
          limit: 1,
          leaseMs: LEASE_MS,
        }),
      ]);

      const claimed = [...fromA, ...fromB];
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe(onlyId);
      // One winner, one empty hand — never two winners, never a duplicate.
      expect(fromA.length + fromB.length).toBe(1);
    }
  });

  it('gives two concurrent claimers a disjoint partition of a seeded batch', async () => {
    const type = nextType();
    const seededIds = await seedPending(type, 24);

    const options = {
      nodeId: null,
      executor: 'server' as const,
      eligibleTypes: [type],
      limit: 4,
      leaseMs: LEASE_MS,
    };

    // Eight overlapping claims — four per client, all in flight at once, with
    // a combined capacity (8 x 4 = 32) deliberately larger than the 24 rows
    // available so the claimers genuinely contend for the tail of the batch.
    const burst = await Promise.all([
      claimerA.claim(options),
      claimerB.claim(options),
      claimerA.claim(options),
      claimerB.claim(options),
      claimerA.claim(options),
      claimerB.claim(options),
      claimerA.claim(options),
      claimerB.claim(options),
    ]);

    const burstIds = burst.flat().map((job) => job.id);
    expect(burstIds.length).toBeGreaterThan(0);

    // `SKIP LOCKED` is allowed to hand back FEWER rows than asked for — that
    // is precisely what it does when another claimer holds a row mid-
    // statement — so the burst alone cannot be asserted to have drained the
    // batch. It can, and must, be asserted to have handed no row out twice.
    // The drain below then closes the "equals what was available" half of the
    // criterion deterministically, and every drained id joins the same
    // duplicate check.
    const drainedIds: string[] = [];
    for (;;) {
      const more = await claimerA.claim({ ...options, limit: 50 });
      if (more.length === 0) {
        break;
      }
      drainedIds.push(...more.map((job) => job.id));
    }

    const allIds = [...burstIds, ...drainedIds];

    expect(new Set(allIds).size).toBe(allIds.length); // no id claimed twice
    expect([...allIds].sort()).toEqual([...seededIds].sort()); // and none lost
  });

  // ===========================================================================
  // Eligibility and ordering
  // ===========================================================================

  it('claims a more urgent job enqueued later before a less urgent one enqueued earlier', async () => {
    const type = nextType();

    // priority ASCENDING is more urgent (see the `Job` model comment), so the
    // priority-0 job must win despite being newer by a full second.
    const urgentButNewer = await clientA.job.create({
      data: {
        type,
        reason: 'rerun',
        priority: 0,
        createdAt: new Date(Date.now() + 1000),
      },
    });
    const staleButOlder = await clientA.job.create({
      data: { type, reason: 'rerun', priority: 100, createdAt: new Date(Date.now() - 1000) },
    });

    const first = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    });
    expect(first.map((job) => job.id)).toEqual([urgentButNewer.id]);

    // ...and the tie-break within a priority is still oldest-first: the only
    // job left is the one that was skipped.
    const second = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    });
    expect(second.map((job) => job.id)).toEqual([staleButOlder.id]);
  });

  it('takes the oldest jobs first within one priority', async () => {
    const type = nextType();
    // `seedPending` writes strictly increasing `createdAt` values in array
    // order, so `seededIds[0]` and `[1]` are the two oldest.
    const seededIds = await seedPending(type, 5);

    const claimed = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 2,
      leaseMs: LEASE_MS,
    });

    // ⚠ ASSERTED AS A SET, DELIBERATELY. The `ORDER BY` lives in the claim's
    // inner `SELECT`, where it decides WHICH rows are taken; SQL gives
    // `UPDATE … RETURNING` no ordering guarantee whatsoever, so asserting the
    // array's sequence would be asserting an implementation detail Postgres
    // never promised — and it does in fact hand these back in a different
    // order. "Oldest first" is a statement about selection, and this is how
    // it is checked. The service's own doc comment records the same caveat
    // for callers.
    expect(claimed.map((job) => job.id).sort()).toEqual(seededIds.slice(0, 2).sort());

    // The three newer jobs are untouched and still claimable.
    const rest = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 10,
      leaseMs: LEASE_MS,
    });
    expect(rest.map((job) => job.id).sort()).toEqual(seededIds.slice(2).sort());
  });

  it('does not claim a job scheduled for the future, and does once that time passes', async () => {
    const type = nextType();
    const job = await clientA.job.create({
      data: {
        type,
        reason: 'rerun',
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const tooEarly = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 5,
      leaseMs: LEASE_MS,
    });
    expect(tooEarly).toEqual([]);

    // Move the schedule into the past rather than waiting an hour — the
    // predicate under test is `scheduled_for <= now()`, and which side of
    // `now()` the value falls on is the whole question.
    await clientA.job.update({
      where: { id: job.id },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const nowEligible = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 5,
      leaseMs: LEASE_MS,
    });
    expect(nowEligible.map((claimedJob) => claimedJob.id)).toEqual([job.id]);
    // The claim clears the schedule, so a requeued job is not held back by a
    // stale deferral it has already served.
    expect(nowEligible[0].scheduledFor).toBeNull();
  });

  it('ignores job types the claimer is not eligible for', async () => {
    const mine = nextType();
    const theirs = nextType();
    await seedPending(mine, 1);
    await seedPending(theirs, 1);

    const claimed = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [mine],
      limit: 10,
      leaseMs: LEASE_MS,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].type).toBe(mine);
  });

  it('does not re-claim a job that is already running', async () => {
    const type = nextType();
    await seedPending(type, 1);

    const options = {
      nodeId: null,
      executor: 'server' as const,
      eligibleTypes: [type],
      limit: 5,
      leaseMs: LEASE_MS,
    };

    expect(await claimerA.claim(options)).toHaveLength(1);
    // Only `pending` rows are eligible; a lease that has not expired is #263's
    // problem, not the claim query's.
    expect(await claimerA.claim(options)).toEqual([]);
  });

  // ===========================================================================
  // What the claim writes
  // ===========================================================================

  it('charges attempts at claim time — the row is already at 1 before any handler runs', async () => {
    const type = nextType();
    const [id] = await seedPending(type, 1);

    const [claimed] = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    });

    // The value the CLAIM ITSELF returned — nothing has run the job, and this
    // is the property that lets #263 bound a job that kills its process.
    expect(claimed.attempts).toBe(1);

    // ...and it is durable, not merely present in the returned row.
    const persisted = await clientA.job.findUniqueOrThrow({ where: { id } });
    expect(persisted.attempts).toBe(1);
    expect(persisted.status).toBe('running');
  });

  it('sets status, startedAt, lease, executor and node id on the claimed row', async () => {
    const type = nextType();
    await seedPending(type, 1);

    const nodeId = '11111111-2222-3333-4444-555555555555';
    const before = Date.now();

    const [claimed] = await claimerA.claim({
      nodeId,
      executor: 'node',
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    });

    expect(claimed.status).toBe('running');
    expect(claimed.executor).toBe('node');
    expect(claimed.claimedByNodeId).toBe(nodeId);
    expect(claimed.startedAt).toBeInstanceOf(Date);
    expect(claimed.leaseExpiresAt).toBeInstanceOf(Date);

    // `lease_expires_at = now() + leaseMs`, checked with a generous window so
    // this asserts the arithmetic happened rather than racing the clock.
    const leaseMsFromNow = (claimed.leaseExpiresAt as Date).getTime() - before;
    expect(leaseMsFromNow).toBeGreaterThan(LEASE_MS - 10_000);
    expect(leaseMsFromNow).toBeLessThan(LEASE_MS + 10_000);
  });

  it('increments attempts on each successive claim of the same row', async () => {
    const type = nextType();
    const [id] = await seedPending(type, 1);

    const options = {
      nodeId: null,
      executor: 'server' as const,
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    };

    const [firstClaim] = await claimerA.claim(options);
    expect(firstClaim.attempts).toBe(1);

    // Simulate the row becoming claimable again (a retry, or #263 reaping an
    // expired lease) — the counter accumulates rather than resetting.
    await clientA.job.update({ where: { id }, data: { status: 'pending' } });

    const [secondClaim] = await claimerA.claim(options);
    expect(secondClaim.attempts).toBe(2);
  });

  // ===========================================================================
  // The RETURNING aliases
  // ===========================================================================

  it('returns rows whose key set is exactly the generated Job field set', async () => {
    const type = nextType();
    await seedPending(type, 1);

    const [claimed] = await claimerA.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [type],
      limit: 1,
      leaseMs: LEASE_MS,
    });

    // The compile-time half of this guarantee is `JOB_CLAIM_COLUMNS` being
    // typed `Record<keyof Job, string>`; this is the runtime half, asserted
    // against a row Postgres actually produced. A column aliased to the wrong
    // name would show up here as a key set mismatch rather than as an
    // `undefined` field discovered somewhere downstream.
    expect(Object.keys(claimed).sort()).toEqual(Object.keys(Prisma.JobScalarFieldEnum).sort());

    // And the aliases carry values of the types the `Job` type promises,
    // which is the part a name-only comparison would miss.
    const typed: Job = claimed;
    expect(typeof typed.id).toBe('string');
    expect(typeof typed.attempts).toBe('number');
    expect(typed.createdAt).toBeInstanceOf(Date);
  });

  // ===========================================================================
  // Short circuits, verified against the real database
  // ===========================================================================

  it('returns nothing for an empty eligible-type list or a non-positive limit', async () => {
    const type = nextType();
    await seedPending(type, 2);

    expect(
      await claimerA.claim({
        nodeId: null,
        executor: 'server',
        eligibleTypes: [],
        limit: 5,
        leaseMs: LEASE_MS,
      })
    ).toEqual([]);

    expect(
      await claimerA.claim({
        nodeId: null,
        executor: 'server',
        eligibleTypes: [type],
        limit: 0,
        leaseMs: LEASE_MS,
      })
    ).toEqual([]);

    // Neither short circuit may have touched the rows.
    const untouched = await clientA.job.findMany({ where: { type } });
    expect(untouched.every((job) => job.status === 'pending')).toBe(true);
    expect(untouched.every((job) => job.attempts === 0)).toBe(true);
  });
});
