import { workerEnv, type WorkerEnvKey } from './worker-env.js';
import { disableMemoryValve } from './runtime-tuning.js';
import { runtimeState, type AppliedWorkerEnvAlias } from './runtime-state.js';

// =============================================================================
// Legacy names for worker environment variables  (issue #1072, epic #1070)
// =============================================================================
//
// A fleet that predates the platform engine sets its own variable names in
// compose files, systemd units and runbooks. Renaming them is a change to every
// one of those, and a variable nothing reads fails silently: the worker starts
// with defaults nobody asked for. So an app may name legacy variables per
// `WORKER_ENV` key; they are read only when the canonical one is unset, and a
// deprecation line is logged once per alias that is actually in use.
//
// RULES
//   - The canonical name wins whenever it is set (non-empty).
//   - The credential (`token`) and the re-exec latch (`heapTuned`) can never be
//     aliased: the first so a secret is never read from a second, unaudited
//     name, the second because it is not an operator knob.
//   - A value is copied verbatim, with two exceptions for the memory valve
//     fraction, whose legacy meaning differs from the canonical one: `0` turns
//     the VALVE off while sampling continues (the canonical variable would
//     clamp it to 0.5), and a value outside [0, 1] is ignored.
// =============================================================================

/** Keys that must never be aliased. */
const NOT_ALIASABLE: readonly WorkerEnvKey[] = ['token', 'heapTuned'];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const { aliases, warned } = runtimeState;

export type { AppliedWorkerEnvAlias };

/**
 * Lets `legacyName` supply the worker variable `key` when the canonical one is
 * unset. A deprecation line is logged once per alias at startup.
 *
 * @param key - A `WORKER_ENV` key, e.g. `heapLimitMb`.
 * @param legacyName - The old variable name, e.g. `APP_MAX_OLD_SPACE_MB`.
 * @throws Error when `key` is the credential or the re-exec latch, the name is
 *   not a valid variable name, or it equals the canonical name.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerWorkerEnvAlias('heapLimitMb', 'APP_MAX_OLD_SPACE_MB');
 * ```
 */
export function registerWorkerEnvAlias(key: WorkerEnvKey, legacyName: string): void {
  const canonical = workerEnv()[key];
  if (canonical === undefined) throw new Error(`"${String(key)}" is not a worker environment key.`);
  if (NOT_ALIASABLE.includes(key)) {
    throw new Error(`The worker environment key "${key}" cannot have an alias.`);
  }
  if (!ENV_NAME.test(legacyName)) throw new Error(`"${legacyName}" is not a valid environment variable name.`);
  if (legacyName === canonical) throw new Error(`"${legacyName}" is already the canonical name of "${key}".`);
  if (Object.values(workerEnv()).includes(legacyName)) {
    throw new Error(`"${legacyName}" is the canonical name of another worker variable.`);
  }

  const existing = aliases.get(key) ?? [];
  if (!existing.includes(legacyName)) aliases.set(key, [...existing, legacyName]);
}

/**
 * The registered aliases per key, for the generated variable table.
 *
 * @stability experimental
 */
export function listWorkerEnvAliases(): Partial<Record<WorkerEnvKey, readonly string[]>> {
  return Object.fromEntries([...aliases.entries()].map(([key, names]) => [key, [...names]]));
}

/** The aliases the last `applyWorkerEnvAliases` call actually used. */
export function appliedWorkerEnvAliases(): readonly AppliedWorkerEnvAlias[] {
  return runtimeState.applied;
}

/**
 * Copies each alias that is set into its canonical variable, when the canonical
 * one is unset, so every reader of `WORKER_ENV` sees the value. Idempotent.
 *
 * @param env - The environment to read and write; defaults to `process.env`.
 * @param warn - Receives one deprecation line per alias, the first time only.
 * @returns The aliases that supplied a value.
 */
export function applyWorkerEnvAliases(
  env: NodeJS.ProcessEnv = process.env,
  warn?: (message: string) => void,
): AppliedWorkerEnvAlias[] {
  const applied: AppliedWorkerEnvAlias[] = [];

  for (const [key, names] of aliases) {
    const canonical = workerEnv()[key];
    if (isSet(env[canonical])) continue;

    for (const legacy of names) {
      const raw = env[legacy];
      if (!isSet(raw)) continue;

      if (key === 'memoryThreshold') {
        // Legacy meaning: a fraction in [0, 1]; 0 = valve off, out of range = ignored.
        const fraction = Number(raw!.trim());
        if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
        if (fraction === 0) disableMemoryValve();
        else env[canonical] = raw!.trim();
      } else {
        env[canonical] = raw!;
      }

      applied.push({ key, canonical, legacy });
      const id = `${legacy}->${canonical}`;
      if (!warned.has(id)) {
        warned.add(id);
        warn?.(`${legacy} is deprecated; set ${canonical} instead. The legacy name is still honoured.`);
      }
      break;
    }
  }

  runtimeState.applied = applied;
  return applied;
}

/** Clears registered aliases and the once-only memory. Tests only. */
export function resetWorkerEnvAliasesForTests(): void {
  aliases.clear();
  warned.clear();
  runtimeState.applied = [];
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
