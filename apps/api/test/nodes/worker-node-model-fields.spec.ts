// =============================================================================
// Locks down the generated `WorkerNode` / `NodeCredential` scalar field name
// sets (issue #267, epic #254)
// =============================================================================
//
// This is the schema-only half of #267 — the service, the guard's `nod_`
// branch, and the `/api/node-credentials` endpoints all arrive in the
// backend half of the same issue, and the node control plane that actually
// mutates `WorkerNode` rows is #268. What can be locked down here, before any
// of that exists, is the field set itself: a column renamed or dropped on
// either model should fail loudly, here, naming the field — not surface
// later as a silently `undefined` property in the service #268 builds on top
// of this schema. Same purpose and same technique as
// `test/jobs/job-model-fields.spec.ts`, asserted against
// `Prisma.WorkerNodeScalarFieldEnum` / `Prisma.NodeCredentialScalarFieldEnum`
// (generated straight from `prisma/schema.prisma` by `prisma generate`)
// rather than a hand-copied list read off the schema file, so this spec
// fails the moment the two actually disagree.
// =============================================================================

import { NodeStatus, Prisma } from '@prisma/client';

describe('Prisma.WorkerNodeScalarFieldEnum', () => {
  it('has exactly the field names WorkerNode is documented to have', () => {
    const expected = [
      'id',
      'name',
      'hostname',
      'platform',
      'cliVersion',
      'eligibleTypes',
      'concurrency',
      'status',
      'capabilities',
      'registeredAt',
      'lastHeartbeatAt',
      'createdById',
    ].sort();

    const actual = Object.keys(Prisma.WorkerNodeScalarFieldEnum).sort();

    expect(actual).toEqual(expected);
  });

  it('maps every field name to itself, matching how Prisma builders reference it', () => {
    for (const field of Object.keys(Prisma.WorkerNodeScalarFieldEnum)) {
      expect(
        Prisma.WorkerNodeScalarFieldEnum[field as keyof typeof Prisma.WorkerNodeScalarFieldEnum]
      ).toBe(field);
    }
  });
});

describe('Prisma.NodeCredentialScalarFieldEnum', () => {
  it('has exactly the field names NodeCredential is documented to have', () => {
    // Deliberately mirrors PersonalAccessToken minus the duration bookkeeping
    // (durationValue/durationUnit) — see the block comment above
    // `NodeCredential` in prisma/schema.prisma for why `expiresAt` is
    // nullable here even though it is required on PersonalAccessToken.
    const expected = [
      'id',
      'userId',
      'name',
      'tokenHash',
      'tokenPrefix',
      'expiresAt',
      'lastUsedAt',
      'createdAt',
      'revokedAt',
    ].sort();

    const actual = Object.keys(Prisma.NodeCredentialScalarFieldEnum).sort();

    expect(actual).toEqual(expected);
  });

  it('maps every field name to itself, matching how Prisma builders reference it', () => {
    for (const field of Object.keys(Prisma.NodeCredentialScalarFieldEnum)) {
      expect(
        Prisma.NodeCredentialScalarFieldEnum[
          field as keyof typeof Prisma.NodeCredentialScalarFieldEnum
        ]
      ).toBe(field);
    }
  });

  it('does NOT carry PersonalAccessToken\'s duration bookkeeping columns', () => {
    // The one deliberate structural divergence from PersonalAccessToken,
    // asserted directly so a future "just copy the PAT shape" edit is caught.
    const fields = Object.keys(Prisma.NodeCredentialScalarFieldEnum);
    expect(fields).not.toContain('durationValue');
    expect(fields).not.toContain('durationUnit');
  });
});

describe('NodeStatus enum', () => {
  it('has exactly the four documented states', () => {
    expect(Object.keys(NodeStatus).sort()).toEqual(
      ['online', 'draining', 'offline', 'disabled'].sort()
    );
  });

  it('maps every member to itself, matching how Prisma builders reference it', () => {
    for (const key of Object.keys(NodeStatus)) {
      expect(NodeStatus[key as keyof typeof NodeStatus]).toBe(key);
    }
  });
});
