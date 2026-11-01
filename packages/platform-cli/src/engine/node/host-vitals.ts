import { readFileSync } from 'node:fs';
import * as os from 'node:os';

import type { NodeHostVitals } from './node-api.js';
import { MAX_VITALS_MEMORY_BYTES, MAX_VITALS_UPTIME_SECONDS, clampInt, clampNumber } from './node-vitals.js';

// =============================================================================
// Host (machine-level) vitals  (issue #1045)
// =============================================================================
//
// What the MACHINE is doing, as opposed to the node process (`node-vitals.ts`).
// Carried in `vitals.host` of the heartbeat, and only to a server that
// advertised `node_host_vitals` at registration. Same rules as the process
// vitals: best-effort, never throws, and every number is clamped to the
// contract's bounds because one out-of-range value 400s the whole heartbeat.
// =============================================================================

/** Mirrors the contract's `loadAvg*` ceiling. */
export const MAX_HOST_LOAD_AVG = 10_000;
/** Mirrors the contract's `cpuCount` ceiling. */
export const MAX_HOST_CPU_COUNT = 4096;
/** Mirrors the contract's `osRelease` length. */
export const MAX_HOST_OS_RELEASE_LENGTH = 128;
/** Mirrors the contract's `arch` length. */
export const MAX_HOST_ARCH_LENGTH = 32;

/** The cumulative CPU times of one logical CPU, as `os.cpus()[i].times`. */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** The machine readings. Every one is injectable, so tests need no real host. */
export interface HostVitalsSources {
  cpus(): Array<{ times: CpuTimes }>;
  loadavg(): number[];
  totalmem(): number;
  freemem(): number;
  release(): string;
  arch(): string;
  uptime(): number;
  platform(): string;
  /** The text of `/proc/meminfo`, or `undefined` when there is none. */
  readMeminfo(): string | undefined;
}

/**
 * Reads machine-level vitals.
 *
 * @stability experimental
 */
export interface HostVitalsSampler {
  /** One snapshot. NEVER THROWS; the first call has no `cpuPercent` (it needs two samples). */
  sample(): NodeHostVitals;
}

/** `MemAvailable` of a `/proc/meminfo` text, in bytes; `undefined` when absent. */
export function parseMemAvailable(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s*kB\s*$/m.exec(meminfo);
  if (match === null) return undefined;
  const kib = Number(match[1]);
  return Number.isFinite(kib) ? kib * 1024 : undefined;
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function realSources(): HostVitalsSources {
  return {
    cpus: () => os.cpus(),
    loadavg: () => os.loadavg(),
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    release: () => os.release(),
    arch: () => os.arch(),
    uptime: () => os.uptime(),
    platform: () => process.platform,
    readMeminfo: () => (process.platform === 'linux' ? readFileSync('/proc/meminfo', 'utf8') : undefined),
  };
}

function sumTimes(cpus: Array<{ times: CpuTimes }>): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const { times } of cpus) {
    const all = times.user + times.nice + times.sys + times.idle + times.irq;
    total += all;
    busy += all - times.idle;
  }
  return { busy, total };
}

/**
 * Build a host vitals sampler.
 *
 * @param sources - test seam; missing members are not filled in, pass a full set.
 * @stability experimental
 */
export function createHostVitalsSampler(sources?: HostVitalsSources): HostVitalsSampler {
  const src = sources ?? realSources();
  let last: { busy: number; total: number } | undefined;

  const cpuPercent = (): number | undefined => {
    const current = sumTimes(src.cpus());
    const previous = last;
    last = current;
    if (previous === undefined) return undefined;
    const total = current.total - previous.total;
    if (!(total > 0)) return undefined;
    return Math.min(100, Math.max(0, ((current.busy - previous.busy) / total) * 100));
  };

  return {
    sample(): NodeHostVitals {
      const out: NodeHostVitals = {};
      const set = <K extends keyof NodeHostVitals>(key: K, value: NodeHostVitals[K] | undefined): void => {
        if (value !== undefined) out[key] = value;
      };

      const cpus = attempt(() => src.cpus());
      set('cpuPercent', attempt(cpuPercent));
      if (cpus !== undefined && cpus.length > 0) set('cpuCount', clampInt(cpus.length, MAX_HOST_CPU_COUNT));

      // `os.loadavg()` is all zeros on Windows: omit rather than lie.
      if (attempt(() => src.platform()) !== 'win32') {
        const load = attempt(() => src.loadavg());
        set('loadAvg1', clampNumber(load?.[0], MAX_HOST_LOAD_AVG));
        set('loadAvg5', clampNumber(load?.[1], MAX_HOST_LOAD_AVG));
        set('loadAvg15', clampNumber(load?.[2], MAX_HOST_LOAD_AVG));
      }

      const total = attempt(() => src.totalmem());
      const free = attempt(() => src.freemem());
      set('memTotalBytes', clampInt(total, MAX_VITALS_MEMORY_BYTES));
      set('memFreeBytes', clampInt(free, MAX_VITALS_MEMORY_BYTES));
      const meminfo = attempt(() => src.readMeminfo());
      const available = (meminfo !== undefined ? parseMemAvailable(meminfo) : undefined) ?? free;
      set('memAvailableBytes', clampInt(available, MAX_VITALS_MEMORY_BYTES));

      const release = attempt(() => src.release());
      if (typeof release === 'string' && release.length > 0) out.osRelease = release.slice(0, MAX_HOST_OS_RELEASE_LENGTH);
      const arch = attempt(() => src.arch());
      if (typeof arch === 'string' && arch.length > 0) out.arch = arch.slice(0, MAX_HOST_ARCH_LENGTH);
      set('uptimeSeconds', clampNumber(attempt(() => src.uptime()), MAX_VITALS_UPTIME_SECONDS));
      return out;
    },
  };
}
