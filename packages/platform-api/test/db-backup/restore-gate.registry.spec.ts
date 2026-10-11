// The restore gate registry and its kit (PP-14.12): the eight built-ins register
// through the same function an app uses, in their historical order whatever the
// import order; app gates validate, evaluate fail-closed and are bounded; the
// kit passes a good gate and fails each way a gate can misbehave.
import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import {
  RESTORE_GATE_TIMEOUT_MS,
  evaluateRestoreGate,
  evaluateRestoreGates,
  registerRestoreGate,
  restoreGateRegistry,
  type RestoreGateDefinition,
} from '../../src/db-backup/restore-gate.registry';
import { BUILTIN_RESTORE_GATES } from '../../src/db-backup/restore-gates.builtin';
import {
  buildRestoreGateContext,
  describeRestoreGateConformance,
} from '../../src/db-backup/testing/restore-gate-conformance';
import { BUILTIN_RESTORE_GATE_IDS } from '@marinoscar/platform-contract/db-backup';
import { runKit } from './support/kit-runner';

const gate = (id: string, check: RestoreGateDefinition['check'], extra: Partial<RestoreGateDefinition> = {}): RestoreGateDefinition => ({
  id,
  label: `Gate ${id}`,
  check,
  ...extra,
});

describe('the restore gate registry', () => {
  it('holds the eight built-ins, registered through registerRestoreGate, in their historical order', () => {
    expect(restoreGateRegistry.ids()).toEqual([...BUILTIN_RESTORE_GATE_IDS]);
    expect(BUILTIN_RESTORE_GATES.map((entry) => entry.id)).toEqual([...BUILTIN_RESTORE_GATE_IDS]);
    expect(BUILTIN_RESTORE_GATES.map((entry) => entry.kind)).toEqual([
      'capability',
      'capability',
      'capability',
      'capability',
      'capability',
      'disk',
      'replicas',
      'overridable',
    ]);
  });

  it('lists an app gate after the built-ins even when it registered first', async () => {
    await withTemporaryEntries(restoreGateRegistry, [gate('zz-app', async () => ({ status: 'pass', message: 'ok' }))], () => {
      expect(restoreGateRegistry.ids()).toEqual([...BUILTIN_RESTORE_GATE_IDS, 'zz-app']);
    });
  });

  it('keeps app gates in registration order', async () => {
    await withTemporaryEntries(
      restoreGateRegistry,
      [gate('b-gate', async () => ({ status: 'pass', message: 'b' })), gate('a-gate', async () => ({ status: 'pass', message: 'a' }))],
      () => {
        expect(restoreGateRegistry.ids().slice(-2)).toEqual(['b-gate', 'a-gate']);
      }
    );
  });

  it('refuses a duplicate id, including a built-in one', async () => {
    await withTemporaryEntries(restoreGateRegistry, [gate('dup-gate', async () => ({ status: 'pass', message: 'ok' }))], () => {
      expect(() => registerRestoreGate(gate('dup-gate', async () => ({ status: 'pass', message: 'ok' })))).toThrow(RegistryError);
      expect(() => registerRestoreGate(gate('rls_bypass', async () => ({ status: 'pass', message: 'ok' })))).toThrow(RegistryError);
    });
  });

  it.each([
    ['an id with a capital letter', gate('Bad-Id', async () => ({ status: 'pass', message: 'ok' }))],
    ['an id starting with a digit', gate('9lives', async () => ({ status: 'pass', message: 'ok' }))],
    ['an empty label', gate('ok-id', async () => ({ status: 'pass', message: 'ok' }), { label: ' ' })],
    ['no check function', { id: 'no-check', label: 'No check' } as never],
    ['an unknown kind', gate('odd-kind', async () => ({ status: 'pass', message: 'ok' }), { kind: 'sideways' as never })],
  ])('refuses %s', async (_label, entry) => {
    await withTemporaryEntries(restoreGateRegistry, [], () => {
      expect(() => registerRestoreGate(entry as RestoreGateDefinition)).toThrow(RegistryError);
    });
  });

  it('is frozen after bootstrap', async () => {
    await withTemporaryEntries(restoreGateRegistry, [], () => {
      restoreGateRegistry.freeze();
      expect(() => registerRestoreGate(gate('too-late', async () => ({ status: 'pass', message: 'ok' })))).toThrow(RegistryError);
    });
  });
});

