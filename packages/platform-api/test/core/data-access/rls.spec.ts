import { trace, type Span } from '@opentelemetry/api';

import {
  RLS_SETTINGS,
  SYSTEM_ACCESS_REASONS,
  ScopedAccessError,
  forOrg,
  forScope,
  forSystem,
  orgScopeExtension,
  runAsSystem,
  runInOrg,
  runInScope,
  systemScopeExtension,
} from '../../../src/core';

// =============================================================================
// Organisation scoping and the bypass shapes (ADR 0002 D5, issue #725)
// =============================================================================
//
// No database: a fake client records the statements it is asked to run and the
// batches it opens. The real-database proof that these shapes isolate
// organisations (a non-superuser role, FORCE ROW LEVEL SECURITY, two orgs,
// concurrent transactions on one pool) is the reference app's
// apps/api/test/tenancy/rls-isolation.db.spec.ts.
// =============================================================================

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

interface Statement {
  sql: string;
  values: unknown[];
}

interface Recorder {
  /** Every batch `$transaction([...])` received, as the statements in it. */
  batches: Array<Array<Statement | { query: unknown[] }>>;
  /** Every interactive `$transaction(fn, options)` received. */
  interactive: Array<{ options: unknown }>;
  /** Statements run directly on a transaction client (set_config of runInOrg). */
  onTransaction: Statement[];
}

function statement(strings: TemplateStringsArray, values: unknown[]): Statement {
  return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values };
}

function fakeClient(rec: Recorder, extendWith?: { transaction?: unknown }) {
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      rec.onTransaction.push(statement(strings, values));
      return Promise.resolve(1);
    },
    marker: 'tx',
  };
  const client: Record<string, unknown> = {
    $connect: () => undefined,
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => statement(strings, values),
    $transaction: async (arg: unknown, options?: unknown) => {
      if (typeof arg === 'function') {
        rec.interactive.push({ options });
        return (arg as (t: unknown) => Promise<unknown>)(tx);
      }
      rec.batches.push(arg as Statement[]);
      return (arg as unknown[]).map((_, i) => (i === 0 ? 1 : 'result'));
    },
    $extends(extension: unknown): unknown {
      // `Prisma.defineExtension(obj)` is a function of the client, as in Prisma itself.
      if (typeof extension === 'function') return (extension as (c: unknown) => unknown)(client);
      const hook = (extension as { query: { $allOperations: (p: Record<string, unknown>) => Promise<unknown> } }).query.$allOperations;
      return {
        item: {
          findMany: (args: unknown) =>
            hook({
              model: 'Item',
              operation: 'findMany',
              args,
              query: (a: unknown) => ({ query: [a] }),
              __internalParams: { transaction: extendWith?.transaction },
            }),
        },
      };
    },
  };
  return { client, tx };
}

const newRecorder = (): Recorder => ({ batches: [], interactive: [], onTransaction: [] });

describe('forOrg', () => {
  it('runs every operation as a batch whose FIRST statement sets the org transaction-locally', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    const scoped = forOrg(client as never, ORG_A, { userId: USER }) as unknown as { item: { findMany(a: unknown): Promise<unknown> } };

    const result = await scoped.item.findMany({ where: { id: 1 } });

    expect(result).toBe('result');
    expect(rec.batches).toHaveLength(1);
    const [setScope, operation] = rec.batches[0] as [Statement, { query: unknown[] }];
    expect(setScope.sql).toBe("SELECT set_config('app.org_id', ?, true), set_config('app.user_id', ?, true)");
    expect(setScope.values).toEqual([ORG_A, USER]);
    expect(operation).toEqual({ query: [{ where: { id: 1 } }] });
  });

  it('sets an empty user id when there is none', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    const scoped = forOrg(client as never, ORG_A) as unknown as { item: { findMany(a: unknown): Promise<unknown> } };

    await scoped.item.findMany({});

    expect((rec.batches[0]![0] as Statement).values).toEqual([ORG_A, '']);
  });

  it('never uses a session-level setting', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    const scoped = forOrg(client as never, ORG_A) as unknown as { item: { findMany(a: unknown): Promise<unknown> } };
    await scoped.item.findMany({});

    for (const batch of rec.batches) {
      for (const item of batch) {
        if ('sql' in item) expect(item.sql).toMatch(/, true\)/);
        if ('sql' in item) expect(item.sql).not.toMatch(/, false\)/);
      }
    }
  });

  it.each([
    ['an empty org', ''],
    ['a non-UUID org', 'org-1'],
    ['an injection attempt', "x'; DROP TABLE users; --"],
    ['an undefined org', undefined],
  ])('refuses %s', (_label, orgId) => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    expect(() => forOrg(client as never, orgId as never)).toThrow(ScopedAccessError);
  });

  it('refuses a user id that is not a UUID', () => {
    const { client } = fakeClient(newRecorder());
    expect(() => forOrg(client as never, ORG_A, { userId: 'bob' })).toThrow(/scope\.userId must be a UUID/);
  });

  it('refuses to run inside an interactive transaction (its operations would escape it)', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec, { transaction: { kind: 'itx' } });
    const scoped = forOrg(client as never, ORG_A) as unknown as { item: { findMany(a: unknown): Promise<unknown> } };

    await expect(scoped.item.findMany({})).rejects.toThrow(/escape the transaction/);
    expect(rec.batches).toHaveLength(0);
  });

  it('orgScopeExtension is a named extension', () => {
    const { client } = fakeClient(newRecorder());
    expect(orgScopeExtension(client as never, { orgId: ORG_A })).toBeDefined();
  });
});

