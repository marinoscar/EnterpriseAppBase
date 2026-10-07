import type { DeployHooks } from '../hooks.js';

import type { DeployStep, StepContext } from './pipeline.js';

// =============================================================================
// The deploy step registry  (PP-8.9, #715)
// =============================================================================
//
// `install` and `update` are lists of steps (pipeline.ts), but the lists were
// fixed, so an app with one more thing to do on a deploy (EvoPath publishing
// its Android APK) forked `install.ts`. An app now registers a step and names
// the built-in step it runs after; the pipeline inserts it there, and
// `--resume`, the journal, `DeployHooks` and the TUI's progress view all see
// it like any other step.
//
// THE BUILT-IN STEP IDS ARE A STABLE SURFACE. An app's registration names one
// of them, so renaming or removing a built-in id is a breaking change of this
// package (the README catalogs them, and `registry.test.ts` pins them against
// what `buildInstallSteps()` / `buildUpdateSteps()` actually return).
//
// An app step gets a NARROW context, not the pipeline's private one: it can
// run a command (journaled and redacted like a built-in's, output through
// `DeployHooks.onLog`), log a line and report progress. `DeployHooks` stays
// the only I/O seam; a step never writes to `process.stdout`.
// =============================================================================

/**
 * Which deploy pipeline a step belongs to.
 *
 * @stability experimental
 */
export type DeployPipeline = 'install' | 'update';

/**
 * The built-in step ids of `deploy install`, in order.
 *
 * @stability stable
 */
export const INSTALL_STEP_IDS = Object.freeze([
  'preflight',
  'checkout',
  'environment',
  'validate-environment',
  'ensure-database',
  'version',
  'build',
  'migrate',
  'seed',
  'start',
  'health',
  'deploy-info',
  'proxy-bootstrap',
  'publish',
  'renewal',
  'verify',
  'publish-version',
] as const);

/**
 * The built-in step ids of `deploy update`, in order.
 *
 * @stability stable
 */
export const UPDATE_STEP_IDS = Object.freeze([
  'preflight',
  'fetch',
  'environment-drift',
  'ensure-database',
  'version',
  'maintenance-on',
  'build',
  'migrate',
  'seed',
  'restart',
  'maintenance-off',
  'edge-config',
  'health',
  'deploy-info',
  'publish',
  'renewal',
  'verify',
  'publish-version',
] as const);

/**
 * What a command run by an app step returned.
 *
 * @stability experimental
 */
export interface DeployCommandResult {
  /** The exit code (0, or one of `allowExitCodes`). */
  exitCode: number;
  /** Everything the command wrote to stdout, ANSI stripped. */
  stdout: string;
  /** Everything the command wrote to stderr, ANSI stripped. */
  stderr: string;
}

/**
 * What an app's deploy step is given.
 *
 * @stability experimental
 */
export interface DeployStepContext {
  /** The pipeline running the step. */
  readonly pipeline: DeployPipeline;
  /** The deployment root, e.g. `/opt/infra/apps/<app>`. */
  readonly deployRoot: string;
  /** The app's checkout, `<deployRoot>/repo` (present from `checkout` / `fetch` on). */
  readonly checkoutPath: string;
  /** The commit being deployed, once the pipeline knows it. */
  readonly commitSha: string | undefined;
  /** The run's hooks, for a step that renders more than lines. Usually `log`/`progress` suffice. */
  readonly hooks: DeployHooks | undefined;
  /** Writes a line to the journal and to `DeployHooks.onLog`. */
  log(line: string): void;
  /** Reports progress of a long wait through `DeployHooks.onProgress`. */
  progress(message: string): void;
  /**
   * Runs a command the way a built-in step does: journaled, every output
   * line redacted and passed to `DeployHooks.onLog`. Throws on a non-zero
   * exit not listed in `allowExitCodes`, which fails the step.
   */
  exec(
    argv: readonly string[],
    options?: { cwd?: string | undefined; timeoutMs?: number | undefined; allowExitCodes?: readonly number[] | undefined },
  ): Promise<DeployCommandResult>;
}

/**
 * An app's deploy step.
 *
 * @stability experimental
 */
export interface AppDeployStep {
  /** Shown in the journal, the progress view and the summary. */
  title: string;
  /** Skipped, with this reason, when it returns a string. */
  skip?: ((context: DeployStepContext) => string | undefined) | undefined;
  /** Does the work; throws to fail the step (and stop the pipeline). */
  run(context: DeployStepContext): Promise<void>;
}

/**
 * Where an app step goes.
 *
 * @stability experimental
 */
