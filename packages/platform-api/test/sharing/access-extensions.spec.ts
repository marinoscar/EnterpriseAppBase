// The two sharing extension points of PP-14.16: grantee kinds and access
// rules. The decision order with rules (deny wins, the owner and a bypass
// holder decided first, fail closed), the "resources I can see" SQL with
// rules, the registries' validation, and the parameterisation of every
// built-in fragment. The same against a real database is
// apps/api/test/examples/sharing/*.db.spec.ts.

import { Logger } from '@nestjs/common';

import { RegistryError, withTemporaryEntries, type Principal } from '../../src/core/index';
import {
  AccessPolicy,
  GRANTEE_KIND_PERSISTENCE_AVAILABLE,
  accessRuleRegistry,
  accessibleSql,
  accessibleWhere,
  describeGranteeKind,
  granteeKindRegistry,
  persistedGranteeKinds,
  registerAccessRule,
  registerGranteeKind,
  type AccessRuleDef,
  type GranteeKindDef,
} from '../../src/sharing/index';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { recordingSqlKit, type RecordedSql } from '../../src/sharing/testing/recording-sql-kit';
import { ALICE, BOB, GROUP, ORG, fakeData, fakeTx, options, principal, type FakeTx } from './fakes';
import { DOC_A, DOC_B, byGroup, byUser, docType, grantRow, withTypes, type OwnerTable } from './grants-fakes';
import { fakeSqlKit, type FakeSql } from './sql-kit';

const A = { type: 'test_doc', id: DOC_A };

function caller(permissions: string[] = ['docs:write'], groups: Array<[string, 'admin' | 'editor' | 'viewer']> = []): Principal {
  return principal({ permissions, groups: groups.map(([groupId, role]) => ({ groupId, orgId: ORG, role })) });
}

function policyOver(tx: FakeTx): { policy: AccessPolicy; metrics: { add: jest.Mock } } {
  const data = fakeData(tx);
  const metrics = { add: jest.fn() };
  const policy = new AccessPolicy(data, new PrincipalGroupsProvider(data, options(), undefined, () => 0), metrics as never, () => 0);
  return { policy, metrics };
}

/** A rule over `test_doc`, `verdict` for every record unless `evaluate` says otherwise. */
function rule(overrides: Partial<AccessRuleDef> & { id: string }, verdict: 'allow' | 'deny' | 'abstain' = 'allow'): AccessRuleDef {
  return { position: 'before-grants', resourceTypes: ['test_doc'], evaluate: async () => verdict, ...overrides };
}

async function withRules<R>(rules: AccessRuleDef[], table: OwnerTable, grants: ReturnType<typeof grantRow>[], fn: (policy: AccessPolicy, tx: FakeTx, metrics: { add: jest.Mock }) => Promise<R>, def = {}): Promise<R> {
  const tx = fakeTx();
  tx.grant.findMany.mockResolvedValue(grants);
  const { policy, metrics } = policyOver(tx);
  return withTemporaryEntries(accessRuleRegistry, rules, () => withTypes([docType(table, def)], () => fn(policy, tx, metrics)));
}

