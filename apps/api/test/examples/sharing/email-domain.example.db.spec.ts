// =============================================================================
// Real Postgres: the grantee-kind contract, end to end (PP-14.16)
// =============================================================================
//
// Proves, over a database that enforces row-level security and the reference
// app's own sharing binding (./example-app.helper.ts):
//
//   - the built-in kinds `user` and `group`, registered through the same
//     `registerGranteeKind` as an app's, pass `describeGranteeKindConformance`:
//     their in-memory match equals their SQL fragment evaluated by Postgres;
//   - the `email-domain` example kind
//     (apps/api/src/platform-extensions/sharing/email-domain.grantee-kind.ts)
//     passes it too, hostile input included;
//   - the "resources I can see" list built from the registered kinds equals the
//     decision of `AccessPolicy` for REAL stored user and group grants, and a
//     grant of ANOTHER organization never reaches the list (the composed
//     `EXISTS` confines every fragment to `g.org_id`);
//   - GET /api/sharing/grantee-kinds lists the kinds, and POST /api/grants
//     refuses a grantee of an app kind (422) without writing a row: grants of an
//     app kind cannot be stored until the sharing storage migration ships.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';
import { accessibleSql, granteeKindRegistry } from '@marinoscar/platform-api/sharing';
import { describeGranteeKindConformance } from '@marinoscar/platform-api/sharing/testing';
import { Prisma } from '@prisma/client';

import { emailDomainGranteeKind, registerEmailDomainGranteeKind } from '../../../src/platform-extensions/sharing/email-domain.grantee-kind';
import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { bootExampleApp, signIn, type ExampleApp } from './example-app.helper';
import { createNotesTable, insertNote } from './example-tables.helper';
import { NOTE_TYPE, registerNoteResourceType } from './user-owned-resource.example';

const { describeWithDb } = resolveDbSuite('email-domain.example.db.spec');

// Registered at import time, like the app's registrations.
registerNoteResourceType();
registerEmailDomainGranteeKind();

const G1 = '33333333-3333-4333-8333-333333333331';
const G2 = '33333333-3333-4333-8333-333333333332';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

/** A principal for the kit: its groups are `Scope.groupIds` of its organization. */
function member(userId: string, email: string, groupIds: string[] = []): Principal {
  return { ...principalOf(userId, email, ORG_A, 'contributor'), groups: groupIds.map((groupId) => ({ groupId, orgId: ORG_A, role: 'viewer' as const })) };
}