describe('evaluating a gate', () => {
  const ctx = buildRestoreGateContext();

  it('maps pass, warn and fail to the pre-flight verdicts, carrying the label, kind and action', async () => {
    const pass = await evaluateRestoreGate(gate('g1', async () => ({ status: 'pass', message: 'fine' })), ctx);
    const warn = await evaluateRestoreGate(gate('g2', async () => ({ status: 'warn', message: 'hmm', action: 'Check.' })), ctx);
    const fail = await evaluateRestoreGate(gate('g3', async () => ({ status: 'fail', message: 'no' }), { kind: 'capability' }), ctx);

    expect(pass).toEqual({ id: 'g1', kind: 'app', verdict: 'pass', title: 'Gate g1', detail: 'fine', action: null });
    expect(warn).toMatchObject({ verdict: 'warning', action: 'Check.' });
    expect(fail).toMatchObject({ verdict: 'block', kind: 'capability' });
  });

  it('fails closed on a throw, on a malformed answer and on a gate that does not answer in time', async () => {
    const thrown = await evaluateRestoreGate(
      gate('boom', async () => {
        throw new Error('network down');
      }),
      ctx
    );
    const malformed = await evaluateRestoreGate(gate('odd', async () => ({ status: 'pass' }) as never), ctx);
    const hanging = await evaluateRestoreGate(gate('slow', () => new Promise(() => undefined)), ctx, 20);

    expect(thrown).toMatchObject({ verdict: 'block', title: 'Gate boom' });
    expect(thrown.detail).toContain('network down');
    expect(malformed.verdict).toBe('block');
    expect(hanging.verdict).toBe('block');
    expect(hanging.detail).toContain('did not answer within 20 ms');
    expect(RESTORE_GATE_TIMEOUT_MS).toBe(10_000);
  });

  it('turns a synchronous throw into a block too', async () => {
    const row = await evaluateRestoreGate(
      gate('sync', (() => {
        throw new Error('sync boom');
      }) as never),
      ctx
    );

    expect(row.verdict).toBe('block');
  });

  it('evaluates every registered gate once, in order', async () => {
    const calls: string[] = [];
    await withTemporaryEntries(
      restoreGateRegistry,
      [
        gate('first-app', async () => {
          calls.push('first-app');
          return { status: 'pass', message: 'ok' };
        }),
        gate('second-app', async () => {
          calls.push('second-app');
          return { status: 'pass', message: 'ok' };
        }),
      ],
      async () => {
        const rows = await evaluateRestoreGates(ctx);

        expect(rows.map((row) => row.id)).toEqual([...BUILTIN_RESTORE_GATE_IDS, 'first-app', 'second-app']);
        expect(calls).toEqual(['first-app', 'second-app']);
      }
    );
  });

  it('the built-ins pass on a healthy cluster', async () => {
    const rows = await evaluateRestoreGates(ctx);

    expect(rows.map((row) => row.verdict)).toEqual(Array(8).fill('pass'));
  });
});

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

const quiescedGate: RestoreGateDefinition = gate(
  'cdn-quiesced',
  async (ctx) => {
    const cdn = await ctx.settings.get('cdn');
    if (cdn === undefined) return { status: 'pass', message: 'Not configured: nothing to check.' };
    return cdn.quiesced === true
      ? { status: 'pass', message: 'The CDN is quiesced.' }
      : { status: 'fail', message: 'Quiesce the CDN first.', action: 'Pause the CDN, then retry.' };
  },
  { label: 'CDN quiesced' }
);

