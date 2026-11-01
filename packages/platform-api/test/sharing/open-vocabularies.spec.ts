// Open sharing vocabularies (PP-14.15b, #967): the group-role registry, group
// services over an app role, resource types that map app roles and list app
// grantee kinds, and the platform's pin of an app kind's predicate to the
// kind. The grants API over a persisted app kind is covered at the bottom with
// a mocked transaction; the real-database proof is
// apps/api/test/examples/sharing/*.db.spec.ts.

import { HttpException } from '@nestjs/common';

import { withTemporaryEntries } from '../../src/core/index';
import {
  AccessPolicy,
  GrantsService,
  GroupMembershipService,
  MemberLookupThrottle,
  GranteeInputError,
  granteeKindRegistry,
  groupRoleAtLeast,
  groupRoleCan,
  groupRoleRank,
  groupRoleRegistry,
  listGroupRoles,
  managerGroupRoleIds,
  registerGranteeKind,
  registerGroupRole,
  describeGroupRole,
  type GranteeKindDef,
} from '../../src/sharing/index';
import { granteeSqlFor, granteeWhereFor } from '../../src/sharing/access/grantee-kinds';
import { findResourceType, registerResourceType, resourceTypeRegistry } from '../../src/sharing/access/resource-types';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, CAROL, GROUP, ORG, fakeData, fakeEffects, fakeTx, groupRow, memberRow, options, principal, type FakeTx } from './fakes';
import { DOC_A, byUser, docType, withTypes } from './grants-fakes';
import { recordingSqlKit, type RecordedSql } from '../../src/sharing/testing/index';

const commenter = { id: 'commenter', label: 'Commenter', actions: ['read', 'comment'] } as const;
const moderator = { id: 'moderator', label: 'Moderator', actions: ['read', 'manage'] } as const;

function withRoles<R>(fn: () => Promise<R> | R, defs: Array<{ id: string; label: string; actions: readonly string[] }> = [commenter]): Promise<R> {
  return withTemporaryEntries(groupRoleRegistry, [], async () => {
    for (const def of defs) registerGroupRole(def);
    return fn();
  });
}

async function status(promise: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await promise;
    return [200, null];
  } catch (error) {
    return error instanceof HttpException ? [error.getStatus(), error.getResponse()] : [500, error];
  }
}

describe('the group-role registry', () => {
  it('registers admin, editor and viewer through the same call, strongest first', () => {
    expect(listGroupRoles().map((def) => def.id)).toEqual(['admin', 'editor', 'viewer']);
    expect(['admin', 'editor', 'viewer'].map(groupRoleRank)).toEqual([3, 2, 1]);
    expect(describeGroupRole(groupRoleRegistry.get('admin')!)).toMatchObject({ id: 'admin', builtin: true, actions: ['read', 'write', 'manage'] });
    expect(managerGroupRoleIds()).toEqual(['admin']);
  });

  it('adds an app role with an app action and ranks it by its platform actions', async () => {
    await withRoles(() => {
      expect(groupRoleRank('commenter')).toBe(1);
      expect(groupRoleCan('commenter', 'comment')).toBe(true);
      expect(groupRoleCan('commenter', 'write')).toBe(false);
      expect(groupRoleAtLeast('commenter', 'viewer')).toBe(true);
      expect(groupRoleAtLeast('commenter', 'editor')).toBe(false);
      expect(describeGroupRole(groupRoleRegistry.get('commenter')!)).toMatchObject({ builtin: false, description: null });
    });
  });

  it('fails closed for a role nobody registered: rank 0, no action, satisfies nothing', () => {
    expect(groupRoleRank('ghost')).toBe(0);
    expect(groupRoleCan('ghost', 'read')).toBe(false);
    expect(groupRoleCan(null, 'read')).toBe(false);
    expect(groupRoleAtLeast('ghost', 'ghost')).toBe(false);
    expect(groupRoleAtLeast('admin', 'ghost')).toBe(false);
  });

  it.each([
    ['owner', { id: 'owner', label: 'Owner', actions: ['manage'] }, 'reserved'],
    ['no label', { id: 'x_role', label: ' ', actions: ['read'] }, '`label`'],
    ['no actions', { id: 'x_role', label: 'X', actions: [] }, '`actions`'],
    ['a duplicate action', { id: 'x_role', label: 'X', actions: ['read', 'read'] }, 'unique'],
    ['a badly spelled action', { id: 'x_role', label: 'X', actions: ['Read'] }, 'snake_case'],
  ])('refuses %s', async (_name, def, message) => {
    await withRoles(
      () => {
        expect(() => registerGroupRole(def as never)).toThrow(message);
      },
      [],
    );
  });

  it('refuses a badly formed id and a duplicate', async () => {
    await withRoles(() => {
      expect(() => registerGroupRole({ id: 'Bad Role', label: 'X', actions: ['read'] })).toThrow();
      expect(() => registerGroupRole(commenter)).toThrow();
    });
  });

  it('freezes the registered definition and its actions', async () => {
    const source = { id: 'frozen_role', label: 'F', actions: ['read'] };
    await withRoles(() => {
      source.actions.push('manage'); // the app's later mutation of its own array changes nothing
      expect(groupRoleCan('frozen_role', 'manage')).toBe(false);
      expect(Object.isFrozen(groupRoleRegistry.get('frozen_role'))).toBe(true);
    }, [source]);
  });
});