describe('registerAccessRule', () => {
  function refusal(def: AccessRuleDef): RegistryError {
    try {
      registerAccessRule(def);
    } catch (error) {
      return error as RegistryError;
    }
    throw new Error('expected a refusal');
  }

  it.each([
    ['a reserved id', { id: 'owner' }, 'reserved for a platform source'],
    ['a bad position', { id: 'r-one', position: 'during-grants' as never }, '`position`'],
    ['no evaluate', { id: 'r-two', evaluate: undefined as never }, '`evaluate`'],
    ['a rule that can deny and has no sql', { id: 'r-three', mayDeny: true }, '`mayDeny` needs `sql`'],
    ['a non-function sql', { id: 'r-four', sql: 'x' as never }, '`sql`'],
    ['a non-string role', { id: 'r-five', role: 7 as never }, '`role`'],
    ['resourceTypes that is not an array', { id: 'r-six', resourceTypes: 'test_doc' as never }, '`resourceTypes`'],
  ])('refuses %s, naming the rule', async (_name, overrides, message) => {
    await withTemporaryEntries(accessRuleRegistry, [], () => {
      const error = refusal(rule(overrides as never));
      expect(error.code).toBe('INVALID_ENTRY');
      expect(error.message).toContain(message);
      expect(error.message).toContain('access rule "');
    });
  });

  it('refuses a bad id and a duplicate id, and keeps registration order', async () => {
    await withTemporaryEntries(accessRuleRegistry, [], () => {
      expect(refusal(rule({ id: 'Bad_Id' })).code).toBe('INVALID_ID');
      registerAccessRule(rule({ id: 'first-rule' }));
      registerAccessRule(rule({ id: 'second-rule' }));
      expect(refusal(rule({ id: 'first-rule' })).code).toBe('DUPLICATE_ID');
      expect(accessRuleRegistry.ids()).toEqual(['first-rule', 'second-rule']);
    });
  });
});

