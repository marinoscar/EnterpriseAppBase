// Test doubles for the sharing slice's unit specs (issue #728). Not a spec.

import type { Principal } from '../../src/core/index';
import type { SharingDataPort, SharingEventBus } from '../../src/sharing/index';
import { resolveSharingModuleOptions, type SharingGroupsOptions } from '../../src/sharing/sharing.options';
import { definePlatformHost } from '../../src/core/index';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
export const GROUP = '33333333-3333-4333-8333-333333333333';
export const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const INVITE = '44444444-4444-4444-8444-444444444444';

const noop = (() => () => undefined) as unknown as () => MethodDecorator & ClassDecorator;
export const testHost = definePlatformHost({ access: { requirePermissions: noop, requireAuthenticated: noop } });

export function options(groups: SharingGroupsOptions = {}) {
  return resolveSharingModuleOptions({ host: testHost, groups });
}

export function principal(overrides: Partial<Principal> & { permissions?: string[] } = {}): Principal {
  return {
    kind: 'user',
    userId: ALICE,
    email: 'alice@example.com',
    credential: 'session',
    roles: [],
    permissions: ['groups:read', 'groups:write'],
    activeOrgId: ORG,
    memberships: [{ orgId: ORG, role: 'contributor' }],
    ...overrides,
  } as Principal;
}

type Fn = jest.Mock;
export interface FakeDelegate {
  findUnique: Fn;
  findFirst: Fn;
  findMany: Fn;
  count: Fn;
  create: Fn;
  update: Fn;
  updateMany: Fn;
  delete: Fn;
  deleteMany: Fn;
}

function delegate(): FakeDelegate {
  return {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-id', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), version: 1, ...data })),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
}

export interface FakeTx {
  group: FakeDelegate;
  groupMember: FakeDelegate;
  groupInvite: FakeDelegate;
  user: FakeDelegate;
  membership: FakeDelegate;
  invite: FakeDelegate;
  auditEvent: { create: Fn };
  $queryRaw: Fn;
  $executeRaw: Fn;
}

export function fakeTx(): FakeTx {
  return {
    group: delegate(),
    groupMember: delegate(),
    groupInvite: delegate(),
    user: delegate(),
    membership: delegate(),
    invite: delegate(),
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
}

/** A data port that runs every unit of work against `tx`, recording the scopes. */
export function fakeData(tx: FakeTx): SharingDataPort & { scopes: Array<{ orgId: string; userId?: string }>; systemReasons: string[] } {
  const scopes: Array<{ orgId: string; userId?: string }> = [];
  const systemReasons: string[] = [];
  return {
    scopes,
    systemReasons,
    runInOrg: async (scope, fn) => {
      scopes.push(scope);
      return fn(tx);
    },
    runAsSystem: async (reason, fn) => {
      systemReasons.push(reason);
      return fn(tx);
    },
  };
}

/** An in-memory bus shared by several "replicas": local delivery is flagged, like the real one. */
export class FakeBusNetwork {
  private readonly handlers: Array<{ replica: number; channel: string; handler: (payload: unknown, meta: { local: boolean }) => void }> = [];

  replica(id: number): SharingEventBus {
    return {
      publish: async (channel, payload) => {
        const copy = JSON.parse(JSON.stringify(payload)) as unknown;
        for (const h of this.handlers.filter((x) => x.channel === channel)) h.handler(copy, { local: h.replica === id });
      },
      subscribe: (channel, handler) => {
        const entry = { replica: id, channel, handler: handler as (payload: unknown, meta: { local: boolean }) => void };
        this.handlers.push(entry);
        return () => this.handlers.splice(this.handlers.indexOf(entry), 1);
      },
    };
  }
}

export function memberRow(userId: string, role: 'admin' | 'editor' | 'viewer', extra: Record<string, unknown> = {}) {
  return {
    id: `m-${userId}`,
    groupId: GROUP,
    userId,
    orgId: ORG,
    role,
    addedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    user: { email: `${userId.slice(0, 5)}@example.com`, displayName: null, providerDisplayName: 'P' },
    ...extra,
  };
}

export function groupRow(extra: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    orgId: ORG,
    name: 'Family',
    description: null,
    metadata: null,
    createdById: ALICE,
    version: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...extra,
  };
}

import { SharingEffects } from '../../src/sharing/groups/sharing-effects';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import type { SharingNotifier } from '../../src/sharing/ports';

/** Real SharingEffects over spies: the emitter, the notifier and the cache invalidation. */
export function fakeEffects(tx: FakeTx) {
  const principalGroups = new PrincipalGroupsProvider(fakeData(tx), options(), undefined, () => 0);
  const invalidated: string[][] = [];
  jest.spyOn(principalGroups, 'invalidateUsers').mockImplementation((ids) => {
    invalidated.push([...ids]);
  });
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const emitter = { emit: jest.fn((name: string, payload: unknown) => emitted.push({ name, payload })) };
  const notifier: SharingNotifier & { notify: jest.Mock; notifyAddress: jest.Mock } = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyAddress: jest.fn().mockResolvedValue(undefined),
  };
  const metrics = { add: jest.fn() };
  const effects = new SharingEffects(principalGroups, emitter, notifier, metrics as never);
  return { effects, invalidated, emitted, emitter, notifier, metrics };
}

/** Every string a value contains, deeply (for the "no e-mail" assertions). */
export function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(stringsIn);
}
