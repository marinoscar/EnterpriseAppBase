import { spawn, type ChildProcess } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

import { envFlagOn } from './env-flags.js';
import { MAX_NODE_CONCURRENCY, MIN_NODE_CONCURRENCY } from './node-config.js';
import { DEFAULT_VALVE_EXIT_CODE, resetRuntimeStateForTests, runtimeState } from './runtime-state.js';
import { workerEnv } from './worker-env.js';

// =============================================================================
// Runtime tuning  (issue #277, epic #254)
// =============================================================================
//
// Node's default old-space limit is derived from a general-purpose heuristic,
// and it is low for a machine whose entire job is being a worker: a box with
// 32 GB of RAM can OOM at a fraction of it, while the operator watches `free`
// and sees nothing wrong. So a worker re-execs itself once with an explicit,
// RAM-aware `--max-old-space-size`.
//
// -----------------------------------------------------------------------------
// THE RE-EXEC MAKES THIS PROCESS A SIGNAL-FORWARDING SHIM, AND THAT IS THE
// PART WITH A TRAP IN IT
// -----------------------------------------------------------------------------
//
// After spawning the child, the parent is still PID 1 in a container and still
// the process systemd is supervising. If it does not forward signals, a
// container SIGTERM kills the shim and ORPHANS the worker — no drain, in-flight
// jobs abandoned, leases left to expire.
//
// And when the child dies FROM A SIGNAL, the shim must die of the SAME signal
// rather than exiting 0. A supervisor reads the exit reason: a shim that exits
// cleanly after its child was OOM-killed reports a clean shutdown, and the
// restart policy that should have fired does not.
//
// -----------------------------------------------------------------------------
// IT CAN NEVER LOOP
// -----------------------------------------------------------------------------
//
// Two independent guards, because either alone has a failure mode:
//
//   - an ENV LATCH on the child — but an operator could set it by hand, or it
//     could leak from a parent shell
//   - a check of the heap limit ACTUALLY IN FORCE — but a platform that
//     ignores the flag would then re-exec forever
//
// Requiring both means a spawn happens at most once per process tree.
// =============================================================================

/** Floor for the tuned heap. Below this, re-tuning is not worth a re-exec. */
export const MIN_HEAP_LIMIT_MB = 512;

/**
 * Ceiling for the RAM-DERIVED default. An explicit setting is not clamped to
 * it: an operator who asks for 12000 gets 12000 (floor only).
 */
export const MAX_HEAP_LIMIT_MB = 8_192;

/** Fraction of total RAM to hand to the old space by default. */
export const HEAP_FRACTION_OF_RAM = 0.5;

/** The DEFAULT exit code a supervisor sees when the pre-OOM valve fires. */
export const EXIT_MEMORY_VALVE = DEFAULT_VALVE_EXIT_CODE;

/**
 * Chooses the exit code of the memory valve, for fleets whose supervisors or
 * alerting key on a specific number (for example 75, `EX_TEMPFAIL`). Used by
 * the valve and by the generated systemd unit.
 *
 * @param code - A whole number from 64 to 113.
 * @throws RangeError when it is outside that range (0, 1 and 2 would be
 *   indistinguishable from success, a crash and a usage error).
 * @stability experimental
 * @extensionPoint option
 */
export function setMemoryValveExitCode(code: number): void {
  if (!Number.isInteger(code) || code < 64 || code > 113) {
    throw new RangeError(`The memory valve exit code must be a whole number from 64 to 113 (got ${String(code)}).`);
  }
  runtimeState.valveExitCode = code;
}

/**
 * The exit code the memory valve uses: 71 unless an app chose another.
 *
 * @stability experimental
 */
export function memoryValveExitCode(): number {
  return runtimeState.valveExitCode;
}

/**
 * Turns the valve off while the watchdog keeps sampling (vitals and the trend
 * continue). Set when a legacy fraction variable is `0`.
 */
export function disableMemoryValve(): void {
  runtimeState.valveDisabled = true;
}

/** True when the valve was turned off by `disableMemoryValve`. */
export function memoryValveDisabled(): boolean {
  return runtimeState.valveDisabled;
}

/** Restores the valve defaults and drops hooks and aliases. Tests only. */
export function resetRuntimeTuningForTests(): void {
  resetRuntimeStateForTests();
}

export interface HeapLimitOptions {
  env?: NodeJS.ProcessEnv | undefined;
  totalMemoryBytes?: number | undefined;
}

/**
 * How large the old space should be, in MB.
 *
 * `0` from the environment DISABLES re-tuning entirely — the escape hatch for a
 * platform that manages memory itself (a cgroup with a hard limit, a PaaS that
 * sets `NODE_OPTIONS`), where a second opinion is worse than none.
 */