describe('AccessPolicy with access rules', () => {
  it('a rule changes nothing when none is registered or none applies to the type', async () => {
    await withRules([rule({ id: 'other-type', resourceTypes: ['something_else'] })], new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      expect(await policy.decide(caller(), 'read', A)).toEqual({ allowed: false, role: null, via: null });
    });
  });

  it("an allow offers the type's weakest role by default and names the rule as `via`", async () => {
    await withRules([rule({ id: 'project-member' })], new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      expect(await policy.decide(caller(), 'read', A)).toEqual({ allowed: true, role: 'viewer', via: 'project-member' });
      // viewer does not reach `write` (editor): an allow cannot, by default, open a record to write.
      expect((await policy.decide(caller(), 'write', A)).allowed).toBe(false);
      expect(await policy.roleFor(caller(), A)).toBe('viewer');
    });
  });

  it('an allow confers the role it declares', async () => {
    await withRules([rule({ id: 'editors-club', role: 'editor' })], new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      expect(await policy.decide(caller(), 'write', A)).toEqual({ allowed: true, role: 'editor', via: 'editors-club' });
      expect((await policy.decide(caller(), 'share', A)).allowed).toBe(false);
    });
  });

  it('a deny of any rule wins over a grant, the org default and another rule allow', async () => {
    const rules = [rule({ id: 'allows' }), rule({ id: 'denies', position: 'after-grants', mayDeny: true, sql: () => null }, 'deny')];
    await withRules(
      rules,
      new Map([[DOC_A, byUser(BOB)]]),
      [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE })],
      async (policy) => {
        expect(await policy.decide(caller(), 'read', A)).toEqual({ allowed: false, role: null, via: null });
        expect(await policy.roleFor(caller(), A)).toBeNull();
      },
      { defaultVisibility: 'org', orgRole: 'viewer' },
    );
  });

  it('a deny also reaches a group owner (an ordinary source, not an exemption)', async () => {
    await withRules([rule({ id: 'freeze', mayDeny: true, sql: () => null }, 'deny')], new Map([[DOC_A, byGroup(GROUP)]]), [], async (policy) => {
      expect((await policy.decide(caller(['docs:write'], [[GROUP, 'admin']]), 'read', A)).allowed).toBe(false);
    });
  });

  it('the record\'s user owner is decided BEFORE the rules: a deny never locks the owner out', async () => {
    const evaluate = jest.fn(async () => 'deny' as const);
    await withRules([rule({ id: 'freeze', mayDeny: true, sql: () => null, evaluate })], new Map([[DOC_A, byUser(ALICE)]]), [], async (policy) => {
      expect(await policy.decide(caller(), 'share', A)).toEqual({ allowed: true, role: 'owner', via: 'owner' });
      expect(await policy.roleFor(caller(), A)).toBe('owner');
      expect(evaluate).not.toHaveBeenCalled();
    });
  });

  it('a bypass holder and a missing required permission are decided before the rules too', async () => {
    const evaluate = jest.fn(async () => 'deny' as const);
    await withRules([rule({ id: 'freeze', mayDeny: true, sql: () => null, evaluate })], new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      expect(await policy.decide(caller(['docs:write', 'docs:read_any']), 'read', A)).toEqual({ allowed: true, role: 'viewer', via: 'bypass' });
      expect(await policy.decide(caller([]), 'write', A)).toMatchObject({ allowed: false, missingPermission: 'docs:write' });
      expect(evaluate).not.toHaveBeenCalled();
    });
  });

  it('breaks a tie in favour of the earlier source: a before-grants rule beats a grant, an after-grants rule does not', async () => {
    const grants = [grantRow({ resourceId: DOC_A, role: 'viewer', userId: ALICE })];
    await withRules([rule({ id: 'early' })], new Map([[DOC_A, byUser(BOB)]]), grants, async (policy) => {
      expect((await policy.decide(caller(), 'read', A)).via).toBe('early');
    });
    await withRules([rule({ id: 'late', position: 'after-grants' })], new Map([[DOC_A, byUser(BOB)]]), grants, async (policy) => {
      expect((await policy.decide(caller(), 'read', A)).via).toBe('user_grant');
    });
  });

  it('abstain adds nothing; a stronger grant still wins over a rule allow', async () => {
    await withRules([rule({ id: 'quiet' }, 'abstain')], new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      expect((await policy.decide(caller(), 'read', A)).allowed).toBe(false);
    });
    await withRules([rule({ id: 'weak' })], new Map([[DOC_A, byUser(BOB)]]), [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE })], async (policy) => {
      expect(await policy.decide(caller(), 'write', A)).toEqual({ allowed: true, role: 'editor', via: 'user_grant' });
    });
  });

  describe('fails closed', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    const grantsToAlice = [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE })];

    it.each([
      ['a rule that throws', { evaluate: async () => { throw new Error('SECRET-SQL select * from users'); } }],
      ['a rule that rejects a non-error', { evaluate: () => Promise.reject('SECRET-TOKEN') }],
      ['a rule that returns an unknown verdict', { evaluate: async () => 'maybe' as never }],
      ['a rule that returns nothing', { evaluate: async () => undefined as never }],
      ['a rule that confers a role the type does not have', { role: 'superuser' }],
    ])('denies on %s, over a grant, and logs the rule id without the message', async (_name, overrides) => {
      await withRules([rule({ id: 'flaky', ...(overrides as object) })], new Map([[DOC_A, byUser(BOB)]]), grantsToAlice, async (policy) => {
        expect(await policy.decide(caller(), 'read', A)).toEqual({ allowed: false, role: null, via: null });
        expect(warn).toHaveBeenCalled();
        const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
        expect(logged).toContain('flaky');
        expect(logged).not.toContain('SECRET');
        expect(logged).not.toContain(ALICE);
        expect(logged).not.toContain(DOC_A);
      });
    });

    it('denies only the record whose rule failed, not the whole batch', async () => {
      const evaluate = jest.fn(async (ctx: { resource: { id: string } }) => {
        if (ctx.resource.id === DOC_B) throw new Error('boom');
        return 'allow' as const;
      });
      await withRules([rule({ id: 'half', evaluate: evaluate as never })], new Map([[DOC_A, byUser(BOB)], [DOC_B, byUser(BOB)]]), [], async (policy) => {
        const decisions = await policy.decideMany(caller(), 'read', [A, { type: 'test_doc', id: DOC_B }]);
        expect(decisions.get(`test_doc:${DOC_A}`)!.allowed).toBe(true);
        expect(decisions.get(`test_doc:${DOC_B}`)!.allowed).toBe(false);
      });
    });
  });

  it('gives a rule the caller, the action, the record, the transaction and one cache per call', async () => {
    const seen: Array<{ action: string | null; id: string; cache: Map<string, unknown>; tx: unknown; principalGroups: number }> = [];
    const spy = rule({
      id: 'probe',
      evaluate: async (ctx) => {
        seen.push({ action: ctx.action, id: ctx.resource.id, cache: ctx.cache, tx: ctx.tx, principalGroups: ctx.principal.groups?.length ?? 0 });
        return 'abstain';
      },
    });
    await withRules([spy], new Map([[DOC_A, byUser(BOB)], [DOC_B, byUser(BOB)]]), [], async (policy, tx) => {
      await policy.decideMany(caller(['docs:write'], [[GROUP, 'viewer']]), 'read', [A, { type: 'test_doc', id: DOC_B }]);
      await policy.roleFor(caller(), A);
      expect(seen.map((s) => [s.action, s.id])).toEqual([['read', DOC_A], ['read', DOC_B], [null, DOC_A]]);
      expect(seen[0]!.cache).toBe(seen[1]!.cache); // one call, one cache
      expect(seen[2]!.cache).not.toBe(seen[0]!.cache);
      expect(seen[0]!.tx).toBe(tx);
      expect(seen[0]!.principalGroups).toBe(1);
    });
  });

  it('reports `app` for a rule allow in the bounded metric label', async () => {
    await withRules([rule({ id: 'project-member' })], new Map([[DOC_A, byUser(BOB)]]), [], async (policy, _tx, metrics) => {
      await policy.decide(caller(), 'read', A);
      expect(metrics.add).toHaveBeenCalledWith('sharingAccessDecisions', 1, { resource_type: 'test_doc', outcome: 'allowed', via: 'app' });
    });
  });
});

