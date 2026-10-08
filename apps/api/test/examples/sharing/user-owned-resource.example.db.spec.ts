// =============================================================================
// Real Postgres: the kvox-style examples, end to end (issue #732)
// =============================================================================
//
// Proves, over a database that enforces row-level security and the reference
// app's own sharing binding (./example-app.helper.ts):
//
//   ./user-owned-resource.example.ts  registerResourceType: viewer/editor
//                                     grants, `actionPermissions`, 404 on denial
//   ./notes.controller.example.ts     AccessPolicy.require / decideMany over HTTP
//   ./list-scope.example.ts           accessibleWhere (owned/shared/all) and
//                                     accessibleSql (paging, minRole)
//   ./delete-resource.example.ts      GrantsService.deleteForResources in the
//                                     deleting transaction
//   ./grant-events.example.ts         the slice emits sharing.grant.* after commit
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Principal } from '@marinoscar/platform-api/core';

import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { asSystem } from '../../sharing/sharing-test-docs.helper';
import { bootExampleApp, signIn, type ExampleApp } from './example-app.helper';
import { createNotesTable, exampleDelegate, insertNote } from './example-tables.helper';
import { deleteNote } from './delete-resource.example';
import { SharingActivityListener } from './grant-events.example';
import { listNotes, pageEditableNotes } from './list-scope.example';
import { NotesController } from './notes.controller.example';
import { NOTES_WRITE_PERMISSION, NOTE_TYPE, registerNoteResourceType } from './user-owned-resource.example';

const { describeWithDb } = resolveDbSuite('user-owned-resource.example.db.spec');

// Registered at import time, like the app's registrations.
registerNoteResourceType();