describe('forScope', () => {
  it('needs scope.orgId (fail closed)', () => {
    const { client } = fakeClient(newRecorder());
    expect(() => forScope(client as never, { userId: USER })).toThrow(/needs scope\.orgId/);
  });

  it('scopes to the org and the user', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    const scoped = forScope(client as never, { userId: USER, orgId: ORG_B }) as unknown as { item: { findMany(a: unknown): Promise<unknown> } };
    await scoped.item.findMany({});
    expect((rec.batches[0]![0] as Statement).values).toEqual([ORG_B, USER]);
  });
});

describe('runInOrg', () => {
  it('opens one interactive transaction, sets the scope first and hands out the plain tx', async () => {
    const rec = newRecorder();
    const { client, tx } = fakeClient(rec);

    const out = await runInOrg(client as never, { orgId: ORG_A, userId: USER }, async (handed) => {
      expect(handed).toBe(tx);
      expect(rec.onTransaction).toHaveLength(1);
      return 'done';
    });

    expect(out).toBe('done');
    expect(rec.interactive).toHaveLength(1);
    expect(rec.onTransaction[0]!.sql).toBe("SELECT set_config('app.org_id', ?, true), set_config('app.user_id', ?, true)");
    expect(rec.onTransaction[0]!.values).toEqual([ORG_A, USER]);
  });

  it('forwards maxWait and timeout', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    await runInOrg(client as never, { orgId: ORG_A }, async () => 1, { maxWait: 1234, timeout: 5678 });
    expect(rec.interactive[0]!.options).toEqual({ maxWait: 1234, timeout: 5678 });
  });

  it('lets an error from fn out (Prisma rolls the transaction back)', async () => {
    const { client } = fakeClient(newRecorder());
    await expect(runInOrg(client as never, { orgId: ORG_A }, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('reuses the outer transaction when nested in the same scope: the setting is issued once', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);

    await runInOrg(client as never, { orgId: ORG_A, userId: USER }, async (tx) => {
      await runInOrg(tx as never, { orgId: ORG_A, userId: USER }, async (inner) => {
        expect(inner).toBe(tx);
      });
    });

    expect(rec.interactive).toHaveLength(1);
    expect(rec.onTransaction).toHaveLength(1);
  });

  it('refuses to nest another organisation inside a scoped transaction', async () => {
    const { client } = fakeClient(newRecorder());
    await expect(
      runInOrg(client as never, { orgId: ORG_A }, (tx) => runInOrg(tx as never, { orgId: ORG_B }, async () => 1)),
    ).rejects.toThrow(/nested inside a transaction scoped to another organisation/);
  });

  it('refuses a malformed org before opening a transaction', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    await expect(runInOrg(client as never, { orgId: 'nope' }, async () => 1)).rejects.toThrow(ScopedAccessError);
    expect(rec.interactive).toHaveLength(0);
  });
});

describe('runInScope', () => {
  it('needs scope.orgId', async () => {
    const { client } = fakeClient(newRecorder());
    await expect(runInScope(client as never, { userId: USER }, async () => 1)).rejects.toThrow(/needs scope\.orgId/);
  });

  it('scopes to the org and the user', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    await runInScope(client as never, { userId: USER, orgId: ORG_A }, async () => 1);
    expect(rec.onTransaction[0]!.values).toEqual([ORG_A, USER]);
  });
});

describe('the system (bypass) shapes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('forSystem batches a transaction-local bypass flag before every operation', async () => {
    const rec = newRecorder();
    const { client } = fakeClient(rec);
    const system = forSystem(client as never, 'retention') as unknown as { item: { findMany(a: unknown): Promise<unknown> } };

    await system.item.findMany({});

    const [setBypass] = rec.batches[0] as [Statement];
    expect(setBypass.sql).toBe("SELECT set_config('app.rls_bypass', 'on', true)");
  });

  it('runAsSystem sets the flag first inside one interactive transaction', async () => {
    const rec = newRecorder();
    const { client, tx } = fakeClient(rec);

    await runAsSystem(client as never, 'doctor', async (handed) => {
      expect(handed).toBe(tx);
    });

    expect(rec.onTransaction[0]!.sql).toBe("SELECT set_config('app.rls_bypass', 'on', true)");
  });

  it('accepts exactly the documented reasons and refuses anything else', async () => {
    expect([...SYSTEM_ACCESS_REASONS].sort()).toEqual(
      ['admin-aggregate', 'backup', 'doctor', 'link-resolution', 'migration-tooling', 'purge', 'restore', 'retention', 'export'].sort(),
    );
    const { client } = fakeClient(newRecorder());
    for (const reason of SYSTEM_ACCESS_REASONS) expect(() => forSystem(client as never, reason)).not.toThrow();
    expect(() => forSystem(client as never, 'because' as never)).toThrow(ScopedAccessError);
    expect(() => systemScopeExtension(client as never, '' as never)).toThrow(ScopedAccessError);
    await expect(runAsSystem(client as never, undefined as never, async () => 1)).rejects.toThrow(ScopedAccessError);
  });

  it('records the reason on the active span as an attribute and an event', async () => {
    const setAttributes = jest.fn();
    const addEvent = jest.fn();
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue({ setAttributes, addEvent } as unknown as Span);
    const { client } = fakeClient(newRecorder());

    await runAsSystem(client as never, 'purge', async () => 1);

    expect(setAttributes).toHaveBeenCalledWith({ 'db.access.scope': 'system', 'db.access.reason': 'purge' });
    expect(addEvent).toHaveBeenCalledWith('db.rls_bypass', { 'db.access.reason': 'purge' });
  });
});

describe('RLS_SETTINGS', () => {
  it('names the three transaction-local settings of the policy contract', () => {
    expect(RLS_SETTINGS).toEqual({ orgId: 'app.org_id', userId: 'app.user_id', bypass: 'app.rls_bypass' });
    expect(Object.isFrozen(RLS_SETTINGS)).toBe(true);
  });
});
