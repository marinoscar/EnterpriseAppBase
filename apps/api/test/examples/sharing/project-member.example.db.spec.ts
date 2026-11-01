// =============================================================================
// Real Postgres: the access-rule examples, end to end (PP-14.16)
// =============================================================================
//
// Proves, over a database that enforces row-level security and the reference
// app's own sharing binding (./example-app.helper.ts), for the two rules of
// apps/api/src/platform-extensions/sharing/:
//
//   project-member   members of the record's project read it (an allow)
//   frozen-record    a frozen record is closed to everyone but its owner (a deny)
//
//   - `AccessPolicy.decide` (the in-memory decision) and the "resources I can
//     see" SQL (`accessibleSql`, and the EXISTS form of `accessibleWhere`)
//     AGREE on every fixture: `describeAccessRuleConformance`;
//   - a deny wins over a grant and over the other rule's allow, the owner is
//     decided before the rules, and a membership in ANOTHER organization (the
//     same project id) never counts;
//   - the conformance kit's hostile-input checks hold for both rules.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';
import { accessRuleRegistry, accessibleSql, accessibleWhere, type AccessRuleDef } from '@marinoscar/platform-api/sharing';
import { accessRuleChecks, describeAccessRuleConformance, type AccessRuleFixture } from '@marinoscar/platform-api/sharing/testing';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { bootExampleApp, type ExampleApp } from './example-app.helper';
import { addProjectMember, createProjectTables, insertProjectDoc } from './example-tables.helper';
import { PROJECT_DOC_TYPE, frozenRecordRule, projectMemberRule, registerProjectDocExample } from './project-doc-resource.example';

const { describeWithDb } = resolveDbSuite('project-member.example.db.spec');

// Registered at import time, like the app's registrations.
registerProjectDocExample();

/** The role each action needs on the example type (its `actions`). */
const MIN_ROLE: Record<string, string> = { read: 'viewer', write: 'editor', share: 'owner' };

