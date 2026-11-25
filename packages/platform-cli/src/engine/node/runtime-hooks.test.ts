import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkerRuntimeHookError,
  listWorkerRuntimeHooks,
  memoryValveExitCode,
  registerWorkerRuntimeHook,
  resetRuntimeTuningForTests,
  resolveHeapLimitMb,
  resolveNativeThreads,
  runWorkerRuntimeHooks,
  setMemoryValveExitCode,
} from './runtime-tuning.js';
import { renderUnit } from './service.js';
import {
  appliedWorkerEnvAliases,
  applyWorkerEnvAliases,
  listWorkerEnvAliases,
  registerWorkerEnvAlias,
  resetWorkerEnvAliasesForTests,
} from './worker-env-aliases.js';
import { memoryValveDisabled } from './runtime-tuning.js';
import { buildWorkerEnvTable } from './worker-env-table.js';
import { workerEnv } from './worker-env.js';
import { envVar } from '../identity.js';

const GB = 1024 * 1024 * 1024;
const context = { concurrency: 2, cores: 8, nativeThreads: 4, env: {} };

afterEach(() => {
  resetRuntimeTuningForTests();
  resetWorkerEnvAliasesForTests();
});

describe('worker runtime hooks (issue #1072)', () => {
  it('runs every hook in order with the context, awaiting each', async () => {
    const order: string[] = [];
    registerWorkerRuntimeHook({
      id: 'a',
      beforeFirstJob: async (ctx) => {
        await Promise.resolve();
        order.push(`a:${ctx.nativeThreads}:${ctx.concurrency}`);
      },
    });
    registerWorkerRuntimeHook({ id: 'b', beforeFirstJob: () => void order.push('b') });

    await runWorkerRuntimeHooks(context);
    expect(order).toEqual(['a:4:2', 'b']);
  });

  it('rejects an empty or duplicate id', () => {
    expect(() => registerWorkerRuntimeHook({ id: ' ', beforeFirstJob: () => {} })).toThrow(/id/);
    registerWorkerRuntimeHook({ id: 'x', beforeFirstJob: () => {} });
    expect(() => registerWorkerRuntimeHook({ id: 'x', beforeFirstJob: () => {} })).toThrow(/already registered/);
    expect(listWorkerRuntimeHooks().map((hook) => hook.id)).toEqual(['x']);
  });

  it('fails fast with a named error and runs nothing after the failing hook', async () => {
    const after = vi.fn();
    registerWorkerRuntimeHook({
      id: 'boom',
      beforeFirstJob: () => {
        throw new Error('no libvips');
      },
    });
    registerWorkerRuntimeHook({ id: 'later', beforeFirstJob: after });

    const failure = await runWorkerRuntimeHooks(context).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkerRuntimeHookError);
    expect((failure as WorkerRuntimeHookError).hookId).toBe('boom');
    expect((failure as Error).message).toMatch(/"boom".*no libvips/);
    expect(after).not.toHaveBeenCalled();
  });
});

describe('resolveNativeThreads', () => {
  it('defaults to half the cores between 1 and 4', () => {
    expect(resolveNativeThreads(1, {})).toBe(1);
    expect(resolveNativeThreads(2, {})).toBe(1);
    expect(resolveNativeThreads(6, {})).toBe(3);
    expect(resolveNativeThreads(64, {})).toBe(4);
  });

  it('honours an explicit positive whole number verbatim, ignores junk', () => {
    expect(resolveNativeThreads(8, { [workerEnv().nativeThreads]: '6' })).toBe(6);
    expect(resolveNativeThreads(8, { [workerEnv().nativeThreads]: '0' })).toBe(4);
    expect(resolveNativeThreads(8, { [workerEnv().nativeThreads]: 'many' })).toBe(4);
  });
});

describe('the memory valve exit code', () => {
  it('defaults to 71 and accepts 64-113', () => {
    expect(memoryValveExitCode()).toBe(71);
    setMemoryValveExitCode(75);
    expect(memoryValveExitCode()).toBe(75);
  });

  it.each([0, 1, 2, 63, 114, 75.5, Number.NaN])('rejects %s', (code) => {
    expect(() => setMemoryValveExitCode(code)).toThrow(RangeError);
  });

  it('is written into the generated systemd unit', () => {
    expect(renderUnit()).toContain('RestartForceExitStatus=71');
    setMemoryValveExitCode(75);
    const unit = renderUnit();
    expect(unit).toContain('RestartForceExitStatus=75');
    expect(unit).toContain('Restart=on-failure');
  });
});

describe('an explicit heap limit', () => {
  it('is not clamped to the default ceiling, only floored', () => {
    const key = workerEnv().heapLimitMb;
    expect(resolveHeapLimitMb({ env: { [key]: '12000' }, totalMemoryBytes: 16 * GB })).toBe(12000);
    expect(resolveHeapLimitMb({ env: { [key]: '100' }, totalMemoryBytes: 16 * GB })).toBe(512);
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: 256 * GB })).toBe(8192);
  });
});

