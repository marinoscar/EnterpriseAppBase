import { describe, expect, it } from 'vitest';

import {
  assertSeedIdempotent,
  PLATFORM_SEED_STEP_IDS,
  readSeedStepResult,
  seedPlatform,
  SeedStepError,
  type PlatformSeedInput,
  type SeedStep,
} from '../../src/seed/index.js';
import { createFakePrisma } from './fake-prisma.js';

const INPUT: PlatformSeedInput = {
  roles: [{ name: 'admin', description: 'Admin role' }],
  permissions: [{ name: 'a:read', description: 'Read a' }],
  roleGrants: { admin: ['a:read'] },
  systemSettingsDefaults: {},
};

/** A step that upserts into its own in-memory table and counts what it really created. */
function tableStep(id: string, table: Map<string, string>, keys: string[]): SeedStep {
  return {
    id,
    async run() {
      let created = 0;
      let updated = 0;
      for (const key of keys) {
        if (table.has(key)) {
          updated += 1;
        } else {
          created += 1;
          table.set(key, key);
        }
      }
      return { created, updated };
    },
  };
}

describe('seedPlatform extras', () => {
  it('runs the steps after the platform half, in order, under one log, and reports them', async () => {
    const { prisma } = createFakePrisma();
    const log: string[] = [];
    const order: string[] = [];
    const first: SeedStep = {
      id: 'coach.defaults',
      async run(_tx, ctx) {
        order.push('first');
        ctx.log.info('  writing the coach defaults');
        expect(ctx.platform.defaultOrganizationCreated).toBe(true);
        expect(ctx.input).toBe(INPUT);
        return { created: 2, updated: 1 };
      },
    };
    const second: SeedStep = { id: 'coach.catalog', run: async () => (order.push('second'), { created: 0, updated: 0 }) };

    const summary = await seedPlatform(prisma, INPUT, { log: { info: (m) => void log.push(m) }, extras: [first, second] });

    expect(order).toEqual(['first', 'second']);
    expect(summary.extras).toEqual([
      { id: 'coach.defaults', created: 2, updated: 1 },
      { id: 'coach.catalog', created: 0, updated: 0 },
    ]);
    const tail = log.slice(log.indexOf('✓ Created default organization "default"') + 1);
    expect(tail).toEqual([
      'Seeding coach.defaults...',
      '  writing the coach defaults',
      '✓ coach.defaults: 2 created, 1 updated',
      'Seeding coach.catalog...',
      '✓ coach.catalog: 0 created, 0 updated',
    ]);
  });

  it('keeps the previous signature: a bare logger works, and no extras means no extras key', async () => {
    const { prisma } = createFakePrisma();
    const log: string[] = [];
    const summary = await seedPlatform(prisma, INPUT, { info: (m) => void log.push(m) });
    expect(log[0]).toBe('Seeding roles...');
    expect(summary).not.toHaveProperty('extras');
    expect(await seedPlatform(prisma, INPUT)).not.toHaveProperty('extras');
    expect(await seedPlatform(prisma, INPUT, { extras: [] })).not.toHaveProperty('extras');
  });

  it('writes nothing when a step is invalid: bad id, platform id, duplicate id, missing run', async () => {
    const ok: SeedStep = { id: 'coach.ok', run: async () => ({ created: 0, updated: 0 }) };
    for (const [extras, message] of [
      [[{ id: 'Coach Defaults', run: ok.run }], /lower-case words/],
      [[{ id: 'roles', run: ok.run }], /platform seed steps/],
      [[ok, ok], /share this id/],
      [[{ id: 'coach.nope' } as unknown as SeedStep], /run must be a function/],
    ] as const) {
      const { prisma, calls } = createFakePrisma();
      await expect(seedPlatform(prisma, INPUT, { extras })).rejects.toThrow(message);
      expect(calls).toEqual([]);
    }
    expect(PLATFORM_SEED_STEP_IDS).toContain('default-organization');
  });

  it('runs each step in a transaction when the client has one, and passes the transaction client', async () => {
    const { prisma } = createFakePrisma();
    const opened: string[] = [];
    const tx = { marker: 'tx' };
    const withTx = Object.assign(Object.create(prisma), {
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
        opened.push('open');
        const result = await fn(tx);
        opened.push('close');
        return result;
      },
    }) as typeof prisma;
    const seen: unknown[] = [];
    const step: SeedStep<{ marker: string }> = { id: 'coach.tx', run: async (t) => (seen.push(t), { created: 1, updated: 0 }) };
    await seedPlatform(withTx, INPUT, { extras: [step] });
    expect(seen).toEqual([tx]);
    expect(opened).toEqual(['open', 'close']);
  });

  it('names the failing step and keeps the cause', async () => {
    const { prisma } = createFakePrisma();
    const boom = new Error('unique violation');
    const step: SeedStep = { id: 'coach.boom', run: async () => Promise.reject(boom) };
    const error = await seedPlatform(prisma, INPUT, { extras: [step] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeedStepError);
    expect((error as SeedStepError).stepId).toBe('coach.boom');
    expect((error as SeedStepError).message).toBe('seed step "coach.boom": unique violation');
    expect((error as SeedStepError).cause).toBe(boom);
  });

  it('refuses a malformed result', () => {
    expect(() => readSeedStepResult('s', undefined)).toThrow(/created=undefined/);
    expect(() => readSeedStepResult('s', { created: -1, updated: 0 })).toThrow(/created=-1/);
    expect(() => readSeedStepResult('s', { created: 1, updated: 0.5 })).toThrow(/updated=0.5/);
    expect(readSeedStepResult('s', { created: 1, updated: 2 })).toEqual({ created: 1, updated: 2 });
  });
});

describe('assertSeedIdempotent', () => {
  it('passes an upserting step and returns both summaries', async () => {
    const { prisma } = createFakePrisma();
    const table = new Map<string, string>();
    const { first, second } = await assertSeedIdempotent(() =>
      seedPlatform(prisma, INPUT, { extras: [tableStep('coach.rows', table, ['a', 'b'])] }),
    );
    expect(first.extras).toEqual([{ id: 'coach.rows', created: 2, updated: 0 }]);
    expect(second.extras).toEqual([{ id: 'coach.rows', created: 0, updated: 2 }]);
  });

  it('fails a step that creates a row every run, naming it', async () => {
    const { prisma } = createFakePrisma();
    let counter = 0;
    const leaky: SeedStep = { id: 'coach.leaky', run: async () => ({ created: ++counter && 1, updated: 0 }) };
    await expect(assertSeedIdempotent(() => seedPlatform(prisma, INPUT, { extras: [leaky] }))).rejects.toThrow(
      /not idempotent[\s\S]*coach\.leaky: created 1 row\(s\) on the second run/,
    );
  });

  it('holds the platform half to the same contract', async () => {
    const { prisma } = createFakePrisma();
    const { first, second } = await assertSeedIdempotent(() => seedPlatform(prisma, INPUT));
    expect(first.defaultOrganizationCreated).toBe(true);
    expect(second.defaultOrganizationCreated).toBe(false);
  });
});
