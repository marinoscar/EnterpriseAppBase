import type { CredentialKind, NodePrincipal, Scope, UserPrincipal } from '@marinoscar/platform-api/core';

import type { RequestUser } from '../../src/auth/interfaces/authenticated-user.interface';

// =============================================================================
// Today's RequestUser maps onto the platform principal contract (ADR 0001)
// =============================================================================
//
// The principal and scope types live in `@marinoscar/platform-api/core`
// (issue #698), pinned there by the package's `test/core/principal.spec.ts`.
// This half of the original `principal.types.spec.ts` stays in the app
// because it needs the app's `RequestUser`: it proves that today's request
// user plus a `CredentialKind` is enough to build a principal, with no
// missing data. Assertions unchanged from the original spec.
//
// THE TYPE ALIASES BELOW ARE CHECKED BY `tsc` (npm run typecheck), NOT BY
// JEST: Jest transpiles specs with `isolatedModules` and never type-checks.
// =============================================================================

/** `true` only when A and B are the same type (not merely mutually assignable). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails typecheck unless T is `true`. */
type Expect<T extends true> = T;

/** Every RequestUser field except `isActive` (dropped) has a home on the principal. */
type RequestUserFieldsCarried = Exclude<keyof RequestUser, 'isActive' | 'id'> | 'userId';
export type RequestUserCoverage = [
  Expect<Equal<RequestUserFieldsCarried extends keyof UserPrincipal ? true : false, true>>,
  Expect<Equal<RequestUser['roles'] extends UserPrincipal['roles'] ? true : false, true>>,
  Expect<Equal<RequestUser['permissions'] extends UserPrincipal['permissions'] ? true : false, true>>,
];

// The mapping the ADR specifies, written out as an object literal. Local
// functions on purpose: they pin the ADR's mapping from today's `RequestUser`
// independently of the runtime `toPrincipal()` (#724,
// `src/auth/principal.factory.ts`), which builds the principal from the
// loaded graph instead.

function userPrincipalFrom(
  user: RequestUser,
  credential: Exclude<CredentialKind, 'node'>,
): UserPrincipal {
  return {
    kind: 'user',
    userId: user.id,
    email: user.email,
    credential,
    roles: user.roles,
    permissions: user.permissions,
  };
}

function nodePrincipalFrom(owner: RequestUser, nodeId?: string): NodePrincipal {
  return {
    kind: 'node',
    userId: owner.id,
    email: owner.email,
    credential: 'node',
    roles: owner.roles,
    permissions: owner.permissions,
    nodeId,
  };
}

/** The ADR's scope derivation: from the principal only. */
function scopeOf(principal: UserPrincipal | NodePrincipal): Scope {
  return {
    userId: principal.userId,
    orgId: principal.activeOrgId,
    groupIds: principal.groups?.map((group) => group.groupId),
  };
}

const requestUser: RequestUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@example.test',
  roles: ['Viewer'],
  permissions: ['users:read'],
  isActive: true,
};

describe('RequestUser to platform principal (ADR 0001)', () => {
  it('builds a user principal and its scope from a RequestUser and a credential kind', () => {
    const principal = userPrincipalFrom(requestUser, 'device');

    expect(principal).toEqual({
      kind: 'user',
      userId: requestUser.id,
      email: requestUser.email,
      credential: 'device',
      roles: ['Viewer'],
      permissions: ['users:read'],
    });
    expect(scopeOf(principal)).toEqual({ userId: requestUser.id });
  });

  it('builds a node principal acting as its owner', () => {
    const principal = nodePrincipalFrom(requestUser, 'node_1');

    expect(principal.kind).toBe('node');
    expect(principal.credential).toBe('node');
    expect(scopeOf(principal).userId).toBe(requestUser.id);
  });
});
