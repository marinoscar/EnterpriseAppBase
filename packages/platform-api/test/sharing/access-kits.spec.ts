// The conformance kits' own checks (PP-14.16): each check must REJECT a
// deliberately broken subject, not only pass a good one. The checks are plain
// functions (`granteeKindChecks`, `accessRuleChecks`) so this needs no database;
// the end-to-end rejection of a broken rule and kind over real Postgres is
// apps/api/test/examples/sharing/broken-extensions.example.db.spec.ts.

import type { Principal } from '../../src/core/index';
import type { AccessRuleDef, GranteeKindDef } from '../../src/sharing/index';
import { HOSTILE_STRINGS, accessRuleChecks, granteeKindChecks, hostilePrincipal, recordingSqlKit } from '../../src/sharing/testing/index';
import { ALICE, BOB, ORG, principal } from './fakes';

const ME: Principal = principal({ permissions: ['sharing:read'] });
const OTHER = principal({ userId: BOB, email: 'bob@other.org' });

describe('recordingSqlKit', () => {
  it('refuses a fragment built outside the kit instead of binding it as an opaque value', () => {
    const foreign = { strings: ['x'], values: [] }; // the shape of Prisma.Sql
    expect(() => recordingSqlKit.sql`a = ${foreign}`).toThrow(/outside the kit/);
    expect(() => recordingSqlKit.join([foreign])).toThrow(/outside the kit/);
    expect(() => recordingSqlKit.sql`a = ${new Date(0)} AND b = ${[1, 2]} AND c = ${'x'}`).not.toThrow();
  });

  it('keeps a nested recording inline and binds everything else', () => {
    const inner = recordingSqlKit.raw('"r"."id"');
    const out = recordingSqlKit.sql`${inner} = ${'v'}::uuid`;
    expect(out).toMatchObject({ text: '"r"."id" = ?::uuid', values: ['v'], raws: ['"r"."id"'] });
  });
});

describe('hostilePrincipal', () => {
  it('gives every string field and array element its own value, all carrying the payload', () => {
    const { principal: hostile, orgValue, values } = hostilePrincipal(ME, "'; DROP TABLE x; --");
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => value.startsWith("'; DROP TABLE x; --"))).toBe(true);
    expect(hostile.activeOrgId).toBe(orgValue);
    expect(hostile.userId).not.toBe(hostile.email);
    expect(hostile.userId).not.toBe(orgValue);
    expect(hostile.email).not.toBe(orgValue);
    expect(hostile.roles).toHaveLength(2);
    expect(hostile.permissions).toHaveLength(2);
    expect(hostile.memberships?.[0]?.orgId).not.toBe(orgValue);
    expect(hostile.groups?.every((group) => group.orgId === orgValue)).toBe(true);
    for (const value of [hostile.userId, hostile.email, ...hostile.roles, ...hostile.permissions]) expect(values).toContain(value);
  });
});

