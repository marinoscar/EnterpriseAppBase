// PrincipalGroupsProvider (issue #728): lazy, cached, invalidated across
// replicas through the bus; never from request input.
import {
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalGroupsProvider,
  SHARING_GROUPS_INVALIDATE_CHANNEL,
} from '../../src/sharing/index';
import { ALICE, BOB, FakeBusNetwork, GROUP, ORG, fakeData, fakeTx, options, principal, type FakeTx } from './fakes';

function provider(tx: FakeTx, bus?: ReturnType<FakeBusNetwork['replica']>, ttlSeconds = 30, now = () => 0) {
  const p = new PrincipalGroupsProvider(fakeData(tx), options({ membershipCacheTtlSeconds: ttlSeconds }), bus, now);
  p.onModuleInit();
  return p;
}

describe('PrincipalGroupsProvider', () => {
  it('loads the memberships of the ACTIVE organization, scoped to it', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany.mockResolvedValue([{ groupId: GROUP, role: 'editor' }]);
    const data = fakeData(tx);
    const p = new PrincipalGroupsProvider(data, options(), undefined, () => 0);

    const scope = await p.scopeFor(principal());
    expect(scope).toEqual({ userId: ALICE, orgId: ORG, groupIds: [GROUP] });
    expect(data.scopes).toEqual([{ orgId: ORG, userId: ALICE }]);
    expect(tx.groupMember.findMany.mock.calls[0][0].where).toEqual({ userId: ALICE, orgId: ORG });
    expect(await p.groupRoleFor(principal(), GROUP)).toBe('editor');
    expect(await p.groupRoleFor(principal(), 'other')).toBeNull();
  });

  it('has no groups without an active organization, and loads nothing', async () => {
    const tx = fakeTx();
    const p = provider(tx);
    expect(await p.groupsFor(principal({ activeOrgId: undefined }))).toEqual([]);
    expect(tx.groupMember.findMany).not.toHaveBeenCalled();
  });

  it('loads once per request and serves the cache across requests until the TTL', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany.mockResolvedValue([{ groupId: GROUP, role: 'viewer' }]);
    let now = 0;
    const p = provider(tx, undefined, 30, () => now);
    const request = principal();
    await p.groupsFor(request);
    await p.groupsFor(request);
    await p.groupsFor(principal()); // a second request, within the TTL
    expect(tx.groupMember.findMany).toHaveBeenCalledTimes(1);
    now = 31_000;
    await p.groupsFor(principal());
    expect(tx.groupMember.findMany).toHaveBeenCalledTimes(2);
  });

  it('caches nothing with a TTL of 0', async () => {
    const tx = fakeTx();
    const p = provider(tx, undefined, 0);
    await p.groupsFor(principal());
    await p.groupsFor(principal());
    expect(tx.groupMember.findMany).toHaveBeenCalledTimes(2);
    expect(p.size()).toBe(0);
  });

  it('enrich() puts the groups on a frozen copy of the principal', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany.mockResolvedValue([{ groupId: GROUP, role: 'admin' }]);
    const enriched = await provider(tx).enrich(principal());
    expect(enriched.groups).toEqual([{ groupId: GROUP, orgId: ORG, role: 'admin' }]);
    expect(Object.isFrozen(enriched)).toBe(true);
  });

  it('after a member is removed on replica A, the next request on replica B no longer sees the group', async () => {
    const network = new FakeBusNetwork();
    const txA = fakeTx();
    const txB = fakeTx();
    // The database: Bob is a member until the removal commits.
    let bobIsMember = true;
    const rows = () => (bobIsMember ? [{ groupId: GROUP, role: 'viewer' }] : []);
    txA.groupMember.findMany.mockImplementation(async () => rows());
    txB.groupMember.findMany.mockImplementation(async () => rows());
    const replicaA = provider(txA, network.replica(1));
    const replicaB = provider(txB, network.replica(2));
    const bob = () => principal({ userId: BOB, email: 'bob@example.com' });

    expect((await replicaB.scopeFor(bob())).groupIds).toEqual([GROUP]);
    expect(replicaB.size()).toBe(1);

    // Replica A commits the removal, then invalidates.
    bobIsMember = false;
    replicaA.invalidateUsers([BOB]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(replicaB.size()).toBe(0);
    expect((await replicaB.scopeFor(bob())).groupIds).toEqual([]);
  });

  it('a read that started before an invalidation does not store its stale result', async () => {
    const tx = fakeTx();
    let release!: (rows: unknown[]) => void;
    tx.groupMember.findMany.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const p = provider(tx);
    const pending = p.groupsFor(principal());
    await new Promise((resolve) => setImmediate(resolve));
    p.invalidateUsers([ALICE]);
    release([{ groupId: GROUP, role: 'viewer' }]);
    await pending;
    expect(p.size()).toBe(0);
  });

  it("drops a user's entries on the identity cache's channel too", async () => {
    const network = new FakeBusNetwork();
    const tx = fakeTx();
    const p = provider(tx, network.replica(2));
    await p.groupsFor(principal());
    expect(p.size()).toBe(1);
    await network.replica(1).publish(PRINCIPAL_INVALIDATE_CHANNEL, { userId: ALICE });
    expect(p.size()).toBe(0);
    await p.groupsFor(principal());
    await network.replica(1).publish(PRINCIPAL_INVALIDATE_CHANNEL, { all: true });
    expect(p.size()).toBe(0);
  });

  it('ignores a malformed bus message and publishes ids only, in bounded batches', async () => {
    const network = new FakeBusNetwork();
    const seen: unknown[] = [];
    const observer = network.replica(9);
    observer.subscribe(SHARING_GROUPS_INVALIDATE_CHANNEL, (payload) => {
      seen.push(payload);
    });
    const p = provider(fakeTx(), network.replica(1));
    await network.replica(3).publish(SHARING_GROUPS_INVALIDATE_CHANNEL, { userIds: 'nope' });
    const ids = Array.from({ length: 150 }, (_, i) => `user-${i}`);
    p.invalidateUsers(ids);
    await new Promise((resolve) => setImmediate(resolve));
    const batches = seen.filter((m) => Array.isArray((m as { userIds?: unknown }).userIds) && ((m as { userIds: string[] }).userIds[0] ?? '').startsWith('user-'));
    expect(batches.map((m) => (m as { userIds: string[] }).userIds.length)).toEqual([100, 50]);
  });
});
