import type { WorkerEnvKey } from './worker-env.js';

// Mutable worker-runtime registrations, in a module with NO runtime imports so
// `registries.ts` can reset them without pulling the worker environment (and
// the config module behind it) into every importer of the registries.

/** One alias that supplied a value. */
export interface AppliedWorkerEnvAlias {
  key: WorkerEnvKey;
  canonical: string;
  legacy: string;
}

/** A tuning step an app runs before the worker claims its first job. */
export interface RegisteredRuntimeHook {
  id: string;
  beforeFirstJob(context: never): void | Promise<void>;
}

export const DEFAULT_VALVE_EXIT_CODE = 71;

export const runtimeState = {
  valveExitCode: DEFAULT_VALVE_EXIT_CODE,
  valveDisabled: false,
  hooks: [] as RegisteredRuntimeHook[],
  aliases: new Map<WorkerEnvKey, string[]>(),
  warned: new Set<string>(),
  applied: [] as AppliedWorkerEnvAlias[],
};

/** Restores every default and empties every registration. Tests only. */
export function resetRuntimeStateForTests(): void {
  runtimeState.valveExitCode = DEFAULT_VALVE_EXIT_CODE;
  runtimeState.valveDisabled = false;
  runtimeState.hooks.length = 0;
  runtimeState.aliases.clear();
  runtimeState.warned.clear();
  runtimeState.applied = [];
}