describeWithDb('sharing examples: access rules (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '', carol: '', erin: '', dave: '' };
  const docs: Record<string, string> = {};
  const P1 = randomUUID();
  const P2 = randomUUID();

  const as = (name: keyof typeof u): Principal => principalOf(u[name], `${name}@example.test`, name === 'dave' ? ORG_B : ORG_A, 'contributor');

  /** The real "resources I can see": accessibleSql over the table, in the caller's organization. */
  async function visibleIds(who: Principal, minRole?: string, alias = 'r'): Promise<string[]> {
    const me = await ex.principalGroups.enrich(who);
    return ex.prisma.runInOrg(me.activeOrgId!, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT ${Prisma.raw(alias)}.id::text AS id FROM sharing_test_project_docs ${Prisma.raw(alias)}
        WHERE ${accessibleSql(me, PROJECT_DOC_TYPE, alias, { sqlKit: Prisma, scope: 'all', ...(minRole ? { minRole } : {}) })}
        ORDER BY ${Prisma.raw(alias)}.title`;
      return rows.map((row) => row.id);
    });
  }

  const decide = (f: AccessRuleFixture) => ex.access.decide(f.principal, f.action, f.ref);
  const listsRecord = async (f: AccessRuleFixture) => (await visibleIds(f.principal, MIN_ROLE[f.action])).includes(f.ref.id);
  const ref = (name: string) => ({ type: PROJECT_DOC_TYPE, id: docs[name]! });

  beforeAll(async () => {
    db = await createRlsDatabase('ex_rules');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin'] as const) u[name] = await seedUser(db, `${name}@example.test`, [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createProjectTables(db);
    ex = await bootExampleApp(db);

    docs.p1 = await insertProjectDoc(db, { orgId: ORG_A, ownerUserId: u.alice, projectId: P1, title: 'p1' });
    docs.p2 = await insertProjectDoc(db, { orgId: ORG_A, ownerUserId: u.alice, projectId: P2, title: 'p2' });
    docs.loose = await insertProjectDoc(db, { orgId: ORG_A, ownerUserId: u.alice, projectId: null, title: 'loose' });
    docs.frozen = await insertProjectDoc(db, { orgId: ORG_A, ownerUserId: u.alice, projectId: P1, frozen: true, title: 'frozen' });
    docs.foreign = await insertProjectDoc(db, { orgId: ORG_B, ownerUserId: u.dave, projectId: P1, title: 'foreign' });

    await addProjectMember(db, { orgId: ORG_A, projectId: P1, userId: u.bob });
    await addProjectMember(db, { orgId: ORG_A, projectId: P2, userId: u.carol });
    // Same project id, ANOTHER organization: neither Dave nor Erin gains anything in org A from it.
    await addProjectMember(db, { orgId: ORG_B, projectId: P1, userId: u.dave });
    await addProjectMember(db, { orgId: ORG_B, projectId: P1, userId: u.erin });

    // A grant does not beat a deny: Bob holds a viewer grant on the frozen record.
    await ex.grants.create(as('alice'), { resourceType: PROJECT_DOC_TYPE, resourceId: docs.frozen, role: 'viewer', grantee: { kind: 'user', userId: u.bob } });
    // A grant still works where no rule denies: Carol edits p1.
    await ex.grants.create(as('alice'), { resourceType: PROJECT_DOC_TYPE, resourceId: docs.p1, role: 'editor', grantee: { kind: 'user', userId: u.carol } });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
  }, 60_000);

  const fixtures = (): AccessRuleFixture[] => [
    { name: 'a project member reads the project record', principal: as('bob'), ref: ref('p1'), action: 'read', allowed: true, via: 'project-member' },
    { name: 'a project member does NOT write (the rule confers viewer)', principal: as('bob'), ref: ref('p1'), action: 'write', allowed: false },
    { name: 'a member of another project reads nothing here', principal: as('carol'), ref: ref('p2'), action: 'read', allowed: true, via: 'project-member' },
    { name: 'a member of project 2 does not read project 1 records through the rule', principal: as('erin'), ref: ref('p1'), action: 'read', allowed: false },
    { name: 'a record without a project is not reachable through membership', principal: as('bob'), ref: ref('loose'), action: 'read', allowed: false },
    { name: 'the owner is decided before the rules', principal: as('alice'), ref: ref('p1'), action: 'share', allowed: true, via: 'owner' },
    { name: 'a grant still works where no rule denies', principal: as('carol'), ref: ref('p1'), action: 'write', allowed: true, via: 'user_grant' },
    { name: 'the frozen rule denies a project member and a grantee alike', principal: as('bob'), ref: ref('frozen'), action: 'read', allowed: false },
    { name: 'the owner reads a frozen record', principal: as('alice'), ref: ref('frozen'), action: 'read', allowed: true, via: 'owner' },
    { name: 'a stranger reads nothing', principal: as('erin'), ref: ref('p2'), action: 'read', allowed: false },
    { name: 'a member of the same project id in ANOTHER organization is denied', principal: as('erin'), ref: ref('p1'), action: 'read', allowed: false },
    { name: 'a principal of another organization, for a record here', principal: as('dave'), ref: ref('p1'), action: 'read', allowed: false, crossOrg: true },
    { name: 'a principal of another organization, for a frozen record here', principal: as('dave'), ref: ref('frozen'), action: 'read', allowed: false, crossOrg: true },
  ];

  describeAccessRuleConformance('project-member', {
    rule: projectMemberRule,
    resourceType: PROJECT_DOC_TYPE,
    sqlKit: Prisma,
    decide,
    listsRecord,
    get fixtures() {
      return fixtures();
    },
  });

  describeAccessRuleConformance('frozen-record', {
    rule: frozenRecordRule,
    resourceType: PROJECT_DOC_TYPE,
    sqlKit: Prisma,
    decide,
    listsRecord,
    get fixtures() {
      return fixtures();
    },
  });

  describe('what each caller sees (resources I can see, scope all)', () => {
    const titlesOf = async (who: Principal, minRole?: string) => {
      const ids = await visibleIds(who, minRole);
      return Object.entries(docs)
        .filter(([, id]) => ids.includes(id))
        .map(([name]) => name)
        .sort();
    };

    it('the owner sees every own record, frozen included', async () => {
      expect(await titlesOf(as('alice'))).toEqual(['frozen', 'loose', 'p1', 'p2']);
    });

    it("a member sees the project's records except the frozen one, and a grant does not bring it back", async () => {
      expect(await titlesOf(as('bob'))).toEqual(['p1']);
      expect(await titlesOf(as('carol'))).toEqual(['p1', 'p2']);
    });

    it('a role below minRole is not listed through the rule', async () => {
      expect(await titlesOf(as('bob'), 'editor')).toEqual([]);
      expect(await titlesOf(as('carol'), 'editor')).toEqual(['p1']);
    });

    it('a stranger and a principal of another organization see nothing of this organization', async () => {
      expect(await titlesOf(as('erin'))).toEqual([]);
      expect(await visibleIds(as('dave'))).toEqual([docs.foreign]);
    });

    it('accessibleWhere hands back the EXISTS form when a rule contributes, and it lists the same rows', async () => {
      const me = await ex.principalGroups.enrich(as('bob'));
      const ids = await ex.prisma.runInOrg(me.activeOrgId!, async (tx) => {
        const access = await accessibleWhere(me, PROJECT_DOC_TYPE, { tx, sqlKit: Prisma });
        expect(access.form).toBe('exists');
        if (access.form !== 'exists') return [];
        const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id::text AS id FROM sharing_test_project_docs r WHERE ${access.sql}`;
        return rows.map((row) => row.id);
      });
      expect(ids.sort()).toEqual((await visibleIds(as('bob'))).sort());
      expect(ids).toEqual([docs.p1]);
    });

    it('decides a batch of records of several projects in one call', async () => {
      const decisions = await ex.access.decideMany(as('bob'), 'read', [ref('p1'), ref('p2'), ref('loose')]);
      expect([...decisions.values()].map((d) => d.allowed)).toEqual([true, false, false]);
    });
  });

  describe('a caller alias that the rule\'s own SQL could shadow', () => {
    it('lists the same records under the alias pm as under r (the rule uses its own inner alias)', async () => {
      expect((await visibleIds(as('bob'), undefined, 'pm')).sort()).toEqual((await visibleIds(as('bob'))).sort());
      expect(await visibleIds(as('bob'), undefined, 'pm')).toEqual([docs.p1]);
      expect(await visibleIds(as('erin'), undefined, 'pm')).toEqual([]);
    });

    it('refuses the alias the slice uses inside its own EXISTS', async () => {
      await expect(visibleIds(as('bob'), undefined, 'g')).rejects.toThrow(/used inside the generated SQL/);
    });
  });

  describe('a failing rule does not poison the shared transaction (savepoint)', () => {
    it('denies the record whose rule failed on a SQL error and still decides the later records', async () => {
      const failing: AccessRuleDef = {
        id: 'sql-error',
        position: 'after-grants',
        resourceTypes: [PROJECT_DOC_TYPE],
        async evaluate(ctx) {
          if (ctx.resource.id === docs.loose) await (ctx.tx as Prisma.TransactionClient).$queryRaw`SELECT * FROM table_that_does_not_exist`;
          return 'abstain';
        },
      };
      await withTemporaryEntries(accessRuleRegistry, [failing], async () => {
        const decisions = await ex.access.decideMany(as('carol'), 'read', [ref('loose'), ref('p2'), ref('p1')]);
        expect(decisions.get(`${PROJECT_DOC_TYPE}:${docs.loose}`)).toMatchObject({ allowed: false, ruleFailure: true });
        // The records AFTER the failure are decided by queries on the same transaction: they work.
        expect(decisions.get(`${PROJECT_DOC_TYPE}:${docs.p2}`)).toMatchObject({ allowed: true, via: 'project-member' });
        expect(decisions.get(`${PROJECT_DOC_TYPE}:${docs.p1}`)).toMatchObject({ allowed: true, via: 'user_grant' });
      });
    });
  });

  describe('the kit rejects a broken rule', () => {
    /** The project-member rule with its organization predicate deleted from the LIST sql (the decision is unchanged). */
    const noOrgPredicate: AccessRuleDef = {
      ...projectMemberRule,
      id: 'project-member-broken',
      sql: (ctx) => ({
        allow: ctx.kit.sql`EXISTS (
          SELECT 1 FROM "sharing_test_project_members" prj_member_rule
          WHERE prj_member_rule.user_id = ${ctx.principal.userId}::uuid
            AND prj_member_rule.project_id = ${ctx.column('project_id')}
        )`,
      }),
    };
    const subjectFor = (rule: AccessRuleDef) => ({ rule, resourceType: PROJECT_DOC_TYPE, sqlKit: Prisma, decide, listsRecord, fixtures: fixtures() });

    it('passes the real rule through every check', async () => {
      for (const check of Object.values(accessRuleChecks)) expect(await check(subjectFor(projectMemberRule))).toEqual([]);
    });

    it('catches the missing organization predicate in the SQL check and in the decision-vs-list check', async () => {
      await withTemporaryEntries(accessRuleRegistry, [noOrgPredicate], async () => {
        const subject = subjectFor(noOrgPredicate);
        expect((await accessRuleChecks.sqlSafety(subject)).some((violation) => violation.includes('does not bind the caller organization'))).toBe(true);
        // Erin is a member of the same project id in ANOTHER organization: the broken list shows p1, the decision denies it.
        const disagreements = await accessRuleChecks.agreement(subject);
        expect(disagreements.some((violation) => violation.includes('member of the same project id in ANOTHER organization'))).toBe(true);
      });
    });
  });
});