describe('worker env aliases', () => {
  it('reads a legacy name when the canonical one is unset, and warns once', () => {
    registerWorkerEnvAlias('heapLimitMb', 'APP_MAX_OLD_SPACE_MB');
    const warn = vi.fn();
    const env: NodeJS.ProcessEnv = { APP_MAX_OLD_SPACE_MB: '3072' };

    const applied = applyWorkerEnvAliases(env, warn);
    expect(env[workerEnv().heapLimitMb]).toBe('3072');
    expect(resolveHeapLimitMb({ env })).toBe(3072);
    expect(applied).toEqual([{ key: 'heapLimitMb', canonical: workerEnv().heapLimitMb, legacy: 'APP_MAX_OLD_SPACE_MB' }]);
    expect(appliedWorkerEnvAliases()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);

    applyWorkerEnvAliases({ APP_MAX_OLD_SPACE_MB: '3072' }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('lets the canonical name win', () => {
    registerWorkerEnvAlias('heapLimitMb', 'APP_MAX_OLD_SPACE_MB');
    const warn = vi.fn();
    const env: NodeJS.ProcessEnv = { APP_MAX_OLD_SPACE_MB: '3072', [workerEnv().heapLimitMb]: '2048' };
    applyWorkerEnvAliases(env, warn);
    expect(env[workerEnv().heapLimitMb]).toBe('2048');
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats an empty canonical value as unset', () => {
    registerWorkerEnvAlias('nativeThreads', 'APP_SHARP_CONCURRENCY');
    const env: NodeJS.ProcessEnv = { APP_SHARP_CONCURRENCY: '2', [workerEnv().nativeThreads]: '' };
    applyWorkerEnvAliases(env);
    expect(resolveNativeThreads(16, env)).toBe(2);
  });

  it('maps a legacy fraction of 0 to valve-off, not to a 0.5 threshold', () => {
    registerWorkerEnvAlias('memoryThreshold', 'APP_HEAP_RESTART_FRACTION');
    const env: NodeJS.ProcessEnv = { APP_HEAP_RESTART_FRACTION: '0' };
    applyWorkerEnvAliases(env);
    expect(memoryValveDisabled()).toBe(true);
    expect(env[workerEnv().memoryThreshold]).toBeUndefined();
  });

  it('passes a legacy fraction in range through and ignores one out of range', () => {
    registerWorkerEnvAlias('memoryThreshold', 'APP_HEAP_RESTART_FRACTION');
    const ok: NodeJS.ProcessEnv = { APP_HEAP_RESTART_FRACTION: '0.8' };
    applyWorkerEnvAliases(ok);
    expect(ok[workerEnv().memoryThreshold]).toBe('0.8');
    expect(memoryValveDisabled()).toBe(false);

    const bad: NodeJS.ProcessEnv = { APP_HEAP_RESTART_FRACTION: '7' };
    applyWorkerEnvAliases(bad);
    expect(bad[workerEnv().memoryThreshold]).toBeUndefined();
  });

  it('supports a URL alias for the server URL', () => {
    registerWorkerEnvAlias('serverUrl', envVar('URL'));
    const env: NodeJS.ProcessEnv = { [envVar('URL')]: 'https://api.example.test' };
    applyWorkerEnvAliases(env);
    expect(env[workerEnv().serverUrl]).toBe('https://api.example.test');
  });

  it('never aliases the credential or the re-exec latch', () => {
    expect(() => registerWorkerEnvAlias('token', 'APP_TOKEN')).toThrow(/cannot have an alias/);
    expect(() => registerWorkerEnvAlias('heapTuned', 'APP_TUNED')).toThrow(/cannot have an alias/);
  });

  it('rejects bad names and canonical collisions', () => {
    expect(() => registerWorkerEnvAlias('nodeName', 'not valid')).toThrow(/valid environment variable/);
    expect(() => registerWorkerEnvAlias('nodeName', workerEnv().nodeName)).toThrow(/already the canonical/);
    expect(() => registerWorkerEnvAlias('nodeName', workerEnv().nodeId)).toThrow(/another worker variable/);
  });

  it('shows aliases in the generated table, and changes nothing without any', () => {
    const plain = buildWorkerEnvTable();
    registerWorkerEnvAlias('heapLimitMb', 'APP_MAX_OLD_SPACE_MB');
    expect(listWorkerEnvAliases()).toEqual({ heapLimitMb: ['APP_MAX_OLD_SPACE_MB'] });
    const table = buildWorkerEnvTable();
    expect(table).toContain('Legacy names still read: `APP_MAX_OLD_SPACE_MB`.');
    resetWorkerEnvAliasesForTests();
    expect(buildWorkerEnvTable()).toBe(plain);
  });
});

describe('the platform stays free of native image libraries', () => {
  it('imports sharp nowhere under src', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && !entry.endsWith('runtime-hooks.test.ts')) {
          // Comments (TSDoc examples) may show the import; code may not.
          const code = readFileSync(path, 'utf8')
            .split('\n')
            .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
            .join('\n');
          if (/from\s+['"]sharp['"]|import\(\s*['"]sharp['"]|require\(\s*['"]sharp['"]/.test(code)) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