export interface DeployStepRegistration {
  /** `install` or `update`. */
  pipeline: DeployPipeline;
  /** Unique within the pipeline (built-in ids included), lowercase `[a-z0-9-]`. Recorded for `--resume`. */
  id: string;
  /** The built-in step, or an earlier-registered app step of the same pipeline, it runs after. */
  after: string;
  /** The step itself. */
  step: AppDeployStep;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const registered: DeployStepRegistration[] = [];
let frozenBy: string | undefined;

/**
 * The built-in step ids of a pipeline.
 *
 * @param pipeline - `install` or `update`.
 * @returns The ids, in order.
 * @stability experimental
 */
export function builtinDeployStepIds(pipeline: DeployPipeline): readonly string[] {
  return pipeline === 'install' ? INSTALL_STEP_IDS : UPDATE_STEP_IDS;
}

/**
 * Inserts an app step into `deploy install` or `deploy update`, right after a
 * named step (after any app step already registered there).
 *
 * @param registration - The pipeline, the step id, the step it follows and the step.
 * @throws Error when the id is malformed or taken in that pipeline, `after`
 *   names no step of it, or `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerDeployStep({
 *   pipeline: 'install',
 *   id: 'announce',
 *   after: 'verify',
 *   step: { title: 'Announce the deployment', run: async (context) => context.log('deployed') },
 * });
 * ```
 */
export function registerDeployStep(registration: DeployStepRegistration): void {
  const { pipeline, id, after } = registration;
  if (frozenBy !== undefined) {
    throw new Error(`Deploy step "${id}" was registered after ${frozenBy}; register it before (or pass it to createCli).`);
  }
  if (pipeline !== 'install' && pipeline !== 'update') {
    throw new Error(`Deploy step "${id}" names an unknown pipeline "${String(pipeline)}" (install or update).`);
  }
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`Deploy step id "${String(id)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
  const known = [...builtinDeployStepIds(pipeline), ...registered.filter((r) => r.pipeline === pipeline).map((r) => r.id)];
  if (known.includes(id)) {
    throw new Error(`Deploy step id "${id}" is already a step of the ${pipeline} pipeline.`);
  }
  if (!known.includes(after)) {
    throw new Error(
      `Deploy step "${id}" runs after "${after}", which is not a step of the ${pipeline} pipeline. ` +
        `Built-in steps: ${builtinDeployStepIds(pipeline).join(', ')}.`,
    );
  }
  if (typeof registration.step?.run !== 'function' || typeof registration.step.title !== 'string') {
    throw new Error(`Deploy step "${id}" needs a title and a run function.`);
  }
  registered.push(Object.freeze({ ...registration }));
}

/**
 * The app steps registered so far, in registration order.
 *
 * @param pipeline - Only this pipeline's, when given.
 * @returns A frozen copy.
 * @stability experimental
 */
export function listRegisteredDeploySteps(pipeline?: DeployPipeline): readonly DeployStepRegistration[] {
  return Object.freeze(registered.filter((r) => pipeline === undefined || r.pipeline === pipeline));
}

/**
 * The pipeline's steps with the registered app steps inserted, each adapted to
 * the pipeline's own context by `adapt`.
 *
 * @internal
 */
export function withRegisteredSteps<C extends StepContext>(
  pipeline: DeployPipeline,
  builtins: readonly DeployStep<C>[],
  adapt: (context: C) => DeployStepContext,
): DeployStep<C>[] {
  const steps = [...builtins];
  for (const registration of listRegisteredDeploySteps(pipeline)) {
    const at = steps.findIndex((step) => step.id === registration.after);
    if (at < 0) {
      throw new Error(`Deploy step "${registration.id}" runs after "${registration.after}", which is not in the ${pipeline} pipeline.`);
    }
    // After the target AND after any app step already inserted behind it, so
    // two steps registered after the same target keep registration order.
    let insertAt = at + 1;
    const appIds = new Set(listRegisteredDeploySteps(pipeline).map((r) => r.id));
    while (insertAt < steps.length && appIds.has(steps[insertAt]?.id ?? '')) insertAt += 1;
    const { step } = registration;
    steps.splice(insertAt, 0, {
      id: registration.id,
      title: step.title,
      ...(step.skip === undefined ? {} : { skip: (context: C) => step.skip?.(adapt(context)) }),
      run: (context: C) => step.run(adapt(context)),
    });
  }
  return steps;
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeDeployStepRegistry(by: string): void {
  frozenBy = by;
}

/** Empties the registry. Tests only. */
export function resetDeployStepRegistryForTests(): void {
  registered.length = 0;
  frozenBy = undefined;
}
