// =============================================================================
// Unit tests for JobClaimService (issue #260, epic #254)
// =============================================================================
//
// ⚠ THE CONCURRENCY GUARANTEE IS NOT TESTED HERE, AND CANNOT BE. A mocked
// `$queryRaw` returns whatever this file tells it to, so "two claimers never
// receive the same row" asserted against a mock would prove only that the
// mock was arranged that way. That claim is Postgres's to make and is made in
// `test/jobs/job-claim.db.spec.ts` against a real database.
//
// What IS worth asserting without a database is everything the service
// decides BEFORE the query: the two short circuits (whose entire purpose is
// that no query happens at all — invisible in a database test, which sees the
// same empty result either way) and that the rows the driver returns are
// handed back untouched.
// =============================================================================

import { Job, Prisma } from '@prisma/client';

import { JobClaimService, JOB_CLAIM_COLUMNS } from './job-claim.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('JobClaimService', () => {
  let queryRaw: jest.Mock;
  let service: JobClaimService;

  beforeEach(() => {
    queryRaw = jest.fn();
    service = new JobClaimService({ $queryRaw: queryRaw } as unknown as PrismaService);
  });

  const options = {
    nodeId: null,
    executor: 'server' as const,
    eligibleTypes: ['example.echo'],
    limit: 5,
    leaseMs: 30_000,
  };

  describe('short circuits', () => {
    it('returns [] without querying when no type is eligible', async () => {
      // The state a `system`-mode worker is in when no server-only handler is
      // registered — ordinary, not a misconfiguration.
      await expect(service.claim({ ...options, eligibleTypes: [] })).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns [] without querying when the limit is zero', async () => {
      // The state a worker pool is in when every slot is busy.
      await expect(service.claim({ ...options, limit: 0 })).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns [] without querying when the limit is negative', async () => {
      await expect(service.claim({ ...options, limit: -1 })).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('does query when both are in range', async () => {
      queryRaw.mockResolvedValue([]);
      await expect(service.claim(options)).resolves.toEqual([]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('the statement it issues', () => {
    it('sends one parameterised statement, with no value interpolated into the SQL text', async () => {
      queryRaw.mockResolvedValue([]);

      await service.claim({
        nodeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        executor: 'node',
        eligibleTypes: ['a.b', 'c.d'],
        limit: 7,
        leaseMs: 1234,
      });

      const [statement] = queryRaw.mock.calls[0] as [Prisma.Sql];

      // Every runtime value is a bound parameter. Asserting on `values`
      // rather than on the SQL text is what makes this a test of
      // parameterisation instead of a test of string formatting.
      expect(statement.values).toEqual([
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'node',
        1234,
        ['a.b', 'c.d'],
        7,
      ]);

      // ...and none of those values appears in the SQL text itself.
      for (const literal of ['aaaaaaaa-bbbb', "'node'", '1234', 'a.b']) {
        expect(statement.sql).not.toContain(literal);
      }
    });

    it('is a single statement — no separate SELECT-then-UPDATE', async () => {
      queryRaw.mockResolvedValue([]);
      await service.claim(options);

      const [statement] = queryRaw.mock.calls[0] as [Prisma.Sql];

      expect(statement.sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(statement.sql).toContain('attempts = attempts + 1');
      // One trailing semicolon at most, and certainly not one in the middle
      // separating two statements.
      expect(statement.sql.replace(/;\s*$/, '')).not.toContain(';');
    });

    it('aliases every Job column in RETURNING', async () => {
      queryRaw.mockResolvedValue([]);
      await service.claim(options);

      const [statement] = queryRaw.mock.calls[0] as [Prisma.Sql];

      for (const [field, column] of Object.entries(JOB_CLAIM_COLUMNS)) {
        expect(statement.sql).toContain(`${column} AS "${field}"`);
      }
    });
  });

  it('returns the driver rows unchanged, with no remapping layer', async () => {
    // The rows already ARE `Job` values because of the camelCase aliases —
    // if this service ever grew a mapping step, that would be the place a
    // renamed field could go silently missing.
    const row = { id: 'job-1', type: 'example.echo', attempts: 1 } as unknown as Job;
    queryRaw.mockResolvedValue([row]);

    const claimed = await service.claim(options);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toBe(row);
  });

  it('propagates a database error rather than reporting an empty queue', async () => {
    // "Nothing to do" and "the database is unreachable" must not look the
    // same to a worker: the first is the normal answer, the second has to be
    // visible.
    queryRaw.mockRejectedValue(new Error('connection terminated'));
    await expect(service.claim(options)).rejects.toThrow('connection terminated');
  });
});
