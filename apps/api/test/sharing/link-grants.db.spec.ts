// =============================================================================
// Real Postgres: link grants and the public-route pattern (issue #730, PP-7.3)
// =============================================================================
//
// The sharing services exactly as the app wires them, on a throwaway database
// owned by an ordinary role (row-level security applies), against the
// TEST-ONLY table `sharing_test_docs` (./sharing-test-docs.helper.ts), with a
// guarded app route served over Fastify:
//
//   - the stored row holds the SHA-256 hash and the ciphertext, never the
//     clear token (read back through the bypass), and `link_token_hash` is
//     unique;
//   - resolution's one cross-organization read is ONE `grants` lookup by the
//     hash on the bypass client (`link-resolution`); everything else runs in
//     the grant's organization;
//   - a guarded app route that FORGETS its own `where` still reads only the
//     link's organization through `withLinkScope` (two organizations);
//   - a link of another type on that route, an unknown, a revoked and an
//     expired token are the identical 404.
// =============================================================================

import { createHash } from 'node:crypto';

// Must precede the first encrypt: the secret cipher caches its master key.
const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import type { Principal } from '@marinoscar/platform-api/core';
import {
  CurrentLinkGrant,
  LinkGrantGuard,
  LinkGrantResource,
  LinkGrantsService,
  registerResourceType,
  resourceTypeRegistry,
  type ResolvedLinkGrant,
  type SharingDataPort,
} from '@marinoscar/platform-api/sharing';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';
import { TEST_DOC_TYPE, asSystem, createTestDocsTable, insertDoc, registerTestDocType, testDocType } from './sharing-test-docs.helper';

const { describeWithDb } = resolveDbSuite('link-grants.db.spec');

/** A second link-shareable type over the same table, for the wrong-type case. */
const NOTE_TYPE = 'sharing_test_note';

/** Records every operation the bypass client runs. */
const systemCalls: Array<{ reason: string; op: string; args: unknown }> = [];
function recordSystem(inner: SharingDataPort): SharingDataPort {
  return {
    runInOrg: (scope, fn) => inner.runInOrg(scope, fn),
    runAsSystem: (reason, fn) =>
      inner.runAsSystem(reason, (tx) =>
        fn(
          new Proxy(tx as object, {
            get(target, model) {
              const delegate = Reflect.get(target, model) as unknown;
              if (typeof model !== 'string' || model.startsWith('$') || !delegate || typeof delegate !== 'object') {
                if (typeof model === 'string' && model.startsWith('$')) systemCalls.push({ reason, op: model, args: null });
                return delegate;
              }
              return new Proxy(delegate, {
                get(d, method) {
                  const fnc = Reflect.get(d, method) as unknown;
                  if (typeof fnc !== 'function') return fnc;
                  return (args: unknown) => {
                    systemCalls.push({ reason, op: `${model}.${String(method)}`, args });
                    return (fnc as (a: unknown) => unknown).call(d, args);
                  };
                },
              });
            },
          }),
        ),
      ),
  };
}

@Controller('public/test-docs')
@UseGuards(LinkGrantGuard)
class PublicTestDocsController {
  constructor(@Inject(LinkGrantsService) private readonly links: LinkGrantsService) {}

  /** An app route that FORGETS its own `where`: row-level security alone confines it. */
  @Get('forgetful')
  @LinkGrantResource(TEST_DOC_TYPE, { action: 'read' })
  forgetful(@CurrentLinkGrant() link: ResolvedLinkGrant) {
    return this.links.withLinkScope(link, async (tx) => {
      const db = tx as Prisma.TransactionClient;
      const docs = await db.$queryRaw<Array<{ id: string; org_id: string }>>`SELECT id::text, org_id::text FROM sharing_test_docs ORDER BY id`;
      const grants = await db.$queryRaw<Array<{ org_id: string }>>`SELECT org_id::text FROM grants`;
      return { link: link.resourceId, docs, grantOrgs: [...new Set(grants.map((g) => g.org_id))] };
    });
  }
}

