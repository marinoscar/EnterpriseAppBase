import type { DeployHooks } from '../hooks.js';

import type { DeployStep, StepContext } from './pipeline.js';
import type { DeployStepValues } from './step-values.js';

export type { DeployStepValues } from './step-values.js';

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
// PP-14.22 widens the placement: `after` (the original), `before`, and
// `replaces` (the registered step runs in place of a built-in or an earlier app
// step). `skipWhen` skips the step it replaces, with no replacement, when it
// returns true. Replacing or skipping a built-in is the app's responsibility:
// later built-in steps read what the earlier ones prepared (`checkout` sets the
// commit, `environment` writes the `.env`), so a replacement must leave the
// deployment in the state its neighbours expect.
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
  'database-role',
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
  /**
   * The deployment's environment (`.env`), READ-ONLY and WITHOUT SECRETS: `get`
   * returns undefined for a secret key (annotated secret, or named like one:
   * `*_SECRET`, `*PASSWORD*`, `*TOKEN*`, `*API_KEY*` ...), `keys` omits them.
   * Empty before the `environment` step has run on a fresh install.
   */
  readonly env: DeployStepValues;
  /** The values supplied with `--answer` / `--answers-file`, with the same secret rules as `env`. */
  readonly answers: DeployStepValues;
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
 * Where an app step goes, and what it does to a built-in step.
 *
 * Exactly ONE of `after`, `before` and `replaces` names the anchor.
 *
 * @stability experimental
 */
export interface DeployStepRegistration {
  /** `install` or `update`. */
  pipeline: DeployPipeline;
  /** Unique within the pipeline (built-in ids included), lowercase `[a-z0-9-]`. Recorded for `--resume`. */
  id: string;
  /** Run right after this step (a built-in, or an earlier-registered app step of the same pipeline). */
  after?: string | undefined;
  /** Run right before this step. */
  before?: string | undefined;
  /**
   * Run INSTEAD of this step (a built-in or an earlier app step): the replaced
   * step does not run. A later registration names the replacement's id.
   */
  replaces?: string | undefined;
  /**
   * With `replaces`: when it returns true the replaced step is SKIPPED (the
   * replacement does not run either). With `replaces` and no `step`, the
   * built-in runs as usual unless this returns true: a conditional skip of a
   * built-in. Not allowed with `after` / `before` (use `step.skip`).
   */
  skipWhen?: ((context: DeployStepContext) => boolean) | undefined;
  /** The step itself. Optional only for `replaces` with `skipWhen` (a skip-only registration). */
  step?: AppDeployStep | undefined;
}

/**
 * A registration that carries a step (every one except a skip-only
 * `replaces` + `skipWhen`): what a helper that builds a step returns, so its
 * `step` needs no check.
 *
 * @stability experimental
 */