export function resolveHeapLimitMb(options?: HeapLimitOptions): number {
  const env = options?.env ?? process.env;
  const raw = env[workerEnv().heapLimitMb]?.trim();

  if (raw !== undefined && raw.length > 0) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${workerEnv().heapLimitMb} must be a whole number of megabytes, or 0 to disable.`);
    }
    if (value === 0) return 0;
    // Floor only: an explicit value above the default ceiling is honoured.
    return Math.max(value, MIN_HEAP_LIMIT_MB);
  }

  const total = options?.totalMemoryBytes ?? safeTotalMem();
  if (total <= 0) return 0;
  return clamp(Math.round((total * HEAP_FRACTION_OF_RAM) / 1024 / 1024), MIN_HEAP_LIMIT_MB, MAX_HEAP_LIMIT_MB);
}

/** The old-space ceiling actually in force right now, in MB. */
export function currentHeapLimitMb(): number {
  try {
    return Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);
  } catch {
    return 0;
  }
}

/**
 * Default concurrency, core- and RAM-aware.
 *
 * A flat `1` leaves a 16-core box almost entirely idle, and asking every
 * operator to discover the flag is how a fleet ends up running at a fraction
 * of what it was provisioned for. Bounded by RAM as well as cores because the
 * limiting resource for a worker is usually memory per slot, not CPU.
 */
export function resolveDefaultConcurrency(options?: { cpuCount?: number | undefined; totalMemoryBytes?: number | undefined }): number {
  const cores = options?.cpuCount ?? safeCpuCount();
  const totalMb = Math.round((options?.totalMemoryBytes ?? safeTotalMem()) / 1024 / 1024);

  // One slot per core, minus one for everything else on the box; and one slot
  // per gigabyte, so a 1 GB VPS with 8 cores does not run eight jobs.
  const byCores = Math.max(1, cores - 1);
  const byMemory = Math.max(1, Math.floor(totalMb / 1024));

  return clamp(Math.min(byCores, byMemory), MIN_NODE_CONCURRENCY, MAX_NODE_CONCURRENCY);
}

// -----------------------------------------------------------------------------
// Runtime hooks and the native-thread cap  (issue #1072)
// -----------------------------------------------------------------------------
//
// Native libraries (libvips behind `sharp`, ONNX runtimes) size their own
// thread pools from the core count, so every concurrent job grows RSS where
// the heap watchdog cannot see it. The platform does not depend on any of
// them; an app registers a hook that configures the one it uses, and the
// platform runs it once, after the heap re-exec and before the first claim.
// -----------------------------------------------------------------------------

/**
 * What a runtime hook is told about the worker it is tuning.
 *
 * @stability experimental
 */
export interface WorkerRuntimeContext {
  /** Jobs this process runs at once. */
  concurrency: number;
  /** Logical cores. */
  cores: number;
  /** The native-thread cap to apply (`resolveNativeThreads`). */
  nativeThreads: number;
  /** The environment the worker started with. */
  env: NodeJS.ProcessEnv;
}

/**
 * A tuning step an app runs before the worker claims its first job.
 *
 * @stability experimental
 */
export interface WorkerRuntimeHook {
  /** Unique id, named in the error when the hook throws. */
  id: string;
  /** Runs once, awaited, before the worker can claim a job. */
  beforeFirstJob(context: WorkerRuntimeContext): void | Promise<void>;
}

/**
 * A hook failed, so the worker did not start (never half-tuned).
 *
 * @stability experimental
 */
export class WorkerRuntimeHookError extends Error {
  constructor(
    /** The id of the hook that failed. */
    readonly hookId: string,
    cause: unknown,
  ) {
    super(`Worker runtime hook "${hookId}" failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'WorkerRuntimeHookError';
  }
}

const hooks = runtimeState.hooks as unknown as WorkerRuntimeHook[];

/**
 * Registers a step to run once per worker start, after the heap re-exec and
 * before the claim loop, in daemon and foreground mode alike. A hook that
 * throws aborts startup with a `WorkerRuntimeHookError`.
 *
 * @param hook - The hook; its `id` must be unique.
 * @throws Error when `id` is empty or already registered.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerWorkerRuntimeHook({
 *   id: 'sharp',
 *   beforeFirstJob: async ({ nativeThreads }) => {
 *     const sharp = (await import('sharp')).default;
 *     sharp.cache(false);
 *     sharp.concurrency(nativeThreads);
 *   },
 * });
 * ```
 */
export function registerWorkerRuntimeHook(hook: WorkerRuntimeHook): void {
  if (typeof hook?.id !== 'string' || hook.id.trim() === '') throw new Error('A worker runtime hook needs a non-empty id.');
  if (typeof hook.beforeFirstJob !== 'function') throw new Error(`Worker runtime hook "${hook.id}" needs beforeFirstJob().`);
  if (hooks.some((existing) => existing.id === hook.id)) throw new Error(`Worker runtime hook "${hook.id}" is already registered.`);
  hooks.push(hook);
}

/**
 * The registered hooks, in registration order.
 *
 * @stability experimental
 */
export function listWorkerRuntimeHooks(): readonly WorkerRuntimeHook[] {
  return Object.freeze([...hooks]);
}

/**
 * The native-thread cap: `<PREFIX>NATIVE_THREADS` when it is a positive whole
 * number, else half the cores between 1 and 4.
 *
 * @stability experimental
 */
