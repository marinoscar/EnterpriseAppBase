import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as contract from '../../src/core/principal/principal.types';
import type {
  CredentialKind,
  GroupMembership,
  NodePrincipal,
  OrgMembership,
  Principal,
  PrincipalKind,
  Scope,
  SystemActor,
  TenancyMode,
  UserPrincipal,
} from '../../src/core';

// =============================================================================
// The principal and scope contract, pinned at type level (ADR 0001)
// =============================================================================
//
// Moved from apps/api/src/common/principal/principal.types.spec.ts (issue
// #698) with its assertions unchanged. The part that needs the app's
// `RequestUser` (the ADR's mapping from today's request user) stays in the
// app, in apps/api/test/platform/principal-request-user.spec.ts: a package
// test cannot import application code. The types are imported through the
// slice's public entry point (`src/core`), so a type dropped from
// `core/index.ts` fails here too.
//
// MOST OF THIS FILE IS CHECKED BY `tsc`, NOT BY JEST. Jest transpiles specs
// with `isolatedModules` and never type-checks them; `npm run typecheck`
// (tsc --noEmit over src/** and test/**) does. So:
//
//   - `Expect<Equal<...>>` aliases fail typecheck when a type drifts from the
//     contract in docs/adr/0001-org-aware-principal-and-scope.md.
//   - Every `@ts-expect-error` below marks a line that MUST NOT compile. If
//     the contract loosens and the line starts compiling, the directive is
//     unused and typecheck fails. Each directive sits directly above a
//     single-line statement so the error it expects cannot drift to a
//     neighbouring line.
//
// The runtime `it`s are deliberately small: they keep Jest from reporting an
// empty suite and pin the two properties a type cannot express (the module
// has no runtime exports, and the source imports nothing).
// =============================================================================

/** `true` only when A and B are the same type (not merely mutually assignable). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails typecheck unless T is `true`. */
type Expect<T extends true> = T;

// -----------------------------------------------------------------------------
// The closed unions are exactly the ADR's values
// -----------------------------------------------------------------------------

export type ContractUnions = [
  Expect<Equal<TenancyMode, 'single' | 'multi'>>,
  Expect<Equal<CredentialKind, 'session' | 'device' | 'pat' | 'node'>>,
  Expect<Equal<PrincipalKind, 'user' | 'node'>>,
  Expect<Equal<Principal, UserPrincipal | NodePrincipal>>,
  Expect<Equal<UserPrincipal['credential'], 'session' | 'device' | 'pat'>>,
  Expect<Equal<NodePrincipal['credential'], 'node'>>,
  Expect<Equal<Principal['kind'], PrincipalKind>>,
  Expect<Equal<SystemActor['kind'], 'system'>>,
];

// -----------------------------------------------------------------------------
// Field shapes: required vs optional, readonly arrays
// -----------------------------------------------------------------------------

export type ContractFields = [
  Expect<Equal<Scope, { readonly userId: string; readonly orgId?: string; readonly groupIds?: readonly string[] }>>,
  Expect<Equal<SystemActor, { readonly kind: 'system'; readonly reason: string }>>,
  Expect<Equal<OrgMembership, { readonly orgId: string; readonly role: string; readonly status?: 'active' | 'suspended' }>>,
  Expect<Equal<GroupMembership, { readonly groupId: string; readonly orgId: string; readonly role: string }>>,
  Expect<Equal<Principal['userId'], string>>,
  Expect<Equal<Principal['email'], string>>,
  Expect<Equal<Principal['roles'], readonly string[]>>,
  Expect<Equal<Principal['permissions'], readonly string[]>>,
  Expect<Equal<Principal['activeOrgId'], string | undefined>>,
  Expect<Equal<Principal['memberships'], readonly OrgMembership[] | undefined>>,
  Expect<Equal<Principal['groups'], readonly GroupMembership[] | undefined>>,
  Expect<Equal<NodePrincipal['nodeId'], string | undefined>>,
  // No `isActive`: an inactive user never becomes a principal.
  Expect<Equal<'isActive' extends keyof Principal ? true : false, false>>,
  // `nodeId` exists on the node variant only.
  Expect<Equal<'nodeId' extends keyof UserPrincipal ? true : false, false>>,
];

// -----------------------------------------------------------------------------
// The ADR's derivations, written out as local functions
// -----------------------------------------------------------------------------
//
// Local, not exported helpers: the runtime `toPrincipal()` is not part of
// this contract yet (issue #724).

function userPrincipalFrom(
  user: { id: string; email: string; roles: string[]; permissions: string[] },
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

function nodePrincipalFrom(
  owner: { id: string; email: string; roles: string[]; permissions: string[] },
  nodeId?: string,
): NodePrincipal {
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
function scopeOf(principal: Principal): Scope {
  return {
    userId: principal.userId,
    orgId: principal.activeOrgId,
    groupIds: principal.groups?.map((group) => group.groupId),
  };
}

// -----------------------------------------------------------------------------
// Lines that must not compile
// -----------------------------------------------------------------------------

/** Never called: it exists so `tsc` checks the `@ts-expect-error` lines inside it. */
export function contractRejections(principal: UserPrincipal, scope: Scope): void {
  // A Scope always names its user.
  // @ts-expect-error userId is required
  const noUser: Scope = { orgId: 'org_1' };

  // A principal is a snapshot: no field can be reassigned.
  // @ts-expect-error userId is readonly
  principal.userId = 'someone-else';
  // @ts-expect-error credential is readonly
  principal.credential = 'pat';
  // @ts-expect-error roles is a readonly array
  principal.roles.push('Admin');
  // @ts-expect-error orgId is readonly
  scope.orgId = 'org_2';

  // A node principal only ever authenticated with a node credential.
  // @ts-expect-error credential must be 'node'
  const patNode: NodePrincipal = { kind: 'node', userId: 'u', email: 'e', credential: 'pat', roles: [], permissions: [] };

  // ...and a user principal never did.
  // @ts-expect-error credential must be 'session' | 'device' | 'pat'
  const nodeUser: UserPrincipal = { kind: 'user', userId: 'u', email: 'e', credential: 'node', roles: [], permissions: [] };

  // Unscoped work always says why.
  // @ts-expect-error reason is required
  const silentSystem: SystemActor = { kind: 'system' };

  void [noUser, patNode, nodeUser, silentSystem];
}

// -----------------------------------------------------------------------------
// Runtime
// -----------------------------------------------------------------------------

const requestUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@example.test',
  roles: ['Viewer'],
  permissions: ['users:read'],
  isActive: true,
};

describe('principal and scope contract', () => {
  it('has no runtime exports', () => {
    expect(Object.keys(contract)).toEqual([]);
  });

  it('imports nothing, so it can move into a package unchanged', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'core', 'principal', 'principal.types.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('builds a user principal and its scope from a request user and a credential kind', () => {
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
