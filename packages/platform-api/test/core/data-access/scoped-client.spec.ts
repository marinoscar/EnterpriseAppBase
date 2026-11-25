import { trace, type Span } from '@opentelemetry/api';

import {
  ScopedAccessError,
  asSystem,
  forUser,
  userScopeExtension,
  type PrismaClientLike,
  type Scope,
} from '../../../src/core';
import { scopeQueryArgs } from '../../../src/core/data-access/scoped-client';
import { A, B, fakeClient, fixtureRegistry } from './fixtures';

// =============================================================================
// Scoped data access: argument rewriting per operation (#688, moved by #699)
// =============================================================================
//
// Pure: `scopeQueryArgs` cases assert on the arguments the extension would hand
// to Prisma's `query`; the `forUser` cases run the real extension against a
// fake client implementing `$extends` (no database). The real-database proof
// that those arguments isolate users is the reference app's
// apps/api/test/prisma/scoped-access.db.spec.ts.
// =============================================================================

const scope = { userId: A };

const rewrite = (model: string | undefined, operation: string, args: unknown) =>
  scopeQueryArgs({ model, operation, args }, scope, fixtureRegistry);

describe('scopeQueryArgs', () => {
  describe('filter operations AND the owner condition into where', () => {
    it.each(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'updateManyAndReturn', 'deleteMany'])(
      '%s',
      (operation) => {
        const where = { purpose: 'webhook', userId: B };
        expect(rewrite('UserCredential', operation, { where, take: 5 })).toEqual({
          where: { AND: [where, { userId: A }] },
          take: 5,
        });
      },
    );

    it('adds a where when there is none', () => {
      expect(rewrite('UserCredential', 'findMany', undefined)).toEqual({ where: { AND: [{}, { userId: A }] } });
      expect(rewrite('UserCredential', 'count', {})).toEqual({ where: { AND: [{}, { userId: A }] } });
    });

    it("uses the model's own owner field", () => {
      expect(rewrite('StorageObject', 'findMany', {})).toEqual({ where: { AND: [{}, { uploadedById: A }] } });
      expect(rewrite('WorkerNode', 'count', {})).toEqual({ where: { AND: [{}, { createdById: A }] } });
    });
  });

  describe('unique operations add the owner condition to the unique where', () => {
    it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])('%s', (operation) => {
      const where = { id: 'row-1' };
      expect(rewrite('UserCredential', operation, { where, data: { label: 'x' } })).toEqual({
        where: { id: 'row-1', AND: [{ userId: A }] },
        data: { label: 'x' },
      });
    });

    it('keeps an existing AND, as an object or an array', () => {
      expect(rewrite('UserCredential', 'findUnique', { where: { id: 'r', AND: { purpose: 'p' } } })).toEqual({
        where: { id: 'r', AND: [{ purpose: 'p' }, { userId: A }] },
      });
      expect(rewrite('UserCredential', 'findUnique', { where: { id: 'r', AND: [{ purpose: 'p' }] } })).toEqual({
        where: { id: 'r', AND: [{ purpose: 'p' }, { userId: A }] },
      });
    });

    it("keeps a compound unique naming another user, so B's row is simply not found", () => {
      const compound = { userId_purpose_name: { userId: B, purpose: 'p', name: 'n' } };
      expect(rewrite('UserCredential', 'findUnique', { where: compound })).toEqual({
        where: { ...compound, AND: [{ userId: A }] },
      });
    });
  });

  describe('creates', () => {
    it('sets the owner when it is absent', () => {
      expect(rewrite('UserCredential', 'create', { data: { purpose: 'p', name: 'n', secret: 's' } })).toEqual({
        data: { purpose: 'p', name: 'n', secret: 's', userId: A },
      });
    });

    it('accepts the scope user as the owner, as a scalar or a relation connect', () => {
      const scalar = { data: { userId: A, purpose: 'p' } };
      expect(rewrite('UserCredential', 'create', scalar)).toEqual(scalar);
      const connect = { data: { user: { connect: { id: A } }, purpose: 'p' } };
      expect(rewrite('UserCredential', 'create', connect)).toEqual(connect);
    });

    it.each<[string, unknown]>([
      ['another user as the scalar', { userId: B }],
      ['another user as { set }', { userId: { set: B } }],
      ['another user as a relation connect', { user: { connect: { id: B } } }],
      ['a connect by another unique field', { user: { connect: { email: 'a@example.test' } } }],
      ['a nested create of the owner', { user: { create: { email: 'x@example.test' } } }],
    ])('throws for %s', (_label, data) => {
      expect(() => rewrite('UserCredential', 'create', { data })).toThrow(ScopedAccessError);
    });

    it('sets or checks the owner on every row of createMany and createManyAndReturn', () => {
      expect(rewrite('Notification', 'createMany', { data: [{ eventKey: 'a' }, { eventKey: 'b', userId: A }] })).toEqual({
        data: [
          { eventKey: 'a', userId: A },
          { eventKey: 'b', userId: A },
        ],
      });
      expect(rewrite('Notification', 'createManyAndReturn', { data: { eventKey: 'a' } })).toEqual({
        data: { eventKey: 'a', userId: A },
      });
      expect(() => rewrite('Notification', 'createMany', { data: [{ eventKey: 'a' }, { userId: B }] })).toThrow(
        ScopedAccessError,
      );
    });

    it('scopes both halves of an upsert', () => {
      expect(
        rewrite('UserCredential', 'upsert', {
          where: { userId_purpose_name: { userId: A, purpose: 'p', name: 'n' } },
          create: { user: { connect: { id: A } }, purpose: 'p', name: 'n', secret: 's' },
          update: { secret: 't' },
        }),
      ).toEqual({
        where: { userId_purpose_name: { userId: A, purpose: 'p', name: 'n' }, AND: [{ userId: A }] },
        create: { user: { connect: { id: A } }, purpose: 'p', name: 'n', secret: 's' },
        update: { secret: 't' },
      });
      expect(() =>
        rewrite('UserCredential', 'upsert', { where: { id: 'r' }, create: { userId: B }, update: {} }),
      ).toThrow(ScopedAccessError);
    });
  });

  describe('updates cannot move a row to another owner', () => {
    it.each(['update', 'updateMany', 'updateManyAndReturn'])('%s', (operation) => {
      expect(() => rewrite('UserCredential', operation, { where: { id: 'r' }, data: { userId: B } })).toThrow(
        ScopedAccessError,
      );
      expect(() =>
        rewrite('UserCredential', operation, { where: { id: 'r' }, data: { user: { connect: { id: B } } } }),
      ).toThrow(ScopedAccessError);
      expect(() => rewrite('UserCredential', operation, { where: { id: 'r' }, data: { userId: A } })).not.toThrow();
    });

    it('upsert.update', () => {
      expect(() =>
        rewrite('UserCredential', 'upsert', { where: { id: 'r' }, create: {}, update: { userId: { set: B } } }),
      ).toThrow(ScopedAccessError);
    });
  });

  describe('refusals', () => {
    it('refuses an actor-only model, naming asSystem()', () => {
      expect(() => rewrite('AuditEvent', 'findMany', {})).toThrow(
        new ScopedAccessError('AuditEvent is not user-owned; use asSystem() with a reason.'),
      );
    });

    it('refuses an unregistered model', () => {
      expect(() => rewrite('Role', 'findMany', {})).toThrow('Role is not user-owned; use asSystem() with a reason.');
      expect(() => rewrite('User', 'findUnique', { where: { id: A } })).toThrow(ScopedAccessError);
    });

    it.each(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'])('refuses raw SQL (%s)', (operation) => {
      expect(() => rewrite(undefined, operation, {})).toThrow(/raw SQL is system-only/);
    });

    it('refuses an operation it does not know how to scope', () => {
      expect(() => rewrite('UserCredential', 'findRaw', {})).toThrow(/not supported on a user-scoped client/);
    });

    it('carries the model and operation on the error', () => {
      try {
        rewrite('AuditEvent', 'count', {});
        throw new Error('expected a throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ScopedAccessError);
        expect(err).toMatchObject({ name: 'ScopedAccessError', model: 'AuditEvent', operation: 'count' });
      }
    });
  });

  it('never mutates the caller’s arguments', () => {
    const args = { where: { id: 'r' }, data: { purpose: 'p' } };
    const frozen = JSON.parse(JSON.stringify(args));
    rewrite('UserCredential', 'update', args);
    rewrite('UserCredential', 'create', { data: args.data });
    expect(args).toEqual(frozen);
  });

  it('applies only userId: orgId and groupIds are accepted and ignored', () => {
    expect(
      scopeQueryArgs(
        { model: 'Notification', operation: 'count', args: {} },
        { userId: A, orgId: 'org', groupIds: ['g'] },
        fixtureRegistry,
      ),
    ).toEqual({ where: { AND: [{}, { userId: A }] } });
  });
});