describeWithDb('sharing examples: grantee kinds (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '', carol: '', erin: '', dave: '' };
  const notes: Record<string, string> = {};
  const as = (name: keyof typeof u): Principal => principalOf(u[name], `${name}@example.test`, name === 'dave' ? ORG_B : ORG_A, 'contributor');

  const runQuery = async (query: Prisma.Sql): Promise<boolean | null> => {
    const rows = await db.tenant.$queryRaw<Array<{ match: boolean | null }>>(query);
    return rows[0]?.match ?? null;
  };

  const principals = [
    member(U1, 'one@example.com', [G1]),
    member(U2, 'two@Other.ORG', [G1, G2]),
    member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'three@example.com'),
    member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'no-domain'),
  ];
  const grantees = [
    { kind: 'user', userId: U1, groupId: null, ref: null },
    { kind: 'user', userId: U2, groupId: null, ref: null },
    { kind: 'group', userId: null, groupId: G1, ref: null },
    { kind: 'group', userId: null, groupId: G2, ref: null },
    { kind: 'group', userId: null, groupId: '33333333-3333-4333-8333-333333333339', ref: null },
    { kind: 'link', userId: null, groupId: null, ref: null },
    { kind: 'email-domain', userId: null, groupId: null, ref: 'example.com' },
    { kind: 'email-domain', userId: null, groupId: null, ref: 'Example.COM' },
    { kind: 'email-domain', userId: null, groupId: null, ref: 'other.org' },
  ] as const;

  const common = { sqlKit: Prisma, runQuery, principals, grantees: [...grantees] };

  // The kit registers its own `describe`/`it` blocks; they run after `beforeAll`.
  describeGranteeKindConformance('user (built in)', {
    ...common,
    kind: granteeKindRegistry.get('user')!,
    validInputs: [{ userId: U1 }, { email: 'Someone@Example.com' }],
    invalidInputs: [{}, { userId: 'not-a-uuid' }, { email: 'no-at-sign' }],
  });
  describeGranteeKindConformance('group (built in)', {
    ...common,
    kind: granteeKindRegistry.get('group')!,
    validInputs: [{ groupId: G1 }],
    invalidInputs: [{}, { groupId: 'x' }],
  });
  describeGranteeKindConformance('email-domain (app example)', {
    ...common,
    kind: emailDomainGranteeKind,
    validInputs: ['example.com', '@Example.COM', ' eng.example.co.uk '],
    invalidInputs: ['', 'localhost', 'not a domain', 'a@b.com', 'x.y'],
  });

  beforeAll(async () => {
    db = await createRlsDatabase('ex_kinds');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin'] as const) u[name] = await seedUser(db, `${name}@example.test`, [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createNotesTable(db);
    ex = await bootExampleApp(db);

    notes.shared = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'shared' });
    notes.viaGroup = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'viaGroup' });
    notes.private = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'private' });
    notes.foreign = await insertNote(db, { orgId: ORG_B, ownerUserId: u.dave, title: 'foreign' });

    const team = (await ex.groups.create(as('alice'), { name: 'team' })).id;
    await ex.members.add(as('alice'), team, { userId: u.carol, role: 'viewer' });
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.shared, role: 'viewer', grantee: { kind: 'user', userId: u.bob } });
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.viaGroup, role: 'editor', grantee: { kind: 'group', groupId: team } });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
  }, 60_000);

  describe('the list composed from the registered kinds equals the decision, for stored grants', () => {
    async function listed(who: Principal, minRole?: string): Promise<string[]> {
      const me = await ex.principalGroups.enrich(who);
      return ex.prisma.runInOrg(me.activeOrgId!, async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT r.id::text AS id FROM sharing_test_docs r
          WHERE ${accessibleSql(me, NOTE_TYPE, 'r', { sqlKit: Prisma, scope: 'shared', ...(minRole ? { minRole } : {}) })}`;
        return rows.map((row) => row.id);
      });
    }

    it.each([
      ['a user grant', 'bob', ['shared']],
      ['a group grant', 'carol', ['viaGroup']],
      ['nothing', 'erin', []],
    ] as const)('%s', async (_name, who, expected) => {
      const ids = (await listed(as(who))).sort();
      expect(ids).toEqual(expected.map((name) => notes[name]!).sort());
      for (const [name, id] of Object.entries(notes)) {
        if (name === 'foreign') continue;
        const decision = await ex.access.decide(as(who), 'read', { type: NOTE_TYPE, id });
        // None of these callers owns a note: the shared scope lists exactly what the decision allows.
        expect({ name, listed: ids.includes(id) }).toEqual({ name, listed: decision.allowed });
      }
    });

    it('respects minRole for a stored grant (a viewer grant is not an editor grant)', async () => {
      expect(await listed(as('bob'), 'editor')).toEqual([]);
      expect(await listed(as('carol'), 'editor')).toEqual([notes.viaGroup]);
    });

    it('never lists a grant of another organization, even for the same user id', async () => {
      // A grant row to Bob on a record of ORG_B (written through the bypass): Bob's org-A list never shows it.
      await db.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.$executeRaw`
          INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, created_at, updated_at)
          VALUES (gen_random_uuid(), ${ORG_B}::uuid, ${NOTE_TYPE}, ${notes.foreign}::uuid, 'user', ${u.bob}::uuid, 'viewer', now(), now())`;
      });
      expect(await listed(as('bob'))).toEqual([notes.shared]);
    });
  });

  describe('GET /api/sharing/grantee-kinds and POST /api/grants with an app kind', () => {
    it('lists the built-ins and the registered app kind, with their labels and input types', async () => {
      const res = await ex.http().get('/sharing/grantee-kinds').set(signIn(as('bob'))).expect(200);
      const items = (res.body.data ?? res.body).items as Array<{ kind: string; label: string; input: string; builtin: boolean; persisted: boolean }>;
      expect(items.map((item) => item.kind)).toEqual(['user', 'group', 'link', 'email-domain']);
      expect(items.find((item) => item.kind === 'email-domain')).toMatchObject({ label: 'Email domain', input: 'text', builtin: false, persisted: false });
      expect(items.find((item) => item.kind === 'user')).toMatchObject({ builtin: true, persisted: true, input: 'user-search' });
    });

    it('needs sharing:read', async () => {
      const none = { ...as('bob'), permissions: [] };
      await ex.http().get('/sharing/grantee-kinds').set(signIn(none)).expect(403);
    });

    const share = (who: Principal, grantee: unknown) =>
      ex.http().post('/grants').set(signIn(who)).send({ resourceType: NOTE_TYPE, resourceId: notes.private, role: 'viewer', grantee });

    it('validates the grantee with its kind, then refuses to store it, writing nothing', async () => {
      const invalid = await share(as('alice'), { kind: 'custom', granteeKind: 'email-domain', ref: "x'); DROP TABLE grants; --" }).expect(422);
      expect(JSON.stringify(invalid.body)).toContain('GRANTEE_INVALID');
      const valid = await share(as('alice'), { kind: 'custom', granteeKind: 'email-domain', ref: 'example.com' }).expect(422);
      expect(JSON.stringify(valid.body)).toContain('GRANTEE_KIND_NOT_PERSISTABLE');
      const unknown = await share(as('alice'), { kind: 'custom', granteeKind: 'team', ref: 'x' }).expect(422);
      expect(JSON.stringify(unknown.body)).toContain('GRANTEE_KIND_UNKNOWN');
      const rows = await db.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        return tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM grants WHERE resource_id = ${notes.private}::uuid`;
      });
      expect(rows[0]!.n).toBe(0);
    });

    it("tells a caller who may not share the record nothing about the kind: the record's own 404", async () => {
      await share(as('bob'), { kind: 'custom', granteeKind: 'email-domain', ref: 'example.com' }).expect(404);
      await share(as('bob'), { kind: 'custom', granteeKind: 'team', ref: 'x' }).expect(404);
    });
  });
});