describe('granteeKindChecks reject a broken kind', () => {
  const base: GranteeKindDef = {
    kind: 'email-domain',
    label: 'Email domain',
    input: 'text',
    validateGrantee: (input) => {
      if (typeof input !== 'string' || !input.includes('.')) throw new Error('bad');
      return { kind: 'email-domain', id: input };
    },
    describe: async (ref) => ({ display: ref.id }),
    matchesPrincipal: (facts, who) => facts.ref === who.email.split('@')[1],
    resolvePrincipalMatch: (who, g, kit) => kit.sql`(${g.kind} = 'email-domain' AND ${g.ref} = ${who.email.split('@')[1]})`,
  };
  const subject = (kind: GranteeKindDef) => ({
    kind,
    sqlKit: recordingSqlKit,
    runQuery: async () => null,
    principals: [ME, OTHER],
    grantees: [{ kind: 'email-domain', userId: null, groupId: null, ref: 'example.com' }],
    validInputs: ['example.com'],
    invalidInputs: ['nodots'],
  });

  it('passes a good kind', async () => {
    for (const check of ['descriptor', 'validation', 'describe', 'sqlSafety'] as const) expect(await granteeKindChecks[check](subject(base))).toEqual([]);
  });

  it('rejects a fragment that interpolates the principal into the text', async () => {
    const injected: GranteeKindDef = { ...base, resolvePrincipalMatch: (who, g, kit) => kit.sql`(${g.kind} = ${kit.raw(`'${who.email}'`)})` };
    const violations = await granteeKindChecks.sqlSafety(subject(injected));
    expect(violations.some((violation) => violation.includes('reached the SQL text'))).toBe(true);
  });

  it('rejects a fragment built outside the kit (a foreign raw of the principal)', async () => {
    const foreign: GranteeKindDef = { ...base, resolvePrincipalMatch: (who, g, kit) => kit.sql`(${g.kind} = ${{ strings: [who.email], values: [] }})` };
    const violations = await granteeKindChecks.sqlSafety(subject(foreign));
    expect(violations.some((violation) => violation.includes('outside the kit'))).toBe(true);
  });

  it('rejects a sub-select that does not bind the caller organization, and accepts one that does', async () => {
    const unbound: GranteeKindDef = {
      ...base,
      resolvePrincipalMatch: (who, g, kit) => kit.sql`${g.ref} IN (SELECT t.id FROM team_members t WHERE t.user_id = ${who.userId}::uuid)`,
    };
    expect((await granteeKindChecks.sqlSafety(subject(unbound))).some((violation) => violation.includes('does not bind the caller organization'))).toBe(true);
    const bound: GranteeKindDef = {
      ...base,
      resolvePrincipalMatch: (who, g, kit) =>
        kit.sql`${g.ref} IN (SELECT t.id FROM team_members t WHERE t.org_id = ${who.activeOrgId}::uuid AND t.user_id = ${who.userId}::uuid)`,
    };
    expect(await granteeKindChecks.sqlSafety(subject(bound))).toEqual([]);
  });

  it('rejects a sub-select that binds some OTHER principal field than the organization', async () => {
    const wrongField: GranteeKindDef = {
      ...base,
      resolvePrincipalMatch: (who, g, kit) => kit.sql`${g.ref} IN (SELECT t.id FROM team_members t WHERE t.org_id = ${who.userId}::uuid AND t.user_id = ${who.email}::uuid)`,
    };
    expect((await granteeKindChecks.sqlSafety(subject(wrongField))).some((violation) => violation.includes('does not bind the caller organization'))).toBe(true);
  });

  it('rejects a kind that accepts what it must refuse, or returns another kind', async () => {
    const lax: GranteeKindDef = { ...base, validateGrantee: (input) => ({ kind: 'email-domain', id: String(input) }) };
    expect((await granteeKindChecks.validation(subject(lax))).some((violation) => violation.includes('accepted an invalid input'))).toBe(true);
    const wrongKind: GranteeKindDef = { ...base, validateGrantee: (input) => ({ kind: 'user', id: String(input) }) };
    expect((await granteeKindChecks.validation(subject(wrongKind))).length).toBeGreaterThan(0);
  });

  it('rejects a disagreement between the in-memory match and the SQL', async () => {
    const wrong: GranteeKindDef = { ...base, matchesPrincipal: () => true };
    // The database says "no match" for everything here, so an always-true in-memory match disagrees.
    const violations = await granteeKindChecks.agreement(subject(wrong));
    expect(violations.length).toBeGreaterThan(0);
  });

  it('hostile payloads stay data: the list is non-empty', () => expect(HOSTILE_STRINGS.length).toBeGreaterThan(3));
});