// The extension end to end, against a fake client implementing `$extends`.
type Db = Record<string, Record<string, (args?: unknown) => Promise<unknown>>> &
  Record<'$queryRaw' | '$executeRaw', (...args: unknown[]) => Promise<unknown>>;

function scoped(scopeArg: Scope = scope) {
  const fake = fakeClient();
  const db = forUser(fake.client, scopeArg, fixtureRegistry) as Db;
  return { db, ...fake };
}

describe('forUser (fake client, no database)', () => {
  it('extends the client once, through Prisma.defineExtension, with the user-scope extension', () => {
    const { names } = scoped();
    expect(names).toEqual(['user-scope']);
    expect(typeof userScopeExtension(scope, fixtureRegistry)).toBe('function');
  });

  it('find: constrains the where to the scope user', async () => {
    const { db, calls } = scoped();
    await db.userCredential.findMany({ where: { purpose: 'p' } });
    await db.userCredential.findUnique({ where: { id: 'r' } });
    expect(calls.map((call) => call.args)).toEqual([
      { where: { AND: [{ purpose: 'p' }, { userId: A }] } },
      { where: { id: 'r', AND: [{ userId: A }] } },
    ]);
  });

  it("update and delete: another user's row cannot match", async () => {
    const { db, calls } = scoped();
    await db.userCredential.update({ where: { id: 'r' }, data: { label: 'x' } });
    await db.userCredential.updateMany({ where: { userId: B }, data: { label: 'x' } });
    await db.userCredential.delete({ where: { id: 'r' } });
    await db.userCredential.deleteMany({});
    expect(calls.map((call) => [call.operation, call.args])).toEqual([
      ['update', { where: { id: 'r', AND: [{ userId: A }] }, data: { label: 'x' } }],
      ['updateMany', { where: { AND: [{ userId: B }, { userId: A }] }, data: { label: 'x' } }],
      ['delete', { where: { id: 'r', AND: [{ userId: A }] } }],
      ['deleteMany', { where: { AND: [{}, { userId: A }] } }],
    ]);
  });

  it('create: sets the owner, and refuses another owner before reaching the database', async () => {
    const { db, calls } = scoped();
    await db.storageObject.create({ data: { name: 'f' } });
    expect(() => db.storageObject.create({ data: { name: 'f', uploadedById: B } })).toThrow(ScopedAccessError);
    expect(calls).toEqual([{ model: 'StorageObject', operation: 'create', args: { data: { name: 'f', uploadedById: A } } }]);
  });

  it('upsert: scopes the where and the create, and guards the update', async () => {
    const { db, calls } = scoped();
    await db.notification.upsert({ where: { id: 'n' }, create: { eventKey: 'e' }, update: { readAt: null } });
    expect(calls[0]?.args).toEqual({
      where: { id: 'n', AND: [{ userId: A }] },
      create: { eventKey: 'e', userId: A },
      update: { readAt: null },
    });
    expect(() => db.notification.upsert({ where: { id: 'n' }, create: {}, update: { userId: B } })).toThrow(ScopedAccessError);
  });

  it('refuses unregistered and actor-only models, and raw SQL, without querying', () => {
    const { db, calls } = scoped();
    // #688 semantics, kept: an unregistered model is refused, never passed through.
    expect(() => db.role.findMany({})).toThrow('Role is not user-owned; use asSystem() with a reason.');
    expect(() => db.auditEvent.count({})).toThrow(ScopedAccessError);
    expect(() => db.$queryRaw(['SELECT 1'])).toThrow(/raw SQL is system-only/);
    expect(calls).toEqual([]);
  });

  it.each([{ userId: '' }, { userId: '  ' }, {} as { userId: string }])('refuses a scope without a user (%p)', (bad) => {
    const client = { $extends: jest.fn() };
    expect(() => forUser(client, bad, fixtureRegistry)).toThrow(ScopedAccessError);
    expect(client.$extends).not.toHaveBeenCalled();
  });

  it("accepts the PLATFORM_PRISMA port's PrismaClientLike", () => {
    const port = { $extends: jest.fn(() => 'extended') } as unknown as PrismaClientLike;
    const result: unknown = forUser(port, scope, fixtureRegistry);
    expect(result).toBe('extended');
  });

  it('defaults to the package registry', async () => {
    const { client, calls } = fakeClient();
    // Nothing is registered in a bare package process, so every model is refused.
    const db = forUser(client, scope) as Db;
    expect(() => db.userCredential.findMany({})).toThrow(ScopedAccessError);
    expect(calls).toEqual([]);
  });
});

describe('asSystem', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the client unchanged', () => {
    const client = { tag: 'unscoped' };
    expect(asSystem(client, { kind: 'system', reason: 'test' })).toBe(client);
  });

  it.each([{ kind: 'system', reason: '' }, { kind: 'system', reason: '  ' }, { kind: 'user', reason: 'x' }, { kind: 'system' }, undefined])(
    'refuses an actor without a reason (%p)',
    (actor) => {
      expect(() => asSystem({}, actor as never)).toThrow(ScopedAccessError);
    },
  );

  it('sets db.access.scope and db.access.reason on the active span', () => {
    const setAttributes = jest.fn();
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue({ setAttributes } as unknown as Span);
    asSystem({}, { kind: 'system', reason: 'retention.purge' });
    expect(setAttributes).toHaveBeenCalledWith({ 'db.access.scope': 'system', 'db.access.reason': 'retention.purge' });
  });

  it('does nothing when no span is active', () => {
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(() => asSystem({}, { kind: 'system', reason: 'test' })).not.toThrow();
  });
});
