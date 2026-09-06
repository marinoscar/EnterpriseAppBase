// =============================================================================
// Locks down the generated `Job` scalar field name set (issue #255, epic #254)
// =============================================================================
//
// The claim query landing with #260 will `RETURNING` a subset of these
// columns under aliases it picks; this spec is what that later work checks
// its aliases against, so a field getting renamed (or the set changing at
// all) is caught here first rather than as a confusing mismatch in #260's
// own tests. `Prisma.JobScalarFieldEnum` is generated straight from
// `prisma/schema.prisma` by `prisma generate` — asserting against it, not a
// hand-copied list read off the schema file, is what makes this spec fail
// the moment the two actually disagree.
// =============================================================================

import { Prisma } from '@prisma/client';

describe('Prisma.JobScalarFieldEnum', () => {
  it('has exactly the field names Job is documented to have', () => {
    const expected = [
      'id',
      'type',
      'subjectType',
      'subjectId',
      'dedupKey',
      'status',
      'reason',
      'priority',
      'providerKey',
      'modelVersion',
      'payload',
      'attempts',
      'lastError',
      'createdAt',
      'startedAt',
      'finishedAt',
      'scheduledFor',
      'rateLimitedAt',
      'rateLimitHits',
      'claimedByNodeId',
      'leaseExpiresAt',
      'executor',
    ].sort();

    const actual = Object.keys(Prisma.JobScalarFieldEnum).sort();

    expect(actual).toEqual(expected);
  });

  it('maps every field name to itself, matching how Prisma builders reference it', () => {
    for (const field of Object.keys(Prisma.JobScalarFieldEnum)) {
      expect(Prisma.JobScalarFieldEnum[field as keyof typeof Prisma.JobScalarFieldEnum]).toBe(
        field,
      );
    }
  });
});
