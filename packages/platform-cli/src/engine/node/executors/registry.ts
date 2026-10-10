import { defaultExecutors } from './example-checksum.js';
import { ExecutorRegistry, type JobExecutor } from './index.js';

// =============================================================================
// The app's node executors  (PP-8.9, #715)
// =============================================================================
//
// `defaultExecutors()` is what the platform ships (`example.checksum`,
// `db.backup.run`). An app that adds a node-eligible job type registers its
// executor here instead of editing that list; the engine's default registry
// is the built-ins plus every registered one. A type the platform already
// runs cannot be registered again: two executors for one type would make
// which one runs depend on registration order.
//
// The server's half of a node-eligible type (`nodeResultSchema` +
// `persistNodeResult`) is a separate registration in the API; neither knows
// about the other (executors/README.md). CLAUDE.md queue rule 3 holds for an
// app executor exactly as for `db.backup.run`: a job-scoped credential comes
// from `context.api.jobSecret(...)`, lives in memory for the job, and is
// never written or logged. `checkExecutorCredentialHygiene` in `/testing` is
// the check an app runs over its own.
// =============================================================================

const registered: JobExecutor[] = [];
let frozenBy: string | undefined;

/** The job types the platform's own executors run. */
export function builtinExecutorTypes(): string[] {
  return defaultExecutors().map((executor) => executor.type);
}

/**
 * Adds a node executor for an app's job type. The worker engine then
 * advertises and claims that type like a built-in one.
 *
 * @param executor - The executor; its `type` must be new.
 * @throws Error when `type` is empty, a built-in type or already registered,
 *   or when `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerNodeExecutor(new EchoExecutor());
 * ```
 */
export function registerNodeExecutor(executor: JobExecutor): void {
  const type = executor?.type;
  if (frozenBy !== undefined) {
    throw new Error(`Node executor "${String(type)}" was registered after ${frozenBy}; register it before (or pass it to createCli).`);
  }
  if (typeof type !== 'string' || type.trim() === '') {
    throw new Error('A node executor needs a non-empty job type.');
  }
  if (typeof executor.execute !== 'function' || typeof executor.requiresInput !== 'boolean') {
    throw new Error(`Node executor "${type}" needs execute() and a boolean requiresInput.`);
  }
  if (builtinExecutorTypes().includes(type)) {
    throw new Error(`Node executor "${type}" duplicates a built-in executor; a job type has exactly one executor.`);
  }
  if (registered.some((existing) => existing.type === type)) {
    throw new Error(`Node executor "${type}" is already registered.`);
  }
  registered.push(executor);
}

/**
 * The app executors registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listRegisteredNodeExecutors(): readonly JobExecutor[] {
  return Object.freeze([...registered]);
}

/**
 * The registry the worker engine uses by default: the built-in executors and
 * every registered one.
 *
 * @returns A fresh registry (one per engine, so tests never share state).
 * @stability experimental
 */
export function defaultExecutorRegistry(): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  for (const executor of [...defaultExecutors(), ...registered]) registry.register(executor);
  return registry;
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeNodeExecutorRegistry(by: string): void {
  frozenBy = by;
}

/** Empties the registry. Tests only. */
export function resetNodeExecutorRegistryForTests(): void {
  registered.length = 0;
  frozenBy = undefined;
}