describe('group services over an app role', () => {
  function build(tx: FakeTx) {
    const fx = fakeEffects(tx);
    return { service: new GroupMembershipService(fakeData(tx), options(), new MemberLookupThrottle(), fx.effects), ...fx };
  }
  function asMember(tx: FakeTx, me: string, others: Record<string, string> = {}) {
    tx.group.findFirst.mockResolvedValue(groupRow());
    tx.groupMember.findUnique.mockImplementation(async ({ where }: { where: { groupId_userId: { userId: string } } }) => {
      const userId = where.groupId_userId.userId;
      const role = userId === ALICE ? me : others[userId];
      return role ? memberRow(userId, role as 'admin') : null;
    });
  }

  it('adds a member with a registered app role, and refuses an unregistered one with 422 GROUP_ROLE_UNKNOWN', async () => {
    await withRoles(async () => {
      const tx = fakeTx();
      asMember(tx, 'admin');
      tx.user.findUnique.mockResolvedValue({ id: CAROL, email: 'c@example.com', displayName: null, providerDisplayName: null, isActive: true });
      tx.membership.findFirst.mockResolvedValue({ userId: CAROL });
      tx.groupMember.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => memberRow(CAROL, data.role as 'admin', data));
      const { service } = build(tx);
      expect(await service.add(principal(), GROUP, { userId: CAROL, role: 'commenter' })).toMatchObject({ role: 'commenter' });
      expect(tx.groupMember.create.mock.calls[0][0].data.role).toBe('commenter');

      const [code, body] = await status(service.add(principal(), GROUP, { userId: CAROL, role: 'ghost' }));
      expect(code).toBe(422);
      expect(JSON.stringify(body)).toContain('GROUP_ROLE_UNKNOWN');
      expect(tx.groupMember.create).toHaveBeenCalledTimes(1);
      expect((await status(service.changeRole(principal(), GROUP, CAROL, 'ghost')))[0]).toBe(422);
    });
  });

  it('lets only a role with the manage action administer the group', async () => {
    await withRoles(async () => {
      const tx = fakeTx();
      const { service } = build(tx);
      asMember(tx, 'commenter');
      await expect(service.access(tx as never, principal(), ORG, GROUP, 'member')).resolves.toMatchObject({ myRole: 'commenter' });
      await expect(service.access(tx as never, principal(), ORG, GROUP, 'admin')).rejects.toMatchObject({ status: 403 });
      asMember(tx, 'moderator');
      await expect(service.access(tx as never, principal(), ORG, GROUP, 'admin')).resolves.toMatchObject({ myRole: 'moderator' });
    }, [commenter, moderator]);
  });

  it('counts a custom manager for the last-admin guard', async () => {
    await withRoles(async () => {
      const tx = fakeTx();
      asMember(tx, 'admin', { [BOB]: 'moderator' });
      tx.groupMember.count.mockResolvedValue(1);
      tx.groupMember.update.mockImplementation(async ({ data }: { data: { role: string } }) => memberRow(BOB, data.role as 'admin'));
      const { service } = build(tx);
      // Demoting the only remaining manager is refused (409 LAST_GROUP_ADMIN) ...
      expect((await status(service.changeRole(principal(), GROUP, BOB, 'commenter')))[0]).toBe(409);
      // ... and the count asked for every role that can manage.
      expect(tx.groupMember.count.mock.calls[0][0].where).toEqual({ groupId: GROUP, role: { in: ['admin', 'moderator'] } });
      // Demoting a member who cannot manage is not blocked by the guard.
      asMember(tx, 'admin', { [BOB]: 'commenter' });
      expect((await status(service.changeRole(principal(), GROUP, BOB, 'viewer')))[0]).toBe(200);
    }, [commenter, moderator]);
  });
});