describe('"resources I can see" with access rules', () => {
  const sqlOf = (value: FakeSql): string => value.text.replace(/\s+/g, ' ');

  const allowRule = (extra: Partial<AccessRuleDef> = {}): AccessRuleDef =>
    rule({ id: 'project-member', sql: (ctx) => ({ allow: ctx.kit.sql`${ctx.idColumn} IN (SELECT pm.doc_id FROM project_members pm WHERE pm.org_id = ${ctx.orgId}::uuid AND pm.user_id = ${ctx.principal.userId}::uuid)` }), ...extra });
  const denyRule: AccessRuleDef = rule(
    { id: 'frozen', mayDeny: true, sql: (ctx) => ({ deny: ctx.kit.sql`${ctx.column('frozen_at')} IS NOT NULL` }) },
    'deny',
  );

  it('is byte-for-byte what it was with no rule registered', async () => {
    await withTypes([docType(new Map())], async () => {
      const before = sqlOf(accessibleSql(caller(['x'], [[GROUP, 'viewer']]), 'test_doc', 'r', { sqlKit: fakeSqlKit }));
      await withTemporaryEntries(accessRuleRegistry, [rule({ id: 'other', resourceTypes: ['else'], sql: (ctx) => ({ allow: ctx.kit.sql`TRUE` }) })], () => {
        expect(sqlOf(accessibleSql(caller(['x'], [[GROUP, 'viewer']]), 'test_doc', 'r', { sqlKit: fakeSqlKit }))).toBe(before);
      });
    });
  });

  it("adds a rule's allow to the shared part, with every value a bind parameter", async () => {
    await withTypes([docType(new Map())], () =>
      withTemporaryEntries(accessRuleRegistry, [allowRule()], () => {
        const built = accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit }) as FakeSql;
        const text = sqlOf(built);
        expect(text).toContain('"r"."id" IN (SELECT pm.doc_id FROM project_members pm WHERE pm.org_id = $');
        expect(built.values).toEqual(expect.arrayContaining([ORG, ALICE]));
        // The allow sits in the shared part: absent from an `owned` listing.
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, scope: 'owned' }))).not.toContain('project_members');
      }),
    );
  });

  it("a rule allow below minRole contributes nothing; at or above it does", async () => {
    await withTypes([docType(new Map())], () =>
      withTemporaryEntries(accessRuleRegistry, [allowRule()], () => {
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, minRole: 'editor' }))).not.toContain('project_members');
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, minRole: 'viewer' }))).toContain('project_members');
      }),
    );
  });

  it("a rule's deny hides everything but the caller's own records, in every scope but `owned`", async () => {
    await withTypes([docType(new Map())], () =>
      withTemporaryEntries(accessRuleRegistry, [denyRule], () => {
        const all = sqlOf(accessibleSql(caller(['x'], [[GROUP, 'viewer']]), 'test_doc', 'r', { sqlKit: fakeSqlKit }));
        expect(all).toContain('"r"."owner_user_id" = $');
        expect(all).toContain('NOT ("r"."frozen_at" IS NOT NULL)');
        // The owner part is OUTSIDE the NOT: ownership is decided before the rules.
        expect(all.indexOf('"r"."owner_user_id"')).toBeLessThan(all.indexOf('NOT ('));
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, scope: 'owned' }))).not.toContain('frozen_at');
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, scope: 'shared' }))).not.toContain('"r"."owner_user_id"');
      }),
    );
  });

  it('a deny with nothing else to show leaves no records of a groups-only listing', async () => {
    await withTypes([docType(new Map())], () =>
      withTemporaryEntries(accessRuleRegistry, [denyRule], () => {
        // `shared` with a deny and the grants EXISTS still present: NOT (deny) AND (exists).
        expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit, scope: 'groups' }))).toContain('FALSE');
      }),
    );
  });

  it('fails closed when a rule that can deny cannot build its SQL, and ignores one that only allows', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const broken = (extra: Partial<AccessRuleDef>): AccessRuleDef =>
        rule({ id: 'broken', sql: () => { throw new Error('SECRET'); }, ...extra });
      await withTypes([docType(new Map())], async () => {
        await withTemporaryEntries(accessRuleRegistry, [broken({ mayDeny: true })], () => {
          const text = sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit }));
          expect(text).toContain('NOT (TRUE)');
        });
        await withTemporaryEntries(accessRuleRegistry, [broken({})], () => {
          expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit }))).not.toContain('NOT (');
        });
      });
      expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  it('a rule that confers a role the type lacks hides records instead of allowing them', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await withTypes([docType(new Map())], () =>
        withTemporaryEntries(accessRuleRegistry, [allowRule({ role: 'superuser' })], () => {
          expect(sqlOf(accessibleSql(caller(), 'test_doc', 'r', { sqlKit: fakeSqlKit }))).toContain('NOT (TRUE)');
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('accessibleWhere switches to the EXISTS form when a rule contributes, and not otherwise', async () => {
    const tx = fakeTx();
    await withTypes([docType(new Map())], async () => {
      expect((await accessibleWhere(caller(), 'test_doc', { tx, sqlKit: fakeSqlKit, scope: 'owned' })).form).toBe('where');
      await withTemporaryEntries(accessRuleRegistry, [allowRule()], async () => {
        const result = await accessibleWhere(caller(), 'test_doc', { tx, sqlKit: fakeSqlKit });
        expect(result.form).toBe('exists');
        expect(sqlOf((result as { sql: FakeSql }).sql)).toContain('project_members');
        // `owned` needs no rule.
        expect((await accessibleWhere(caller(), 'test_doc', { tx, sqlKit: fakeSqlKit, scope: 'owned' })).form).toBe('where');
        // A rule that adds nothing for this caller keeps the Prisma form.
      });
      await withTemporaryEntries(accessRuleRegistry, [allowRule({ sql: () => null })], async () => {
        expect((await accessibleWhere(caller(), 'test_doc', { tx, sqlKit: fakeSqlKit })).form).toBe('where');
      });
    });
  });

  it('keeps every hostile principal string out of the SQL text', async () => {
    const evil = "'; DROP TABLE grants; --";
    const hostile = principal({ userId: evil, activeOrgId: evil, email: evil, groups: [{ groupId: evil, orgId: evil, role: 'viewer' }] });
    await withTypes([docType(new Map())], () =>
      withTemporaryEntries(accessRuleRegistry, [allowRule(), denyRule], () => {
        const built = accessibleSql(hostile, 'test_doc', 'r', { sqlKit: recordingSqlKit }) as RecordedSql;
        expect(built.text).not.toContain(evil);
        expect(built.values).toContain(evil);
        for (const raw of built.raws) expect(raw).toMatch(/^[A-Za-z0-9_."]+$/);
      }),
    );
  });
});

describe('grantee kinds', () => {
  const emailDomain = (overrides: Partial<GranteeKindDef> = {}): GranteeKindDef => ({
    kind: 'email-domain',
    label: 'Email domain',
    input: 'text',
    validateGrantee: (input) => ({ kind: 'email-domain', id: String(input).toLowerCase() }),
    describe: async (ref) => ({ display: `@${ref.id}` }),
    matchesPrincipal: (facts, who) => facts.ref === who.email.split('@')[1],
    resolvePrincipalMatch: (who, g, kit) => kit.sql`(${g.kind} = 'email-domain' AND ${g.ref} = ${who.email.split('@')[1]})`,
    ...overrides,
  });

  function refusal(def: GranteeKindDef): RegistryError {
    try {
      registerGranteeKind(def);
    } catch (error) {
      return error as RegistryError;
    }
    throw new Error('expected a refusal');
  }

  it('registers user, group and link through the same call, in that order', () => {
    expect(granteeKindRegistry.ids().slice(0, 3)).toEqual(['user', 'group', 'link']);
    expect(granteeKindRegistry.list().slice(0, 3).map(describeGranteeKind)).toEqual([
      { kind: 'user', label: 'Person', description: 'One member of the organization.', input: 'user-search', builtin: true, persisted: true },
      { kind: 'group', label: 'Group', description: 'Every member of one group of the organization.', input: 'group-select', builtin: true, persisted: true },
      { kind: 'link', label: 'Link', description: 'Anyone holding the link, without signing in.', input: 'none', builtin: true, persisted: true },
    ]);
    expect(persistedGranteeKinds().map((def) => def.kind)).toEqual(['user', 'group', 'link']);
  });

  it('lists an app kind without storing grants of it', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], () => {
      registerGranteeKind(emailDomain());
      expect(describeGranteeKind(granteeKindRegistry.get('email-domain')!)).toEqual({
        kind: 'email-domain',
        label: 'Email domain',
        description: null,
        input: 'text',
        builtin: false,
        persisted: false,
      });
      expect(persistedGranteeKinds().map((def) => def.kind)).not.toContain('email-domain');
    });
  });

  it('refuses persisting an app kind until the storage migration ships, and says why', async () => {
    expect(GRANTEE_KIND_PERSISTENCE_AVAILABLE).toBe(false);
    await withTemporaryEntries(granteeKindRegistry, [], () => {
      const error = refusal(emailDomain({ persisted: true, principalWhere: () => null }));
      expect(error.code).toBe('INVALID_ENTRY');
      expect(error.message).toContain('grantee kind "email-domain"');
      expect(error.message).toContain('cannot be stored yet');
    });
  });

  it.each([
    ['the reserved wire discriminator', { kind: 'custom' }, 'reserved'],
    ['no label', { label: ' ' }, '`label`'],
    ['an unknown input', { input: 'wizard' as never }, '`input`'],
    ['a missing validateGrantee', { validateGrantee: undefined as never }, '`validateGrantee`'],
    ['a missing resolvePrincipalMatch', { resolvePrincipalMatch: undefined as never }, '`resolvePrincipalMatch`'],
    ['persisted without principalWhere', { persisted: true }, '`principalWhere`'],
    ['a via with capitals', { via: 'Email' }, '`via`'],
  ])('refuses %s', async (_name, overrides, message) => {
    await withTemporaryEntries(granteeKindRegistry, [], () => {
      const error = refusal(emailDomain(overrides as never));
      expect(error.code).toBe('INVALID_ENTRY');
      expect(error.message).toContain(message);
    });
  });

  it('refuses a bad id and a duplicate (a built-in included)', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], () => {
      expect(refusal(emailDomain({ kind: 'Email_Domain' })).code).toBe('INVALID_ID');
      expect(refusal(emailDomain({ kind: 'user' })).code).toBe('DUPLICATE_ID');
    });
  });

  describe('the built-in fragments', () => {
    const user = granteeKindRegistry.get('user')!;
    const group = granteeKindRegistry.get('group')!;
    const link = granteeKindRegistry.get('link')!;
    const columns = { kind: recordingSqlKit.raw('g.grantee_kind'), userId: recordingSqlKit.raw('g.grantee_user_id'), groupId: recordingSqlKit.raw('g.grantee_group_id'), ref: recordingSqlKit.raw('g.grantee_ref') };
    const evil = "'); DROP TABLE users; --";

    it('are predicates over the grant row with every value bound', () => {
      const hostile = principal({ userId: evil, groups: [{ groupId: evil, orgId: ORG, role: 'viewer' }] });
      for (const def of [user, group]) {
        const fragment = def.resolvePrincipalMatch<RecordedSql>(hostile, columns, recordingSqlKit)!;
        expect(fragment.text).not.toContain(evil);
        expect(fragment.values).toContain(evil);
        expect(fragment.text).not.toMatch(/\bselect\b|\bfrom\b/i);
      }
    });

    it('say the same in memory: user, group and link', () => {
      const me = caller(['x'], [[GROUP, 'viewer']]);
      expect(user.matchesPrincipal({ kind: 'user', userId: ALICE, groupId: null, ref: null }, me)).toBe(true);
      expect(user.matchesPrincipal({ kind: 'user', userId: BOB, groupId: null, ref: null }, me)).toBe(false);
      expect(user.matchesPrincipal({ kind: 'group', userId: ALICE, groupId: null, ref: null }, me)).toBe(false);
      expect(group.matchesPrincipal({ kind: 'group', userId: null, groupId: GROUP, ref: null }, me)).toBe(true);
      expect(group.matchesPrincipal({ kind: 'group', userId: null, groupId: BOB, ref: null }, me)).toBe(false);
      expect(group.resolvePrincipalMatch(caller(), columns, recordingSqlKit)).toBeNull();
      expect(group.principalWhere!(caller())).toBeNull();
      expect(link.matchesPrincipal({ kind: 'link', userId: null, groupId: null, ref: null }, me)).toBe(false);
      expect(link.resolvePrincipalMatch(me, columns, recordingSqlKit)).toBeNull();
      expect(link.principalWhere!(me)).toBeNull();
    });

    it('validate their input', () => {
      expect(user.validateGrantee({ userId: ALICE.toUpperCase() })).toEqual({ kind: 'user', id: ALICE });
      expect(user.validateGrantee({ email: ' Ana@Example.COM ' })).toEqual({ kind: 'user', id: 'ana@example.com' });
      expect(() => user.validateGrantee({})).toThrow();
      expect(group.validateGrantee({ groupId: GROUP })).toEqual({ kind: 'group', id: GROUP });
      expect(() => group.validateGrantee({ groupId: 'nope' })).toThrow();
      expect(() => link.validateGrantee({})).toThrow(/POST \/api\/grants\/links/);
    });
  });
});