describeWithDb('sharing examples: a user-owned resource type (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '', carol: '', erin: '', frank: '', dave: '' };
  const notes: Record<string, string> = {};
  let team = '';

  /** A fresh principal per call: one call is one request. */
  const as = (name: keyof typeof u, extra: string[] = []): Principal => {
    const base = principalOf(u[name], `${name}@example.test`, name === 'dave' ? ORG_B : ORG_A, 'contributor');
    return { ...base, permissions: [...base.permissions, ...extra] };
  };
  const notesDeps = () => ({ prisma: ex.prisma, principalGroups: ex.principalGroups, notes: (tx: unknown) => exampleDelegate(tx, 'sharing_test_docs') });
  const titles = (rows: Array<{ title: string }>) => rows.map((row) => row.title).sort();

  beforeAll(async () => {
    db = await createRlsDatabase('ex_notes');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin', 'frank'] as const) u[name] = await seedUser(db, `${name}@example.test`, [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createNotesTable(db);
    ex = await bootExampleApp(db, { controllers: [NotesController], providers: [SharingActivityListener] });

    notes.plan = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'plan' });
    notes.budget = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'budget' });
    notes.diary = await insertNote(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'diary' });
    notes.bobs = await insertNote(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'bobs' });
    notes.foreign = await insertNote(db, { orgId: ORG_B, ownerUserId: u.dave, title: 'foreign' });

    // kvox's TranscriptShare: Bob may view the plan, Carol may edit it and the budget.
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.plan, role: 'viewer', grantee: { kind: 'user', userId: u.bob } });
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.plan, role: 'editor', grantee: { kind: 'user', userId: u.carol } });
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.budget, role: 'editor', grantee: { email: 'carol@example.test', kind: 'user' } });
    // A group grant: every member of "team" (Frank) may view the budget.
    team = (await ex.groups.create(as('alice'), { name: 'team' })).id;
    await ex.members.add(as('alice'), team, { userId: u.frank, role: 'viewer' });
    await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.budget, role: 'viewer', grantee: { kind: 'group', groupId: team } });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
  }, 60_000);

  describe('AccessPolicy.require in a controller (notes.controller.example.ts)', () => {
    it('answers the owner, a user grant and a group grant with the effective role', async () => {
      await ex.http().get(`/example/notes/${notes.plan}`).set(signIn(as('alice'))).expect(200, { id: notes.plan, title: 'plan', role: 'owner' });
      await ex.http().get(`/example/notes/${notes.plan}`).set(signIn(as('bob'))).expect(200, { id: notes.plan, title: 'plan', role: 'viewer' });
      await ex.http().get(`/example/notes/${notes.budget}`).set(signIn(as('frank'))).expect(200, { id: notes.budget, title: 'budget', role: 'viewer' });
    });

    it('denies with the SAME 404 as a missing record: no access, another organization, no such id', async () => {
      const missing = await ex.http().get(`/example/notes/${randomUUID()}`).set(signIn(as('erin'))).expect(404);
      const noAccess = await ex.http().get(`/example/notes/${notes.plan}`).set(signIn(as('erin'))).expect(404);
      const otherOrg = await ex.http().get(`/example/notes/${notes.plan}`).set(signIn(as('dave'))).expect(404);
      expect(noAccess.body).toEqual(missing.body);
      expect(otherOrg.body).toEqual(missing.body);
    });

    it('needs the editor role AND notes:write to write; a missing permission is a 403 naming it, even for the owner', async () => {
      const rename = (who: Principal) => ex.http().patch(`/example/notes/${notes.plan}`).set(signIn(who)).send({ title: 'plan v2' });
      await rename(as('bob', [NOTES_WRITE_PERMISSION])).expect(404); // a viewer: hidden, like a missing record
      const forbidden = await rename(as('carol')).expect(403); // an editor without the RBAC permission
      expect(JSON.stringify(forbidden.body)).toContain(NOTES_WRITE_PERMISSION);
      await rename(as('alice')).expect(403);
      await rename(as('carol', [NOTES_WRITE_PERMISSION])).expect(200, { id: notes.plan, title: 'plan v2', role: 'editor' });
    });

    it('filters a page of ids with ONE decideMany', async () => {
      const ids = [notes.plan, notes.budget, notes.diary, notes.bobs, notes.foreign].join(',');
      const res = await ex.http().get('/example/notes').query({ ids }).set(signIn(as('carol'))).expect(200);
      expect(res.body).toEqual([
        { id: notes.budget, title: 'budget', role: 'editor' },
        { id: notes.plan, title: 'plan v2', role: 'editor' },
      ]);
    });
  });

  describe('accessibleWhere and accessibleSql (list-scope.example.ts)', () => {
    it('lists owned, shared and all with accessibleWhere', async () => {
      expect(titles(await listNotes(notesDeps(), as('bob'), 'owned'))).toEqual(['bobs']);
      expect(titles(await listNotes(notesDeps(), as('bob'), 'shared'))).toEqual(['plan v2']);
      expect(titles(await listNotes(notesDeps(), as('bob'), 'all'))).toEqual(['bobs', 'plan v2']);
      expect(titles(await listNotes(notesDeps(), as('frank'), 'shared'))).toEqual(['budget']);
      expect(await listNotes(notesDeps(), as('dave'), 'shared')).toEqual([]);
    });

    it('pages editable notes in SQL with accessibleSql and minRole', async () => {
      const deps = { prisma: ex.prisma, principalGroups: ex.principalGroups };
      expect(titles(await pageEditableNotes(deps, as('carol'), { limit: 10, offset: 0 }))).toEqual(['budget', 'plan v2']);
      expect(await pageEditableNotes(deps, as('carol'), { limit: 1, offset: 1 })).toHaveLength(1);
      expect(titles(await pageEditableNotes(deps, as('bob'), { limit: 10, offset: 0 }))).toEqual(['bobs']); // his own; a viewer grant is not enough
      expect(titles(await pageEditableNotes(deps, as('alice'), { limit: 10, offset: 0 }))).toEqual(['budget', 'diary', 'plan v2']);
    });
  });

  describe('the slice emits sharing events after commit (grant-events.example.ts)', () => {
    it('recorded the grants above, ids and roles only', () => {
      const listener = ex.get(SharingActivityListener);
      expect(listener.recent.filter((entry) => entry.event === 'shared')).toEqual([
        { event: 'shared', resource: `${NOTE_TYPE}:${notes.plan}`, granteeKind: 'user', role: 'viewer', previousRole: null },
        { event: 'shared', resource: `${NOTE_TYPE}:${notes.plan}`, granteeKind: 'user', role: 'editor', previousRole: null },
        { event: 'shared', resource: `${NOTE_TYPE}:${notes.budget}`, granteeKind: 'user', role: 'editor', previousRole: null },
        { event: 'shared', resource: `${NOTE_TYPE}:${notes.budget}`, granteeKind: 'group', role: 'viewer', previousRole: null },
      ]);
      expect(JSON.stringify(listener.recent)).not.toContain('@example.test');
    });

    it('records a revoke', async () => {
      const grant = await ex.grants.create(as('alice'), { resourceType: NOTE_TYPE, resourceId: notes.diary, role: 'viewer', grantee: { kind: 'user', userId: u.erin } });
      await ex.grants.revoke(as('alice'), grant.id);
      expect(ex.get(SharingActivityListener).recent.at(-1)).toMatchObject({ event: 'revoked', resource: `${NOTE_TYPE}:${notes.diary}`, role: 'viewer' });
    });
  });

  describe('GrantsService.deleteForResources in the delete transaction (delete-resource.example.ts)', () => {
    const grantsOf = (id: string) =>
      asSystem(db, async (tx) => (await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM grants WHERE resource_id = ${id}::uuid`)[0]!.n);
    const deps = () => ({ prisma: ex.prisma, access: ex.access, grants: ex.grants });

    it('refuses anyone but the owner with the 404, deleting nothing', async () => {
      await expect(deleteNote(deps(), as('carol', [NOTES_WRITE_PERMISSION]), notes.budget)).rejects.toMatchObject({ status: 404 });
      expect(await grantsOf(notes.budget)).toBe(2);
    });

    it('deletes the record and its grants in one transaction', async () => {
      expect(await deleteNote(deps(), as('alice'), notes.budget)).toEqual({ grantsDeleted: 2 });
      expect(await grantsOf(notes.budget)).toBe(0);
      await ex.http().get(`/example/notes/${notes.budget}`).set(signIn(as('alice'))).expect(404);
    });
  });
});