describe('resource types over open vocabularies', () => {
  const def = (extra: Record<string, unknown> = {}) => docType(new Map(), extra as never);

  it('maps a group role the registry knows and gives an unmapped app role no access', async () => {
    await withRoles(async () => {
      await withTypes([def({ groupRoleMap: { commenter: 'viewer' } })], () => {
        const rt = findResourceType('test_doc')!;
        expect(rt.groupRole('admin')).toBe('owner');
        expect(rt.groupRole('commenter')).toBe('viewer');
        expect(rt.groupRole('moderator')).toBeNull();
        expect(rt.groupRole('constructor')).toBeNull(); // an own-key lookup, not a prototype one
        expect(rt.groupRole('__proto__')).toBeNull();
      });
    }, [commenter, moderator]);
  });

  it('refuses a groupRoleMap key that is not a registered group role', async () => {
    await withTemporaryEntries(resourceTypeRegistry, [], () => {
      expect(() => registerResourceType(def({ groupRoleMap: { commenter: 'viewer' } }))).toThrow('not a registered group role');
    });
  });

  it('lists the roles of a registered app grantee kind, and none by default', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain());
      await withTypes([def({ grantable: { 'email-domain': ['viewer'] } })], () => {
        const rt = findResourceType('test_doc')!;
        expect(rt.grantable('email-domain')).toEqual(['viewer']);
        expect(rt.grantable('user')).toEqual(['viewer', 'editor']);
        expect(rt.grantable('link')).toEqual([]);
        expect(rt.grantable('nobody-registered')).toEqual([]);
        expect(rt.grantable('constructor')).toEqual([]);
      });
      await withTypes([def()], () => expect(findResourceType('test_doc')!.grantable('email-domain')).toEqual([]));
      await withTemporaryEntries(resourceTypeRegistry, [], () => {
        expect(() => registerResourceType(def({ grantable: { team: ['viewer'] } }))).toThrow('not a registered grantee kind');
      });
    });
  });
});

function emailDomain(overrides: Partial<GranteeKindDef> = {}): GranteeKindDef {
  return {
    kind: 'email-domain',
    label: 'Email domain',
    input: 'text',
    persisted: true,
    validateGrantee: (input) => {
      const domain = String(input).trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new GranteeInputError('Enter a domain such as example.com.');
      return { kind: 'email-domain', id: domain };
    },
    describe: async (ref) => ({ display: `Anyone at @${ref.id}` }),
    matchesPrincipal: (facts, who) => facts.ref === who.email.split('@')[1],
    resolvePrincipalMatch: (who, g, kit) => kit.sql`lower(${g.ref}) = ${who.email.split('@')[1]}`,
    principalWhere: (who) => ({ granteeRef: who.email.split('@')[1] }),
    ...overrides,
  };
}