describeWithDb('link grants (real Postgres)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  const u = { alice: '', dave: '' };
  const docs: Record<string, string> = {};

  const alice = (): Principal => principalOf(u.alice, 'alice@example.test', ORG_A, 'contributor');
  const dave = (): Principal => principalOf(u.dave, 'dave@example.test', ORG_B, 'contributor');
  const http = () => request(sharing.app!.getHttpServer());
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    db = await createRlsDatabase('links');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    u.alice = await seedUser(db, 'alice@example.test', [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createTestDocsTable(db);
    registerTestDocType(testDocType({ grantable: { link: ['viewer'] } }));
    if (!resourceTypeRegistry.has(NOTE_TYPE)) {
      const base = testDocType();
      registerResourceType({ type: NOTE_TYPE, roles: ['viewer'], actions: { read: 'viewer', share: 'owner' }, ownership: 'user', grantable: { link: ['viewer'] }, loadOwners: base.loadOwners });
    }
    sharing = await sharingServices(db, 'single', { wrapData: recordSystem, controllers: [PublicTestDocsController] });

    docs.a1 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'A one' });
    docs.a2 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'A two' });
    docs.b1 = await insertDoc(db, { orgId: ORG_B, ownerUserId: u.dave, title: 'B one' });
    docs.b2 = await insertDoc(db, { orgId: ORG_B, ownerUserId: u.dave, title: 'B two' });
    // ORG_B has a link of its own, so its grants exist for the scope to hide.
    await sharing.links.create(dave(), { resourceType: TEST_DOC_TYPE, resourceId: docs.b1 });
  }, 240_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }, 60_000);

  it('stores the hash and the ciphertext, never the clear token', async () => {
    const issued = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a1, label: 'Printer' });
    const [row] = await asSystem(db, (tx) => tx.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM grants WHERE id = ${issued.grant.id}::uuid`);
    expect(row).toMatchObject({ grantee_kind: 'link', link_token_hash: sha256(issued.token), link_label: 'Printer', grantee_user_id: null, grantee_group_id: null });
    expect(typeof row!.link_token_ciphertext).toBe('string');
    for (const value of Object.values(row!)) expect(String(value)).not.toContain(issued.token);
    expect(issued.url).toBe(`https://links.example.test/s#${issued.token}`);
  });

  it('keeps link_token_hash unique', async () => {
    const issued = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2 });
    await expect(
      asSystem(db, (tx) =>
        tx.$executeRaw`INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, link_token_hash, role, created_at, updated_at)
                       VALUES (gen_random_uuid(), ${ORG_A}::uuid, ${TEST_DOC_TYPE}, ${docs.a2}::uuid, 'link', ${sha256(issued.token)}, 'viewer', now(), now())`,
      ),
    ).rejects.toThrow(/grants_link_token_hash_key/);
  });

  it('resolves with ONE bypass lookup of grants by the hash; the rest runs in the grant org', async () => {
    const issued = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a1 });
    systemCalls.length = 0;
    const result = await sharing.links.resolve(issued.token, { resourceType: TEST_DOC_TYPE, action: 'read' });
    expect(result).toMatchObject({ ok: true, link: { orgId: ORG_A, resourceId: docs.a1, role: 'viewer' } });
    expect(systemCalls).toEqual([{ reason: 'link-resolution', op: 'grant.findUnique', args: expect.objectContaining({ where: { linkTokenHash: sha256(issued.token) } }) }]);
  });

  it('serves a guarded app route that forgets its where: the scope reads only the link organization', async () => {
    const issued = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a1 });
    const res = await http().get('/public/test-docs/forgetful').set('X-Link-Token', issued.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    // Both ORG_A docs (no `where`!), neither ORG_B doc; only ORG_A grants.
    expect(res.body.docs.map((d: { id: string }) => d.id).sort()).toEqual([docs.a1, docs.a2].sort());
    expect(res.body.docs.every((d: { org_id: string }) => d.org_id === ORG_A)).toBe(true);
    expect(res.body.grantOrgs).toEqual([ORG_A]);

    // And the other way round: ORG_B's link sees ORG_B only.
    const theirs = await sharing.links.create(dave(), { resourceType: TEST_DOC_TYPE, resourceId: docs.b2 });
    const other = await http().get('/public/test-docs/forgetful').set('X-Link-Token', theirs.token).expect(200);
    expect(other.body.docs.map((d: { id: string }) => d.id).sort()).toEqual([docs.b1, docs.b2].sort());
  });

  it('answers a wrong-type, unknown, revoked or expired link on the guarded route with the identical 404', async () => {
    const note = await sharing.links.create(alice(), { resourceType: NOTE_TYPE, resourceId: docs.a2 });
    const revoked = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2 });
    await sharing.grants.revoke(alice(), revoked.grant.id);
    const expired = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2 });
    await asSystem(db, (tx) => tx.$executeRaw`UPDATE grants SET expires_at = now() - interval '1 minute' WHERE id = ${expired.grant.id}::uuid`);

    const bodies = [];
    for (const token of [note.token, `lnk_${'u'.repeat(43)}`, revoked.token, expired.token]) {
      const res = await http().get('/public/test-docs/forgetful').set('X-Link-Token', token);
      expect(res.status).toBe(404);
      bodies.push(res.body);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    // The same note link resolves on a route of its own type.
    expect(await sharing.links.resolve(note.token, { resourceType: NOTE_TYPE, action: 'read' })).toMatchObject({ ok: true });
  });

  it('reuses the active link with reuseActive and re-derives its URL in the list', async () => {
    const first = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2, reuseActive: true });
    const again = await sharing.links.create(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2, reuseActive: true });
    expect(again.grant.id).toBe(first.grant.id);
    expect(again.token).toBe(first.token);
    const list = await sharing.links.list(alice(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2, page: 1, pageSize: 50 });
    expect(list.items.find((item) => item.id === first.grant.id)?.url).toBe(first.url);
    // Dave (ORG_B) cannot list ORG_A's links: the same 404 as a missing record.
    await expect(sharing.links.list(dave(), { resourceType: TEST_DOC_TYPE, resourceId: docs.a2, page: 1, pageSize: 50 })).rejects.toThrow('Resource not found');
  });
});
