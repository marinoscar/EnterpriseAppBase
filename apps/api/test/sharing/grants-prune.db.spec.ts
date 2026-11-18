// =============================================================================
// Real Postgres: the sharing.grants.prune job and deleteForResources (#729)
// =============================================================================
//
// On a throwaway RLS database with the TEST-ONLY `sharing_test_docs` table:
//
//   - grants revoked or expired more than `grants.retentionDays` ago are
//     deleted, in chunks (more rows than one chunk), across organizations;
//     recent ones and active ones stay;
//   - grants whose record no longer exists (a delete that forgot
//     `deleteForResources`) are deleted, through the type's `loadOwners`;
//   - `GrantsService.deleteForResources()` called inside the deleting
//     transaction leaves no grant behind.
// =============================================================================

import { GRANTS_PRUNE_CHUNK } from '@marinoscar/platform-api/sharing';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';
import { TEST_DOC_TYPE, asSystem, createTestDocsTable, inOrg, insertDoc, registerTestDocType } from './sharing-test-docs.helper';

const { describeWithDb } = resolveDbSuite('grants-prune.db.spec');

describeWithDb('sharing.grants.prune (real Postgres)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  let alice: string;
  let bob: string;

  /** Inserts `n` grants of `doc` to `user` in `org`, revoked or expired `ageDays` ago (or active with `ageDays` null). */
  const seedGrants = (org: string, doc: string, user: string, n: number, state: { revokedDaysAgo?: number; expiredDaysAgo?: number }) =>
    asSystem(db, (tx) =>
      tx.$executeRaw`INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, revoked_at, expires_at, created_at, updated_at)
                     SELECT gen_random_uuid(), ${org}::uuid, ${TEST_DOC_TYPE}, ${doc}::uuid, 'user', ${user}::uuid, 'viewer',
                            ${state.revokedDaysAgo === undefined ? null : new Date(Date.now() - state.revokedDaysAgo * 86_400_000)}::timestamptz,
                            ${state.expiredDaysAgo === undefined ? null : new Date(Date.now() - state.expiredDaysAgo * 86_400_000)}::timestamptz,
                            now(), now()
                     FROM generate_series(1, ${n}::int)`,
    );
  const countFor = (doc: string) => asSystem(db, (tx) => tx.grant.count({ where: { resourceId: doc } }));

  beforeAll(async () => {
    db = await createRlsDatabase('gprune');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    alice = await seedUser(db, 'alice@example.test', [ORG_A, ORG_B]);
    bob = await seedUser(db, 'bob@example.test', [ORG_A, ORG_B]);
    await createTestDocsTable(db);
    registerTestDocType();
    sharing = await sharingServices(db, 'single', { grants: { retentionDays: 30 } });
  }, 240_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  it('deletes revoked and expired grants past the retention in chunks, in every organization, and keeps the rest', async () => {
    const oldA = await insertDoc(db, { orgId: ORG_A, ownerUserId: bob });
    const oldB = await insertDoc(db, { orgId: ORG_B, ownerUserId: bob });
    const recent = await insertDoc(db, { orgId: ORG_A, ownerUserId: bob });
    const live = await insertDoc(db, { orgId: ORG_A, ownerUserId: bob });
    // More old revoked rows than one chunk (revoked rows are not under the active-grant index).
    await seedGrants(ORG_A, oldA, alice, GRANTS_PRUNE_CHUNK + 20, { revokedDaysAgo: 40 });
    // An expired (unrevoked) grant still holds its grantee's active slot: one per user.
    await seedGrants(ORG_B, oldB, alice, 1, { expiredDaysAgo: 31 });
    await seedGrants(ORG_B, oldB, bob, 1, { expiredDaysAgo: 31 });
    await seedGrants(ORG_A, recent, alice, 1, { revokedDaysAgo: 5 });
    await seedGrants(ORG_A, recent, bob, 1, { expiredDaysAgo: 5 });
    await sharing.grants.create(
      { kind: 'user', userId: bob, email: 'bob@example.test', credential: 'session', roles: [], permissions: ['sharing:read', 'sharing:write'], activeOrgId: ORG_A },
      { resourceType: TEST_DOC_TYPE, resourceId: live, role: 'editor', grantee: { kind: 'user', userId: alice } },
    );

    const summary = await sharing.prune.prune();

    expect(summary.expiredOrRevoked).toBe(GRANTS_PRUNE_CHUNK + 22);
    expect(summary.chunks).toBeGreaterThanOrEqual(2);
    expect([await countFor(oldA), await countFor(oldB), await countFor(recent), await countFor(live)]).toEqual([0, 0, 2, 1]);

    // A second run finds nothing more to delete.
    expect((await sharing.prune.prune()).expiredOrRevoked).toBe(0);
  });

  it('deletes the grants of records that no longer exist, and only those', async () => {
    const kept = await insertDoc(db, { orgId: ORG_A, ownerUserId: bob });
    const gone = await insertDoc(db, { orgId: ORG_B, ownerUserId: bob });
    await seedGrants(ORG_A, kept, alice, 1, {});
    await seedGrants(ORG_B, gone, alice, 1, {});
    await seedGrants(ORG_B, gone, bob, 1, { revokedDaysAgo: 1 });
    // The app deleted the record and forgot deleteForResources().
    await asSystem(db, (tx) => tx.$executeRaw`DELETE FROM sharing_test_docs WHERE id = ${gone}::uuid`);

    const summary = await sharing.prune.prune();

    expect(summary.dangling).toEqual({ [TEST_DOC_TYPE]: 2 });
    expect([await countFor(kept), await countFor(gone)]).toEqual([1, 0]);
  });

  it('deleteForResources inside the deleting transaction leaves no grant behind', async () => {
    const doomed = await insertDoc(db, { orgId: ORG_A, ownerUserId: bob });
    await seedGrants(ORG_A, doomed, alice, 1, {});
    await seedGrants(ORG_A, doomed, bob, 2, { revokedDaysAgo: 1 });

    const deleted = await inOrg(db, ORG_A, async (tx) => {
      const n = await sharing.grants.deleteForResources(tx, TEST_DOC_TYPE, [doomed]);
      await tx.$executeRaw`DELETE FROM sharing_test_docs WHERE id = ${doomed}::uuid`;
      return n;
    });

    expect(deleted).toBe(3);
    expect(await countFor(doomed)).toBe(0);
  });
});