describe('the platform pins an app kind to its kind', () => {
  const who = principal({ email: 'amy@example.com' });

  it('wraps an app kind predicate with its kind, even one that is too broad', () => {
    expect(granteeWhereFor(emailDomain({ principalWhere: () => ({}) }), who)).toEqual({ AND: [{ granteeKind: 'email-domain' }, {}] });
    expect(granteeWhereFor(emailDomain({ principalWhere: () => ({ OR: [] }) }), who)).toEqual({ AND: [{ granteeKind: 'email-domain' }, { OR: [] }] });
    expect(granteeWhereFor(emailDomain(), who)).toEqual({ AND: [{ granteeKind: 'email-domain' }, { granteeRef: 'example.com' }] });
  });

  it('leaves a built-in kind as it is and drops a kind that names nobody or throws', () => {
    const user = granteeKindRegistry.get('user')!;
    expect(granteeWhereFor(user, who)).toEqual({ granteeKind: 'user', granteeUserId: who.userId });
    expect(granteeWhereFor(emailDomain({ principalWhere: () => null }), who)).toBeNull();
    expect(
      granteeWhereFor(
        emailDomain({
          principalWhere: () => {
            throw new Error('boom');
          },
        }),
        who,
      ),
    ).toBeNull();
  });

  it('pins the SQL with the kind as a bind parameter, never interpolated', () => {
    const columns = { kind: recordingSqlKit.raw('g.grantee_kind'), userId: recordingSqlKit.raw('g.grantee_user_id'), groupId: recordingSqlKit.raw('g.grantee_group_id'), ref: recordingSqlKit.raw('g.grantee_ref') };
    const sql = granteeSqlFor(emailDomain({ resolvePrincipalMatch: (_p, _g, kit) => kit.sql`TRUE` }), who, columns, recordingSqlKit) as RecordedSql;
    expect(sql.text).toContain('g.grantee_kind');
    expect(sql.text).not.toContain('email-domain');
    expect(sql.values).toContain('email-domain');
    expect(granteeSqlFor(emailDomain({ resolvePrincipalMatch: () => null }), who, columns, recordingSqlKit)).toBeNull();
  });
});

