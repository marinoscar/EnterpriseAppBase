import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

import { ScopedAccessError } from '@marinoscar/platform-api/core';
import { PrismaService } from '../prisma.service';
import { ScopedPrismaService } from './scoped-prisma.service';

// =============================================================================
// ScopedPrismaService and PrismaService.forUser: the app binding (#688, #699)
// =============================================================================
//
// The per-operation rewriting is the package's and is proven there
// (packages/platform-api/test/core/data-access/scoped-client.spec.ts). This
// file proves the app's binding: both entry points extend the app's client
// with the package extension, read the app's own inventory (filled by the
// manifest these files import), and asSystem keeps its checks, log and span.
// The real-database proof is test/prisma/scoped-access.db.spec.ts.
// =============================================================================

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

type Hook = (params: { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => unknown;

/**
 * A client with `$extends` only, as Prisma implements it: a `defineExtension`
 * function is called with the client; an object extension is returned so the
 * test can run its hook.
 */
function fakeClient() {
  const client = {
    $extends: jest.fn((extension: unknown): unknown =>
      typeof extension === 'function' ? (extension as (c: unknown) => unknown)(client) : extension,
    ),
  };
  return client;
}

/** Runs one call through the extension a fake client was given; resolves to the args sent to Prisma. */
function runHook(extended: unknown, model: string | undefined, operation: string, args: unknown): unknown {
  const ext = extended as { name: string; query: { $allOperations: Hook } };
  return ext.query.$allOperations({ model, operation, args, query: async (sent) => sent });
}

describe('PrismaService.forUser (the typed helper)', () => {
  it("extends the client with the package's user-scope extension, reading the app's inventory", async () => {
    const client = fakeClient();
    const extended = PrismaService.prototype.forUser.call(client as unknown as PrismaService, { userId: A });

    expect((extended as unknown as { name: string }).name).toBe('user-scope');
    await expect(runHook(extended, 'StorageObject', 'findMany', {})).resolves.toEqual({ where: { AND: [{}, { uploadedById: A }] } });
    await expect(runHook(extended, 'WorkerNode', 'count', {})).resolves.toEqual({ where: { AND: [{}, { createdById: A }] } });
    expect(() => runHook(extended, 'AuditEvent', 'findMany', {})).toThrow(
      new ScopedAccessError('AuditEvent is not user-owned; use asSystem() with a reason.'),
    );
    expect(() => runHook(extended, 'UserCredential', 'create', { data: { userId: B } })).toThrow(ScopedAccessError);
  });

  it.each([{ userId: '' }, { userId: '  ' }, {} as { userId: string }])('refuses a scope without a user (%p)', (bad) => {
    const client = fakeClient();
    expect(() => PrismaService.prototype.forUser.call(client as unknown as PrismaService, bad)).toThrow(ScopedAccessError);
    expect(client.$extends).not.toHaveBeenCalled();
  });
});

describe('ScopedPrismaService', () => {
  const client = fakeClient();
  const prisma = client as unknown as PrismaService;
  const service = new ScopedPrismaService(prisma);

  it('forUser and forScope build a scoped client', async () => {
    await expect(runHook(service.forUser(A), 'Notification', 'count', {})).resolves.toEqual({ where: { AND: [{}, { userId: A }] } });
    await expect(runHook(service.forScope({ userId: A, orgId: 'ignored' }), 'UserCredential', 'findMany', {})).resolves.toEqual({
      where: { AND: [{}, { userId: A }] },
    });
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