describe('describeRestoreGateConformance on a good gate', () => {
  describeRestoreGateConformance(quiescedGate, {
    describe,
    it,
    expect,
    scenarios: [
      { name: 'quiesced', settings: { cdn: { quiesced: true } }, expectStatus: 'pass' },
      { name: 'not quiesced', settings: { cdn: { quiesced: false } }, expectStatus: 'fail' },
      { name: 'not configured', settings: {}, expectStatus: 'pass' },
    ],
  });
});

describe('describeRestoreGateConformance on the built-in gates', () => {
  const builtin = (id: string): RestoreGateDefinition => BUILTIN_RESTORE_GATES.find((entry) => entry.id === id) as RestoreGateDefinition;

  describeRestoreGateConformance(builtin('replicas'), {
    describe,
    it,
    expect,
    scenarios: [
      { name: 'one client', expectStatus: 'pass' },
      {
        name: 'several clients',
        context: {
          facts: { ...buildRestoreGateContext().facts, cluster: { ...buildRestoreGateContext().facts.cluster, distinctClientAddresses: 3 } },
        },
        expectStatus: 'warn',
      },
    ],
  });

  describeRestoreGateConformance(builtin('schema_compatibility'), {
    describe,
    it,
    expect,
    scenarios: [
      { name: 'match', expectStatus: 'pass' },
      {
        name: 'archive older',
        context: { facts: { ...buildRestoreGateContext().facts, migrationComparison: 'archive_older' } },
        expectStatus: 'fail',
      },
      {
        name: 'archive older, overridden',
        context: { overrideSchemaMismatch: true, facts: { ...buildRestoreGateContext().facts, migrationComparison: 'archive_older' } },
        expectStatus: 'warn',
      },
    ],
  });
});

describe('the kit fails a gate that breaks its rules', () => {
  const run = (target: RestoreGateDefinition, watch?: Array<{ name: string; calls(): number }>, expectStatus?: 'pass') =>
    runKit(
      (harness) =>
        describeRestoreGateConformance(target, {
          ...harness,
          scenarios: [{ name: 'case', settings: {}, ...(expectStatus ? { expectStatus } : {}) }],
          ...(watch ? { watch } : {}),
        }),
      expect
    );

  it('a gate that writes to its context fails the read-only case', async () => {
    const writes = gate('writes-ctx', async (ctx) => {
      (ctx.facts.cluster as unknown as { reachable: boolean }).reachable = false;
      return { status: 'pass', message: 'ok' };
    });

    const result = await run(writes);

    expect(result.failed().some((name) => name.includes('[read-only]'))).toBe(true);
    expect(result.passed().some((name) => name.includes('[answers]'))).toBe(true);
  });

  it('a gate with a watched side effect fails the read-only case', async () => {
    let posts = 0;
    const mutating = gate('posts', async () => {
      posts += 1;
      return { status: 'pass', message: 'ok' };
    });

    const result = await run(mutating, [{ name: 'POST /pause', calls: () => posts }]);

    expect(result.failed().some((name) => name.includes('[read-only]'))).toBe(true);
  });

  it('a gate whose answer changes between asks fails the repeatable case', async () => {
    let asked = 0;
    const flaky = gate('flaky', async () => ({ status: 'pass', message: `ask ${(asked += 1)}` }));

    const result = await run(flaky);

    expect(result.failed().some((name) => name.includes('[repeatable]'))).toBe(true);
  });

  it('a gate that answers the wrong shape, or the wrong status, fails the answers case', async () => {
    const empty = await run(gate('empty-message', async () => ({ status: 'pass', message: '  ' })));
    const wrong = await run(gate('wrong-status', async () => ({ status: 'fail', message: 'no' })), undefined, 'pass');

    expect(empty.failed().some((name) => name.includes('[answers]'))).toBe(true);
    expect(wrong.failed().some((name) => name.includes('[answers]'))).toBe(true);
  });

  it('a gate with a bad definition fails the definition case', async () => {
    const result = await run(gate('Bad Id', async () => ({ status: 'pass', message: 'ok' })));

    expect(result.failed().some((name) => name.includes('[definition]'))).toBe(true);
  });
});