describe('GrantsService.create over a persisted app kind', () => {
  const NOW = Date.parse('2026-06-01T00:00:00Z');
  const GRANT = '99999999-0000-4000-8000-000000000001';
  const row = (extra: Record<string, unknown> = {}) => ({
    id: GRANT,
    orgId: ORG,
    resourceType: 'test_doc',
    resourceId: DOC_A,
    granteeKind: 'email-domain',
    granteeUserId: null,
    granteeGroupId: null,
    granteeRef: 'example.com',
    role: 'viewer',
    linkTokenHash: null,
    linkTokenCiphertext: null,
    linkLabel: null,
    expiresAt: null,
    revokedAt: null,
    revokedById: null,
    grantedById: ALICE,
    metadata: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    granteeUser: null,
    granteeGroup: null,
    ...extra,
  });

  function build(tx: FakeTx) {
    const data = fakeData(tx);
    const groups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
    jest.spyOn(groups, 'groupsFor').mockResolvedValue([]);
    const policy = new AccessPolicy(data, groups, undefined, () => NOW);
    const fx = fakeEffects(tx);
    return { service: new GrantsService(data, policy, groups, new MemberLookupThrottle(), fx.effects, () => NOW), ...fx };
  }

  const owner = () => principal({ permissions: ['sharing:read', 'sharing:write'], groups: [] });
  const create = (service: GrantsService, ref: string, kind = 'email-domain', role = 'viewer') =>
    service.create(owner(), { resourceType: 'test_doc', resourceId: DOC_A, role, grantee: { kind: 'custom', granteeKind: kind, ref } });
  const type = () => docType(new Map([[DOC_A, byUser(ALICE)]]), { grantable: { 'email-domain': ['viewer'] } });

  function seeded(): FakeTx {
    const tx = fakeTx();
    tx.grant.findUnique.mockResolvedValue(row());
    tx.$queryRaw.mockResolvedValue([{ id: GRANT, inserted: true, previous_role: null, previous_expires_at: null }]);
    return tx;
  }

  it('stores the kind and the NORMALISED reference through a parameterised upsert, then describes it', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain());
      const tx = seeded();
      const { service, emitted } = build(tx);
      await withTypes([type()], async () => {
        const dto = await create(service, '  Example.COM ');
        expect(dto.grantee).toMatchObject({ kind: 'email-domain', ref: 'example.com', display: 'Anyone at @example.com', userId: null, groupId: null });
      });
      const call = tx.$queryRaw.mock.calls[0]!;
      const text = (call[0] as string[]).join('?');
      expect(text).toContain('grantee_kind, grantee_ref');
      expect(text).toContain("WHERE grantee_kind NOT IN ('user', 'group', 'link') AND revoked_at IS NULL");
      expect(call.slice(1)).toEqual(expect.arrayContaining(['email-domain', 'example.com']));
      expect(tx.auditEvent.create.mock.calls[0][0].data.meta).toMatchObject({ granteeKind: 'email-domain', granteeId: 'example.com', role: 'viewer' });
      expect(emitted[0]).toMatchObject({ payload: { granteeKind: 'email-domain', granteeId: 'example.com' } });
    });
  });

  it.each([
    ['an unknown kind', 'ghost', 'x.com', 'viewer', 'GRANTEE_KIND_UNKNOWN'],
    ['a built-in id through the custom shape', 'link', 'x.com', 'viewer', 'GRANTEE_INVALID'],
    ['an invalid reference', 'email-domain', 'not a domain', 'viewer', 'GRANTEE_INVALID'],
    ['a role the type does not grant to the kind', 'email-domain', 'example.com', 'editor', 'ROLE_NOT_GRANTABLE'],
  ])('refuses %s with 422 %s and writes nothing', async (_name, kind, ref, role, reason) => {
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain());
      const tx = seeded();
      const { service } = build(tx);
      await withTypes([type()], async () => {
        const [code, body] = await status(create(service, ref, kind, role));
        expect(code).toBe(422);
        expect(JSON.stringify(body)).toContain(reason);
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('refuses a kind that is not persisted (422 GRANTEE_KIND_NOT_PERSISTABLE) and a reference the kind returns out of bounds', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain({ persisted: false, principalWhere: undefined }));
      const tx = seeded();
      const { service } = build(tx);
      await withTypes([type()], async () => {
        expect(JSON.stringify((await status(create(service, 'example.com')))[1])).toContain('GRANTEE_KIND_NOT_PERSISTABLE');
      });
    });
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain({ validateGrantee: () => ({ kind: 'email-domain', id: 'x'.repeat(300) }) }));
      const tx = seeded();
      const { service } = build(tx);
      await withTypes([type()], async () => {
        expect(JSON.stringify((await status(create(service, 'example.com')))[1])).toContain('GRANTEE_INVALID');
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('does not tell a caller who may not share the record anything about a kind (404 first)', async () => {
    await withTemporaryEntries(granteeKindRegistry, [], async () => {
      registerGranteeKind(emailDomain());
      const tx = seeded();
      const { service } = build(tx);
      await withTypes([type()], async () => {
        const stranger = principal({ userId: BOB, permissions: ['sharing:read', 'sharing:write'], groups: [] });
        const [code] = await status(service.create(stranger, { resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer', grantee: { kind: 'custom', granteeKind: 'email-domain', ref: 'not a domain' } }));
        expect(code).toBe(404);
      });
    });
  });
});