describe('accessRuleChecks reject a broken rule', () => {
  const rule = (overrides: Partial<AccessRuleDef> = {}): AccessRuleDef => ({
    id: 'project-member',
    position: 'before-grants',
    resourceTypes: ['test_doc'],
    evaluate: async () => 'abstain',
    sql: (ctx) => ({
      allow: ctx.kit.sql`EXISTS (SELECT 1 FROM project_members pm WHERE pm.org_id = ${ctx.orgId}::uuid AND pm.user_id = ${ctx.principal.userId}::uuid AND pm.project_id = ${ctx.column('project_id')})`,
    }),
    ...overrides,
  });
  const fixtures = [
    { name: 'member', principal: ME, ref: { type: 'test_doc', id: ALICE }, action: 'read', allowed: true },
    { name: 'stranger', principal: OTHER, ref: { type: 'test_doc', id: ALICE }, action: 'read', allowed: false },
    { name: 'other org', principal: principal({ activeOrgId: ORG }), ref: { type: 'test_doc', id: ALICE }, action: 'read', allowed: false, crossOrg: true },
  ];
  const subject = (def: AccessRuleDef, over: Record<string, unknown> = {}) => ({
    rule: def,
    resourceType: 'test_doc',
    sqlKit: recordingSqlKit,
    decide: async () => ({ allowed: false, role: null, via: null }),
    listsRecord: async () => false,
    fixtures,
    ...over,
  });

  it('passes a rule whose sub-select binds the organization', async () => {
    expect(await accessRuleChecks.sqlSafety(subject(rule()))).toEqual([]);
  });

  it('rejects a rule that deletes its organization predicate (the organization value is not bound)', async () => {
    const broken = rule({
      sql: (ctx) => ({
        allow: ctx.kit.sql`EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = ${ctx.principal.userId}::uuid AND pm.project_id = ${ctx.column('project_id')})`,
      }),
    });
    expect((await accessRuleChecks.sqlSafety(subject(broken))).some((violation) => violation.includes('does not bind the caller organization'))).toBe(true);
  });

  it('rejects a rule that binds the wrong principal field where the organization belongs', async () => {
    const broken = rule({
      sql: (ctx) => ({
        allow: ctx.kit.sql`EXISTS (SELECT 1 FROM project_members pm WHERE pm.org_id = ${ctx.principal.email}::uuid AND pm.user_id = ${ctx.principal.userId}::uuid)`,
      }),
    });
    expect((await accessRuleChecks.sqlSafety(subject(broken))).some((violation) => violation.includes('does not bind the caller organization'))).toBe(true);
  });

  it('rejects SQL that puts the principal in the text, and SQL built outside ctx.kit', async () => {
    const interpolated = rule({ sql: (ctx) => ({ allow: ctx.kit.sql`${ctx.kit.raw(`'${ctx.principal.email}'`)} = 'x'` }) });
    expect((await accessRuleChecks.sqlSafety(subject(interpolated))).some((violation) => violation.includes('reached the SQL text'))).toBe(true);
    const foreign = rule({ sql: (ctx) => ({ allow: ctx.kit.sql`${{ strings: [ctx.principal.email], values: [] }}` }) });
    expect((await accessRuleChecks.sqlSafety(subject(foreign))).some((violation) => violation.includes('outside the kit'))).toBe(true);
  });

  it('rejects a rule that can deny without a deny condition, and a deny condition without mayDeny', async () => {
    const noDeny = rule({ mayDeny: true, sql: () => null });
    expect(await accessRuleChecks.sqlSafety(subject(noDeny))).toContain('mayDeny is set but sql never returned a deny');
    const undeclared = rule({ sql: (ctx) => ({ deny: ctx.kit.sql`${ctx.column('frozen_at')} IS NOT NULL` }) });
    expect(await accessRuleChecks.sqlSafety(subject(undeclared))).toContain('sql returns a deny but the rule does not declare mayDeny');
  });

  it('rejects a decision that is a rule failure, a disagreement with the list, and a leak across organizations', async () => {
    const failed = subject(rule(), { decide: async () => ({ allowed: false, role: null, via: null, ruleFailure: true }) });
    expect((await accessRuleChecks.decisions(failed)).some((violation) => violation.includes('FAILED or was misconfigured'))).toBe(true);
    const disagrees = subject(rule(), { decide: async (f: { allowed: boolean }) => ({ allowed: f.allowed, role: null, via: null }), listsRecord: async () => true });
    expect((await accessRuleChecks.agreement(disagrees)).length).toBeGreaterThan(0);
    const leaks = subject(rule(), { decide: async () => ({ allowed: true, role: 'viewer', via: 'x' }), listsRecord: async () => true });
    expect((await accessRuleChecks.isolation(leaks)).length).toBe(2);
  });

  it('rejects an unusable fixture matrix and a rule that applies to another type', async () => {
    const thin = subject(rule({ resourceTypes: ['else'] }), { fixtures: [fixtures[0]!] });
    const violations = await accessRuleChecks.shape(thin);
    expect(violations).toEqual(expect.arrayContaining(['the rule does not apply to "test_doc"', 'the fixture matrix has no denied row', 'the fixture matrix has no crossOrg row']));
  });
});
