import { describe, expect, it, vi } from 'vitest';

import {
  HEAP_FRACTION_OF_RAM,
  MAX_HEAP_LIMIT_MB,
  MIN_HEAP_LIMIT_MB,
  effectiveCpuCount,
  effectiveMemoryBytes,
  maybeReexecWithHeapLimit,
  readCgroupCpuQuota,
  resolveDefaultConcurrency,
  resolveHeapLimitMb,
} from './runtime-tuning.js';
import { workerEnv } from './worker-env.js';

const GB = 1024 * 1024 * 1024;

describe('resolveHeapLimitMb (issue #277)', () => {
  it('is RAM-aware and clamped to a sane band', () => {
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: 16 * GB })).toBe(
      Math.round((16 * GB * HEAP_FRACTION_OF_RAM) / 1024 / 1024),
    );
    // A fixed limit is wrong on both a 2 GB VPS and a 64 GB box, so both ends
    // are clamped rather than trusted.
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: 512 * 1024 * 1024 })).toBe(MIN_HEAP_LIMIT_MB);
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: 256 * GB })).toBe(MAX_HEAP_LIMIT_MB);
  });

  it('honours an explicit override', () => {
    expect(resolveHeapLimitMb({ env: { [workerEnv().heapLimitMb]: '2048' }, totalMemoryBytes: 16 * GB })).toBe(2048);
  });

  it('treats 0 as "do not re-tune at all"', () => {
    // The escape hatch for a platform that manages memory itself.
    expect(resolveHeapLimitMb({ env: { [workerEnv().heapLimitMb]: '0' }, totalMemoryBytes: 16 * GB })).toBe(0);
  });

  it('refuses a non-numeric override by naming the variable', () => {
    expect(() => resolveHeapLimitMb({ env: { [workerEnv().heapLimitMb]: 'lots' } })).toThrow(
      new RegExp(workerEnv().heapLimitMb),
    );
  });
});

describe('resolveDefaultConcurrency', () => {
  it('uses cores and RAM rather than a flat 1', () => {
    // A flat 1 leaves a 16-core box almost entirely idle.
    expect(resolveDefaultConcurrency({ cpuCount: 16, totalMemoryBytes: 32 * GB })).toBe(15);
  });

  it('is bounded by memory, not only by cores', () => {
    // A 1 GB VPS with 8 cores must not try to run eight jobs.
    expect(resolveDefaultConcurrency({ cpuCount: 8, totalMemoryBytes: 1 * GB })).toBe(1);
  });

  it('never returns less than 1', () => {
    expect(resolveDefaultConcurrency({ cpuCount: 1, totalMemoryBytes: 256 * 1024 * 1024 })).toBe(1);
  });

  it('stays within the server’s own cap', () => {
    expect(resolveDefaultConcurrency({ cpuCount: 512, totalMemoryBytes: 1024 * GB })).toBe(64);
  });
});

describe('effectiveMemoryBytes', () => {
  it('is the cgroup limit when it is below host RAM', () => {
    expect(effectiveMemoryBytes({ totalMemoryBytes: 256 * GB, constrainedMemoryBytes: 30 * GB })).toBe(30 * GB);
  });

  it('falls back to host RAM when there is no usable limit', () => {
    // 0 is what an unconstrained cgroup reports.
    expect(effectiveMemoryBytes({ totalMemoryBytes: 16 * GB, constrainedMemoryBytes: 0 })).toBe(16 * GB);
    expect(effectiveMemoryBytes({ totalMemoryBytes: 16 * GB, constrainedMemoryBytes: Number.NaN })).toBe(16 * GB);
    expect(effectiveMemoryBytes({ totalMemoryBytes: 16 * GB, constrainedMemoryBytes: -1 })).toBe(16 * GB);
    // An "unlimited" cgroup v1 reports a value near 2^63; it is above host RAM.
    expect(effectiveMemoryBytes({ totalMemoryBytes: 16 * GB, constrainedMemoryBytes: 9_223_372_036_854_771_712 })).toBe(
      16 * GB,
    );
  });

  it('uses the limit alone when host RAM is unknown', () => {
    expect(effectiveMemoryBytes({ totalMemoryBytes: 0, constrainedMemoryBytes: 8 * GB })).toBe(8 * GB);
  });
});