export type AppDeployStepRegistration = DeployStepRegistration & {
  /** The step itself. */
  step: AppDeployStep;
};

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
 * Inserts an app step into `deploy install` or `deploy update`: right after a
 * named step (`after`, behind any app step already registered there), right
 * before one (`before`), or in place of one (`replaces`). `skipWhen` skips the
 * replaced step conditionally; with no `step` it is a conditional skip of a
 * built-in.
 *
 * @param registration - The pipeline, the step id, exactly one anchor and the step.
 * @throws Error when the id is malformed or taken in that pipeline, the anchor
 *   names no step of it (or one already replaced), none or several anchors are
 *   given, or `createCli` has already built the CLI.
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
  const { pipeline, id, after, before, replaces } = registration;
  if (frozenBy !== undefined) {
    throw new Error(`Deploy step "${id}" was registered after ${frozenBy}; register it before (or pass it to createCli).`);
  }
  if (pipeline !== 'install' && pipeline !== 'update') {
    throw new Error(`Deploy step "${id}" names an unknown pipeline "${String(pipeline)}" (install or update).`);
  }
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`Deploy step id "${String(id)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
  const mine = registered.filter((r) => r.pipeline === pipeline);
  // The step ids a registration may name: built-ins and registered steps, minus
  // what a `replaces` already took out of the plan.
  const replacedBy = new Map(mine.filter((r) => r.replaces !== undefined).map((r) => [r.replaces as string, r.id]));
  const taken = [...builtinDeployStepIds(pipeline), ...mine.map((r) => r.id)];
  if (taken.includes(id)) {
    throw new Error(`Deploy step id "${id}" is already a step of the ${pipeline} pipeline.`);
  }
  const anchors = [after, before, replaces].filter((anchor) => anchor !== undefined);
  if (anchors.length !== 1) {
    throw new Error(`Deploy step "${id}" must name exactly one of after, before and replaces.`);
  }
  const [anchor] = anchors as [string];
  const anchorKind = after !== undefined ? 'after' : before !== undefined ? 'before' : 'replaces';
  const present = [
    ...builtinDeployStepIds(pipeline),
    ...mine.filter((r) => r.step !== undefined).map((r) => r.id),
  ].filter((candidate) => !replacedBy.has(candidate));
  if (replacedBy.has(anchor)) {
    throw new Error(
      `Deploy step "${id}" ${anchorKind} "${anchor}", which step "${replacedBy.get(anchor)}" already replaces; name "${replacedBy.get(anchor)}" instead.`,
    );
  }
  if (!present.includes(anchor)) {
    throw new Error(
      `Deploy step "${id}" ${anchorKind} "${anchor}", which is not a step of the ${pipeline} pipeline. ` +
        `Built-in steps: ${builtinDeployStepIds(pipeline).join(', ')}.`,
    );
  }
  if (registration.skipWhen !== undefined) {
    if (typeof registration.skipWhen !== 'function') {
      throw new Error(`Deploy step "${id}": skipWhen must be a function (context) => boolean.`);
    }
    if (replaces === undefined) {
      throw new Error(`Deploy step "${id}": skipWhen applies to the step named by replaces; for after/before use step.skip.`);
    }
  }
  const skipOnly = registration.step === undefined && replaces !== undefined && registration.skipWhen !== undefined;
  if (!skipOnly && (typeof registration.step?.run !== 'function' || typeof registration.step.title !== 'string')) {
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
  const registrations = listRegisteredDeploySteps(pipeline);
  const appIds = new Set(registrations.map((r) => r.id));
  for (const registration of registrations) {
    const { step, skipWhen } = registration;
    const anchor = registration.after ?? registration.before ?? registration.replaces ?? '';
    const at = steps.findIndex((candidate) => candidate.id === anchor);
    if (at < 0) {
      throw new Error(`Deploy step "${registration.id}" names "${anchor}", which is not in the ${pipeline} pipeline.`);
    }

    if (step === undefined) {
      // Skip-only: the built-in stays where it is and runs unless `skipWhen` says no.
      const target = steps[at] as DeployStep<C>;
      steps[at] = {
        ...target,
        skip: (context: C) =>
          skipWhen?.(adapt(context)) === true ? `skipped by ${registration.id}` : target.skip?.(context),
      };
      continue;
    }

    const adapted: DeployStep<C> = {
      id: registration.id,
      title: step.title,
      ...(step.skip === undefined && skipWhen === undefined
        ? {}
        : {
            skip: (context: C) =>
              skipWhen?.(adapt(context)) === true
                ? `skipped by ${registration.id}: ${anchor} is not needed`
                : step.skip?.(adapt(context)),
          }),
      run: (context: C) => step.run(adapt(context)),
    };

    if (registration.replaces !== undefined) {
      steps[at] = adapted;
    } else if (registration.before !== undefined) {
      // Directly before the target, after any step already inserted before it.
      steps.splice(at, 0, adapted);
    } else {
      // After the target AND after any app step already inserted behind it, so
      // two steps registered after the same target keep registration order.
      let insertAt = at + 1;
      while (insertAt < steps.length && appIds.has(steps[insertAt]?.id ?? '')) insertAt += 1;
      steps.splice(insertAt, 0, adapted);
    }
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
