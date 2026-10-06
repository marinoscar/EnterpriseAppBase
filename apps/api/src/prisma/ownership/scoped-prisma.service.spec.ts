import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

import type { PrismaService } from '../prisma.service';
import { ScopedAccessError } from './scoped-access.error';
import { ScopedPrismaService, buildUserScopedClient, scopeQueryArgs } from './scoped-prisma.service';

// =============================================================================
// ScopedPrismaService: argument rewriting per operation (#688)
// =============================================================================
//
// Pure: every case asserts on the arguments the extension would hand to
// Prisma's `query`, using the real registry. The real-database proof that
// those arguments isolate users is test/prisma/scoped-access.db.spec.ts.
// =============================================================================

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const scope = { userId: A };

const rewrite = (model: string | undefined, operation: string, args: unknown) =>
  scopeQueryArgs({ model, operation, args }, scope);

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
        expect(err).toMatchObject({ model: 'AuditEvent', operation: 'count' });
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
      scopeQueryArgs({ model: 'Notification', operation: 'count', args: {} }, { userId: A, orgId: 'org', groupIds: ['g'] }),
    ).toEqual({ where: { AND: [{}, { userId: A }] } });
  });
});

describe('buildUserScopedClient', () => {
  it('extends the client with one query hook that runs scopeQueryArgs', async () => {
    let extension: any;
    const prisma = { $extends: jest.fn((ext) => ((extension = ext), 'extended')) };

    expect(buildUserScopedClient(prisma as any, scope)).toBe('extended');
    expect(extension.name).toBe('user-scope');

    const query = jest.fn(async (args) => args);
    await expect(
      extension.query.$allOperations({ model: 'Notification', operation: 'count', args: {}, query }),
    ).resolves.toEqual({ where: { AND: [{}, { userId: A }] } });
    expect(() => extension.query.$allOperations({ model: 'Role', operation: 'count', args: {}, query })).toThrow(
      ScopedAccessError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([{ userId: '' }, { userId: '  ' }, {} as { userId: string }])('refuses a scope without a user (%p)', (bad) => {
    const prisma = { $extends: jest.fn() };
    expect(() => buildUserScopedClient(prisma as any, bad)).toThrow(ScopedAccessError);
    expect(prisma.$extends).not.toHaveBeenCalled();
  });
});

describe('ScopedPrismaService', () => {
  const prisma = { $extends: jest.fn(() => 'extended') } as unknown as PrismaService;
  const service = new ScopedPrismaService(prisma);

  it('forUser and forScope build a scoped client', () => {
    expect(service.forUser(A)).toBe('extended');
    expect(service.forScope({ userId: A, orgId: 'ignored' })).toBe('extended');
  });

  it('asSystem returns the unscoped client', () => {
    expect(service.asSystem({ kind: 'system', reason: 'test' })).toBe(prisma);
  });

  it.each([{ kind: 'system', reason: '' }, { kind: 'user', reason: 'x' }, { kind: 'system' }])(
    'asSystem refuses an actor without a reason (%p)',
    (actor) => {
      expect(() => service.asSystem(actor as never)).toThrow(ScopedAccessError);
    },
  );

  describe('span attributes', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const contextManager = new AsyncLocalStorageContextManager();

    beforeAll(() => {
      context.setGlobalContextManager(contextManager.enable());
    });

    afterAll(() => {
      context.disable();
      contextManager.disable();
    });

    it('sets db.access.scope and db.access.reason on the active span', () => {
      const tracer = provider.getTracer('scoped-prisma.spec');
      tracer.startActiveSpan('work', (span) => {
        service.asSystem({ kind: 'system', reason: 'test' });
        span.end();
      });

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes).toMatchObject({ 'db.access.scope': 'system', 'db.access.reason': 'test' });
    });

    it('does nothing when no span is active', () => {
      expect(trace.getActiveSpan()).toBeUndefined();
      expect(() => service.asSystem({ kind: 'system', reason: 'test' })).not.toThrow();
    });
  });
});