describe('readCgroupCpuQuota', () => {
  const files = (map: Record<string, string>) => (path: string): string => {
    const value = map[path];
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  };

  it('reads a cgroup v2 cpu.max quota', () => {
    expect(readCgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': '800000 100000\n' }))).toBe(8);
  });

  it('keeps a fractional quota fractional', () => {
    expect(readCgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': '150000 100000\n' }))).toBe(1.5);
  });

  it('reports no quota for "max"', () => {
    expect(readCgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': 'max 100000\n' }))).toBeUndefined();
  });

  it('falls back to cgroup v1 when cpu.max is absent', () => {
    expect(
      readCgroupCpuQuota(
        files({ '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '400000\n', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000\n' }),
      ),
    ).toBe(4);
  });

  it('treats a v1 quota of -1 as no quota', () => {
    expect(
      readCgroupCpuQuota(
        files({ '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '-1\n', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000\n' }),
      ),
    ).toBeUndefined();
  });

  it('reports no quota when nothing is readable or the content is garbage', () => {
    expect(readCgroupCpuQuota(files({}))).toBeUndefined();
    expect(readCgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': 'lots of cpu\n' }))).toBeUndefined();
  });
});

describe('effectiveCpuCount', () => {
  it('is the CPU count when there is no quota', () => {
    expect(effectiveCpuCount({ cpuCount: 64, quota: undefined })).toBe(64);
  });

  it('is the quota, rounded up, when it is lower', () => {
    expect(effectiveCpuCount({ cpuCount: 64, quota: 8 })).toBe(8);
    expect(effectiveCpuCount({ cpuCount: 64, quota: 1.5 })).toBe(2);
  });

  it('never exceeds the CPU count and is at least 1', () => {
    expect(effectiveCpuCount({ cpuCount: 4, quota: 16 })).toBe(4);
    expect(effectiveCpuCount({ cpuCount: 4, quota: 0.25 })).toBe(1);
  });

  it('ignores a nonsensical quota', () => {
    expect(effectiveCpuCount({ cpuCount: 4, quota: 0 })).toBe(4);
    expect(effectiveCpuCount({ cpuCount: 4, quota: Number.NaN })).toBe(4);
  });
});

describe('several replicas on one large host', () => {
  // 64 cores and 256 GB, split into replicas limited to 8 cores and 30 GB each.
  const replica = {
    cpuCount: effectiveCpuCount({ cpuCount: 64, quota: 8 }),
    totalMemoryBytes: effectiveMemoryBytes({ totalMemoryBytes: 256 * GB, constrainedMemoryBytes: 30 * GB }),
  };

  it('sizes concurrency to the replica, not the host', () => {
    expect(replica.cpuCount).toBe(8);
    expect(resolveDefaultConcurrency(replica)).toBeLessThanOrEqual(7);
    // Sized to the host it would be capped only by the server (63 here).
    expect(resolveDefaultConcurrency({ cpuCount: 64, totalMemoryBytes: 256 * GB })).toBeGreaterThan(7);
  });

  it('derives the heap limit from the replica memory, not host RAM', () => {
    const heap = resolveHeapLimitMb({ env: {}, totalMemoryBytes: replica.totalMemoryBytes });
    // Half of 30 GB is above the ceiling, so the clamp is what applies here.
    expect(heap).toBe(MAX_HEAP_LIMIT_MB);

    // The derivation is only visible below the ceiling: a 12 GB replica gets a 6 GB heap, not the host's ceiling.
    const small = effectiveMemoryBytes({ totalMemoryBytes: 256 * GB, constrainedMemoryBytes: 12 * GB });
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: small })).toBe(
      Math.round((12 * GB * HEAP_FRACTION_OF_RAM) / 1024 / 1024),
    );
    expect(resolveHeapLimitMb({ env: {}, totalMemoryBytes: 256 * GB })).toBe(MAX_HEAP_LIMIT_MB);
  });
});

describe('maybeReexecWithHeapLimit', () => {
  const baseEnv = { [workerEnv().heapLimitMb]: '4096' };

  function fakeChild() {
    const handlers = new Map<string, (code: number | null, signal: string | null) => void>();
    return {
      kills: [] as string[],
      child: {
        kill(signal: string) {
          this.kills.push(signal);
          return true;
        },
        on(event: string, handler: (code: number | null, signal: string | null) => void) {
          handlers.set(event, handler);
          return this;
        },
        emitExit(code: number | null, signal: string | null) {
          handlers.get('exit')?.(code, signal);
        },
        kills: [] as string[],
      },
    };
  }

  it('is skipped under a test runner without any suite opting out', () => {
    // A re-exec here would spawn a second copy of the RUNNER, not of the worker.
    const spawnFn = vi.fn();
    const result = maybeReexecWithHeapLimit({ env: { ...baseEnv, VITEST: '1' }, spawnFn: spawnFn as never });
    expect(result.reexeced).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does nothing when re-tuning is disabled', () => {
    const spawnFn = vi.fn();
    const result = maybeReexecWithHeapLimit({
      env: { [workerEnv().heapLimitMb]: '0' },
      skip: false,
      spawnFn: spawnFn as never,
    });
    expect(result.reason).toBe('disabled');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not re-exec when the LATCH is set', () => {
    const spawnFn = vi.fn();
    const result = maybeReexecWithHeapLimit({
      env: { ...baseEnv, [workerEnv().heapTuned]: '1' },
      skip: false,
      currentLimitMb: 100,
      spawnFn: spawnFn as never,
    });
    expect(result.reason).toContain('latch');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not re-exec when the limit is ALREADY in force — the second guard', () => {
    // The latch alone is not enough: an operator can set it by hand or it can
    // leak from a parent shell. The actual-limit check alone is not enough
    // either: a platform that ignores the flag would re-exec forever.
    const spawnFn = vi.fn();
    const result = maybeReexecWithHeapLimit({
      env: baseEnv,
      skip: false,
      currentLimitMb: 4096,
      spawnFn: spawnFn as never,
    });
    expect(result.reason).toContain('limit in force');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawns a tuned child, setting the latch on it', () => {
    const { child } = fakeChild();
    let seen: { command: string; args: string[]; options: { env: NodeJS.ProcessEnv } } | undefined;

    const result = maybeReexecWithHeapLimit({
      env: baseEnv,
      skip: false,
      currentLimitMb: 100,
      argv: ['/app/cli.js', 'node', 'start'],
      execPath: '/usr/bin/node',
      spawnFn: ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        seen = { command, args, options };
        return child;
      }) as never,
    });

    expect(result.reexeced).toBe(true);
    expect(seen?.args[0]).toBe('--max-old-space-size=4096');
    expect(seen?.args.slice(1)).toEqual(['/app/cli.js', 'node', 'start']);
    expect(seen?.options.env[workerEnv().heapTuned]).toBe('1');
  });

  it('forwards SIGINT/SIGTERM/SIGHUP to the child', () => {
    const { child } = fakeChild();
    let handler: ((signal: NodeJS.Signals) => void) | undefined;

    maybeReexecWithHeapLimit({
      env: baseEnv,
      skip: false,
      currentLimitMb: 100,
      spawnFn: (() => child) as never,
      onSignal: (fn) => {
        handler = fn;
      },
      exit: () => {},
      raise: () => {},
    });

    // Without forwarding, a container SIGTERM kills the shim and ORPHANS the
    // worker: no drain, in-flight jobs abandoned.
    handler?.('SIGTERM');
    handler?.('SIGINT');
    handler?.('SIGHUP');
    expect(child.kills).toEqual(['SIGTERM', 'SIGINT', 'SIGHUP']);
  });

  it('re-raises the child’s signal rather than exiting 0', () => {
    const { child } = fakeChild();
    const raised: string[] = [];
    const exited: number[] = [];

    maybeReexecWithHeapLimit({
      env: baseEnv,
      skip: false,
      currentLimitMb: 100,
      spawnFn: (() => child) as never,
      onSignal: () => {},
      exit: (code) => exited.push(code),
      raise: (signal) => raised.push(signal),
    });

    child.emitExit(null, 'SIGKILL');
    // A supervisor reads the exit REASON: a shim that exits 0 after its child
    // was OOM-killed reports a clean shutdown, and the restart policy that
    // should have fired does not.
    expect(raised).toEqual(['SIGKILL']);
    expect(exited).toEqual([]);
  });

  it('passes an ordinary exit code straight through', () => {
    const { child } = fakeChild();
    const exited: number[] = [];

    maybeReexecWithHeapLimit({
      env: baseEnv,
      skip: false,
      currentLimitMb: 100,
      spawnFn: (() => child) as never,
      onSignal: () => {},
      exit: (code) => exited.push(code),
      raise: () => {},
    });

    child.emitExit(71, null);
    expect(exited).toEqual([71]);
  });
});
