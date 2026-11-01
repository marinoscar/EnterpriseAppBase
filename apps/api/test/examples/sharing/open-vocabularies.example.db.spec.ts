// =============================================================================
// Real Postgres: an app group role and a persisted app grantee kind, end to end
// (PP-14.15b, #967)
// =============================================================================
//
// Over a database that enforces row-level security and the reference app's own
// sharing binding (./example-app.helper.ts), proves what ./open-vocabularies.example.ts
// registers:
//
//   - the `commenter` group role is stored as text, listed by GET
//     /api/sharing/group-roles, mapped by the resource type, and cannot
//     administer the group; a role nobody registered is refused (422) and a
//     registered role the type does not map holds nothing;
//   - the `email-domain` grantee kind is stored (`grantee_kind`, `grantee_ref`),
//     matched by the decision (in memory) and by "resources I can see" (SQL),
//     lists in "shared with me", and the DATABASE refuses a row of an
//     impossible shape or a second active grant of the same grantee;
//   - an app kind never reads another organization's rows.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';
import { accessibleSql } from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { bootExampleApp, signIn, type ExampleApp } from './example-app.helper';
import { createAlbumsTable, insertAlbum } from './example-tables.helper';
import { AUDITOR_ROLE, COMMENTER_ROLE, OPEN_ALBUM_TYPE, registerOpenVocabularies } from './open-vocabularies.example';

const { describeWithDb } = resolveDbSuite('open-vocabularies.example.db.spec');

// Registered at import time, like the app's registrations.
registerOpenVocabularies();

const data = <T>(body: { data?: T }): T => (body.data ?? body) as T;