export function resolveNativeThreads(cores: number = safeCpuCount(), env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[workerEnv().nativeThreads]?.trim();
  if (raw !== undefined && raw.length > 0) {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return Math.min(Math.max(Math.floor(cores / 2), 1), 4);
}

/**
 * Runs every registered hook, in order, awaiting each.
 *
 * @throws WorkerRuntimeHookError on the first hook that throws or rejects.
 */
export async function runWorkerRuntimeHooks(context: WorkerRuntimeContext): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.beforeFirstJob(context);
    } catch (error) {
      throw new WorkerRuntimeHookError(hook.id, error);
    }
  }
}

export interface ReexecOptions {
  env?: NodeJS.ProcessEnv | undefined;
  argv?: string[] | undefined;
  execPath?: string | undefined;
  execArgv?: string[] | undefined;
  spawnFn?: typeof spawn | undefined;
  /** Test seam for the shim's own termination. */
  exit?: ((code: number) => void) | undefined;
  raise?: ((signal: NodeJS.Signals) => void) | undefined;
  onSignal?: ((handler: (signal: NodeJS.Signals) => void) => void) | undefined;
  currentLimitMb?: number | undefined;
  /** Skips the whole mechanism. Defaults to detecting a test runner. */
  skip?: boolean | undefined;
}

export interface ReexecResult {
  /** True when this process became a shim and a child was spawned. */
  reexeced: boolean;
  reason: string;
  heapLimitMb: number;
  child?: ChildProcess | undefined;
}

/**
 * Called as THE FIRST THING in `node start`, before config load.
 *
 * Before config load specifically: the re-exec replaces the process, so any
 * work done first is work done twice — and a config error reported twice, from
 * two processes, is a confusing first experience.
 */
export function maybeReexecWithHeapLimit(options?: ReexecOptions): ReexecResult {
  const env = options?.env ?? process.env;

  // Under a test runner a re-exec would spawn a second copy of the RUNNER, not
  // of the worker. Detected rather than configured, so no suite has to
  // remember to opt out.
  const skip = options?.skip ?? isTestRunner(env);
  if (skip) return { reexeced: false, reason: 'skipped (test runner)', heapLimitMb: 0 };

  let heapLimitMb: number;
  try {
    heapLimitMb = resolveHeapLimitMb({ env });
  } catch {
    // A malformed value must not stop a worker starting; it simply does not
    // get tuned, and `doctor` is where a human finds out.
    return { reexeced: false, reason: 'invalid heap limit', heapLimitMb: 0 };
  }

  if (heapLimitMb === 0) return { reexeced: false, reason: 'disabled', heapLimitMb: 0 };

  // GUARD 1: the latch.
  if (envFlagOn(env[workerEnv().heapTuned])) {
    return { reexeced: false, reason: 'already tuned (latch)', heapLimitMb };
  }

  // GUARD 2: the limit actually in force. Within 10% counts as tuned — V8
  // rounds, and re-execing to change 4096 into 4095 would be absurd.
  const current = options?.currentLimitMb ?? currentHeapLimitMb();
  if (current > 0 && current >= heapLimitMb * 0.9) {
    return { reexeced: false, reason: 'already tuned (limit in force)', heapLimitMb };
  }

  const spawnImpl = options?.spawnFn ?? spawn;
  const child = spawnImpl(
    options?.execPath ?? process.execPath,
    [`--max-old-space-size=${heapLimitMb}`, ...(options?.execArgv ?? []), ...(options?.argv ?? process.argv.slice(1))],
    {
      stdio: 'inherit',
      env: { ...env, [workerEnv().heapTuned]: '1' },
    },
  );

  const exit = options?.exit ?? ((code: number) => process.exit(code));
  const raise =
    options?.raise ??
    ((signal: NodeJS.Signals) => {
      // Re-raise with the default handler restored, so this process dies OF
      // the signal rather than exiting 0. `process.exit(128 + n)` looks
      // equivalent and is not: a supervisor reading `WIFSIGNALED` sees a clean
      // exit, and the restart policy that should have fired does not.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });

  const forward = options?.onSignal ?? ((handler) => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => handler(signal));
  });

  forward((signal) => {
    try {
      child.kill(signal);
    } catch {
      // The child is already gone; its `exit` handler below settles the shim.
    }
  });

  child.on('exit', (code, signal) => {
    if (signal !== null && signal !== undefined) {
      raise(signal);
      return;
    }
    exit(code ?? 0);
  });

  return { reexeced: true, reason: 'spawned tuned child', heapLimitMb, child };
}

/** Vitest and Jest both set these; neither should ever spawn a worker child. */
function isTestRunner(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST !== undefined || env.JEST_WORKER_ID !== undefined || env.NODE_ENV === 'test';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeTotalMem(): number {
  try {
    return totalmem();
  } catch {
    return 0;
  }
}

function safeCpuCount(): number {
  try {
    return cpus().length;
  } catch {
    return 1;
  }
}