describeWithDb('sharing examples: open vocabularies (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '', carol: '', erin: '', frank: '', dave: '' };
  const email = { alice: 'alice@example.test', bob: 'bob@example.test', carol: 'carol@example.test', erin: 'erin@example.test', frank: 'frank@other.org', dave: 'dave@example.test' };
  const g = { family: '', foreign: '' };
  const albums: Record<string, string> = {};

  const as = (name: keyof typeof u): Principal => principalOf(u[name], email[name], name === 'dave' ? ORG_B : ORG_A, 'contributor');
  const album = (key: string) => ({ type: OPEN_ALBUM_TYPE, id: albums[key]! });

  const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  async function listed(who: Principal, scope: 'groups' | 'shared' | 'all'): Promise<string[]> {
    const me = await ex.principalGroups.enrich(who);
    return ex.prisma.runInOrg(me.activeOrgId!, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT r.id::text AS id FROM sharing_test_albums r
        WHERE ${accessibleSql(me, OPEN_ALBUM_TYPE, 'r', { sqlKit: Prisma, scope })}`;
      return rows.map((row) => row.id);
    });
  }

  async function violation(sql: Prisma.Sql): Promise<string> {
    try {
      await asSystem((tx) => tx.$executeRaw(sql));
    } catch (error) {
      return String((error as Error).message);
    }
    return '';
  }

  beforeAll(async () => {
    db = await createRlsDatabase('ex_open_vocab');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin', 'frank'] as const) u[name] = await seedUser(db, email[name], [ORG_A]);
    u.dave = await seedUser(db, email.dave, [ORG_B]);
    await createAlbumsTable(db);
    ex = await bootExampleApp(db);

    g.family = (await ex.groups.create(as('alice'), { name: 'family' })).id;
    g.foreign = (await ex.groups.create(as('dave'), { name: 'foreign' })).id;
    albums.summer = await insertAlbum(db, { orgId: ORG_A, ownerGroupId: g.family, title: 'summer' });
    albums.winter = await insertAlbum(db, { orgId: ORG_A, ownerGroupId: g.family, title: 'winter' });
    albums.foreign = await insertAlbum(db, { orgId: ORG_B, ownerGroupId: g.foreign, title: 'foreign' });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
  }, 60_000);

  describe('an app group role (commenter)', () => {
    it('is listed with the built-ins, strongest first', async () => {
      const res = await ex.http().get('/sharing/group-roles').set(signIn(as('bob'))).expect(200);
      const items = data<{ items: Array<{ id: string; builtin: boolean; actions: string[] }> }>(res.body).items;
      expect(items.map((item) => item.id)).toEqual(['admin', 'editor', 'viewer', COMMENTER_ROLE, AUDITOR_ROLE]);
      expect(items.find((item) => item.id === COMMENTER_ROLE)).toMatchObject({ builtin: false, actions: ['read', 'comment'] });
      await ex.http().get('/sharing/group-roles').set(signIn({ ...as('bob'), permissions: [] })).expect(403);
    });

    it('is stored as text and maps through the resource type; a role the type does not map holds nothing', async () => {
      const added = await ex.http().post(`/groups/${g.family}/members`).set(signIn(as('alice'))).send({ userId: u.carol, role: COMMENTER_ROLE }).expect(201);
      expect(data<{ role: string }>(added.body).role).toBe(COMMENTER_ROLE);
      await ex.members.add(as('alice'), g.family, { userId: u.erin, role: AUDITOR_ROLE });
      const stored = await asSystem((tx) => tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM group_members WHERE user_id = ${u.carol}::uuid`);
      expect(stored).toEqual([{ role: COMMENTER_ROLE }]);

      expect(await ex.access.decide(as('carol'), 'read', album('summer'))).toEqual({ allowed: true, role: 'viewer', via: 'group_owner' });
      expect(await ex.access.can(as('carol'), 'write', album('summer'))).toBe(false);
      expect(await ex.access.can(as('erin'), 'read', album('summer'))).toBe(false); // registered, but the type maps no access for it
      expect(await listed(as('carol'), 'groups')).toEqual(expect.arrayContaining([albums.summer!, albums.winter!]));
      expect(await listed(as('erin'), 'groups')).toEqual([]);
    });

    it('cannot administer the group, and an unregistered role is refused (422 GROUP_ROLE_UNKNOWN) without writing', async () => {
      await ex.http().post(`/groups/${g.family}/members`).set(signIn(as('carol'))).send({ userId: u.bob, role: 'viewer' }).expect(403);
      const unknown = await ex.http().post(`/groups/${g.family}/members`).set(signIn(as('alice'))).send({ userId: u.bob, role: 'ghost' }).expect(422);
      expect(JSON.stringify(unknown.body)).toContain('GROUP_ROLE_UNKNOWN');
      await ex.http().patch(`/groups/${g.family}/members/${u.carol}`).set(signIn(as('alice'))).send({ role: 'ghost' }).expect(422);
      const rows = await asSystem((tx) => tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM group_members WHERE user_id = ${u.bob}::uuid`);
      expect(rows[0]!.n).toBe(0);
    });

    it('invites with the app role and keeps the built-in last-admin rule', async () => {
      const invite = await ex.http().post(`/groups/${g.family}/invites`).set(signIn(as('alice'))).send({ email: email.bob, role: COMMENTER_ROLE }).expect(201);
      expect(data<{ role: string }>(invite.body).role).toBe(COMMENTER_ROLE);
      const last = await ex.http().delete(`/groups/${g.family}/members/${u.alice}`).set(signIn(as('alice')));
      expect(last.status).toBe(409);
      expect(JSON.stringify(last.body)).toContain('LAST_GROUP_ADMIN');
    });
  });

  describe('a persisted app grantee kind (email-domain)', () => {
    let grantId = '';
    const grant = (who: Principal, resource: { type: string; id: string }, ref: string, role = 'viewer') =>
      ex.http().post('/grants').set(signIn(who)).send({ resourceType: resource.type, resourceId: resource.id, role, grantee: { kind: 'custom', granteeKind: 'email-domain', ref } });

    it('stores the kind and the normalised reference, and describes it', async () => {
      const res = await grant(as('alice'), album('summer'), ' Example.TEST ').expect(201);
      const body = data<{ id: string; grantee: Record<string, unknown> }>(res.body);
      grantId = body.id;
      expect(body.grantee).toMatchObject({ kind: 'email-domain', ref: 'example.test', display: 'Anyone at @example.test', userId: null, groupId: null });
      const rows = await asSystem((tx) =>
        tx.$queryRaw<Array<Record<string, unknown>>>`SELECT grantee_kind, grantee_ref, grantee_user_id, grantee_group_id, link_token_hash FROM grants WHERE id = ${grantId}::uuid`,
      );
      expect(rows).toEqual([{ grantee_kind: 'email-domain', grantee_ref: 'example.test', grantee_user_id: null, grantee_group_id: null, link_token_hash: null }]);
    });

    it('is matched in memory (the decision) and in SQL (resources I can see), for the same people', async () => {
      for (const [name, expected] of [['bob', true], ['dave', false], ['frank', false]] as const) {
        const decision = await ex.access.decide(as(name), 'read', album('summer'));
        expect(decision.allowed).toBe(expected);
        if (name === 'bob') expect(decision).toEqual({ allowed: true, role: 'viewer', via: 'email_domain_grant' });
        expect((await listed(as(name), 'shared')).includes(albums.summer!)).toBe(expected);
      }
      expect(await ex.access.can(as('bob'), 'write', album('summer'))).toBe(false);
      expect(await ex.access.can(as('bob'), 'read', album('winter'))).toBe(false);
    });

    it('lists in "shared with me" with the kind via, and in the record grant list with its description', async () => {
      // The harness has no global validation pipe, so the services are driven directly.
      const mine = await ex.grants.sharedWithMe(as('bob'), { page: 1, pageSize: 20 });
      expect(mine.items).toEqual([expect.objectContaining({ via: 'email_domain_grant', resourceId: albums.summer })]);
      const list = await ex.grants.list(as('alice'), { resourceType: OPEN_ALBUM_TYPE, resourceId: albums.summer!, page: 1, pageSize: 20 });
      expect(list.items.map((item) => item.grantee)).toEqual([expect.objectContaining({ kind: 'email-domain', display: 'Anyone at @example.test' })]);
    });

    it('keeps one active grant per reference (a second share replaces nothing new) and refuses what the type does not grant', async () => {
      await grant(as('alice'), album('summer'), 'example.test').expect(201);
      const rows = await asSystem((tx) => tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM grants WHERE resource_id = ${albums.summer}::uuid AND revoked_at IS NULL AND grantee_kind = 'email-domain'`);
      expect(rows[0]!.n).toBe(1);
      const editor = await grant(as('alice'), album('summer'), 'example.test', 'editor').expect(422);
      expect(JSON.stringify(editor.body)).toContain('ROLE_NOT_GRANTABLE');
      const bad = await grant(as('alice'), album('summer'), 'not a domain').expect(422);
      expect(JSON.stringify(bad.body)).toContain('GRANTEE_INVALID');
      await grant(as('bob'), album('summer'), 'example.test').expect(404); // bob may not share the record
    });

    it('stops working when revoked', async () => {
      await ex.http().delete(`/grants/${grantId}`).set(signIn(as('alice'))).expect(204);
      expect(await ex.access.can(as('bob'), 'read', album('summer'))).toBe(false);
      expect(await listed(as('bob'), 'shared')).toEqual([]);
    });

    it('is confined by the database itself: impossible shapes and duplicates are refused', async () => {
      const insert = (cols: string, vals: Prisma.Sql) =>
        Prisma.sql`INSERT INTO grants (id, org_id, resource_type, resource_id, role, created_at, updated_at, ${Prisma.raw(cols)})
                   VALUES (gen_random_uuid(), ${ORG_A}::uuid, ${OPEN_ALBUM_TYPE}, ${albums.winter}::uuid, 'viewer', now(), now(), ${vals})`;
      expect(await violation(insert('grantee_kind', Prisma.sql`'email-domain'`))).toContain('grants_grantee_consistency_check');
      expect(await violation(insert('grantee_kind, grantee_ref, grantee_user_id', Prisma.sql`'email-domain', 'example.test', ${u.bob}::uuid`))).toContain('grants_grantee_consistency_check');
      expect(await violation(insert('grantee_kind, grantee_ref, grantee_user_id', Prisma.sql`'user', 'example.test', ${u.bob}::uuid`))).toContain('grants_grantee_consistency_check');
      expect(await violation(insert('grantee_kind, grantee_ref', Prisma.sql`'link', 'x'`))).toContain('grants_grantee_consistency_check');
      expect(await violation(insert('grantee_kind, grantee_ref', Prisma.sql`'email-domain', 'example.test'`))).toBe('');
      expect(await violation(insert('grantee_kind, grantee_ref', Prisma.sql`'email-domain', 'example.test'`))).toContain('grants_active_ref_uniq_idx');
      await asSystem((tx) => tx.$executeRaw`UPDATE grants SET revoked_at = now() WHERE resource_id = ${albums.winter}::uuid`);
      expect(await violation(insert('grantee_kind, grantee_ref', Prisma.sql`'email-domain', 'example.test'`))).toBe(''); // a revoked grant does not block a new one
      await asSystem((tx) => tx.$executeRaw`DELETE FROM grants WHERE resource_id = ${albums.winter}::uuid`);
    });
  });

  describe('an app kind never reads another organization', () => {
    it('does not give the same domain in another organization access, and ignores a foreign-org row on a record of this one', async () => {
      // Dave (ORG_B, the same domain) shares his own album with example.test.
      await ex.grants.create(as('dave'), { resourceType: OPEN_ALBUM_TYPE, resourceId: albums.foreign!, role: 'viewer', grantee: { kind: 'custom', granteeKind: 'email-domain', ref: 'example.test' } });
      expect(await ex.access.can(as('dave'), 'read', album('foreign'))).toBe(true);
      // Bob (ORG_A, same domain) cannot read it, nor see it, and Dave cannot read ORG_A's albums.
      expect(await ex.access.can(as('bob'), 'read', album('foreign'))).toBe(false);
      expect(await listed(as('bob'), 'all')).not.toContain(albums.foreign!);
      expect(await ex.access.can(as('dave'), 'read', album('summer'))).toBe(false);

      // A grant row of ORG_B naming an ORG_A record (written through the bypass): ORG_A's decision and list ignore it.
      await asSystem(
        (tx) => tx.$executeRaw`
          INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_ref, role, created_at, updated_at)
          VALUES (gen_random_uuid(), ${ORG_B}::uuid, ${OPEN_ALBUM_TYPE}, ${albums.winter}::uuid, 'email-domain', 'example.test', 'viewer', now(), now())`,
      );
      expect(await ex.access.can(as('bob'), 'read', album('winter'))).toBe(false);
      expect(await listed(as('bob'), 'shared')).not.toContain(albums.winter!);
      expect(await ex.access.can(as('dave'), 'read', album('winter'))).toBe(false);
    });
  });
});
