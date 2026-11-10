import { createCliRegistry } from '../../../core/index.js';

import { redactedValues, type DeployStepValues } from '../steps/step-values.js';

import type { Check, CheckContext } from './types.js';

// =============================================================================
// App deploy checks  (PP-14.22)
// =============================================================================
//
// `ALL_CHECKS` is the platform's ordered prerequisite list. `doctor` renders
// it and `deploy install` / `deploy update` run its `required` subset as their
// preflight. It was a fixed array, so an app with a prerequisite of its own
// (an API token that must exist, a disk mount, a sibling service) had no way
// to put it in the same report.
//
// `registerDeployCheck` appends an app check AFTER the built-ins, in
// registration order. It is the same `Check` the built-ins are, so the whole
// contract applies unchanged (see types.ts): the check never throws (a throw
// becomes a `fail`), `remedy` is mandatory on a `fail`, `required` decides the
// exit code, and a check is READ-ONLY. A `required` app check blocks install
// and update exactly like a built-in one; use `recommended` for advice.
// =============================================================================

/**
 * What a check is given: where the deployment lives and its configuration,
 * read-only. A narrow view of the platform's own check context.
 *
 * @stability experimental
 */
export interface DeployCheckContext {
  /** The deployment root, e.g. `/opt/infra/apps/<app>`. */
  readonly deployRoot: string;
  /** The loopback port the shared proxy forwards to. */
  readonly bindPort: number;
  /**
   * The deployment's compose project: the `com.docker.compose.project` label
   * on its containers. Use it, not `basename(deployRoot)`, to recognise the
   * deployment's own containers; a deployment installed before the project was
   * recorded runs under `compose`. Optional: absent when no state exists yet;
   * fall back to the folder name only then.
   */
  readonly composeProject?: string | undefined;
  /** The shared reverse proxy's directory. */
  readonly proxyRoot: string;
  /** The public hostname, when one is known. */
  readonly domain: string | undefined;
  /**
   * The resolved environment, when one exists, WITHOUT secrets: `get` returns
   * `undefined` for a secret key (annotated, or named like one) and `has`
   * reports whether the key holds a value. `undefined` before the wizard has
   * produced an environment.
   */
  readonly env: DeployStepValues | undefined;
  /** True when this run does not publish through the shared proxy (`--skip-proxy`). */
  readonly skipProxy: boolean;
}

/**
 * What a check reports.
 *
 * @stability experimental
 */
export interface DeployCheckResult {
  /** `pass`, `warn`, `fail` (blocks a deploy when the check is `required`) or `skip`. */
  status: 'pass' | 'warn' | 'fail' | 'skip';
  /** One line: what was found. */
  detail: string;
  /** Shown on `warn` and `fail`: a command or a path, never a category. Mandatory on `fail`. */
  remedy?: string | undefined;
}

/**
 * A deploy prerequisite check: the shape of the platform's doctor checks.
 *
 * @stability experimental
 */
export interface DeployCheck {
  /** Stable, lowercase letters, digits and hyphens; not a built-in check's id. */
  id: string;
  /** Shown by `doctor`. */
  title: string;
  /** `required` blocks `deploy install` and `deploy update` and fails `doctor`; `recommended` is advice. */
  severity: 'required' | 'recommended';
  /** Ids of built-in or earlier-registered checks that must pass first; otherwise this one reports `skip`. */
  requires?: readonly string[] | undefined;
  /** Runs the check. Read-only; a throw is reported as a `fail`. */
  run(context: DeployCheckContext): Promise<DeployCheckResult>;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Ids the built-ins use, supplied by `index.ts` (kept out of this file to avoid an import cycle). */
let builtinIds: () => readonly string[] = () => [];

/** @internal Wires the built-in id list; `checks/index.ts` calls it once. */
export function setBuiltinCheckIds(ids: () => readonly string[]): void {
  builtinIds = ids;
}

const registry = createCliRegistry<DeployCheck>({
  name: 'deploy check',
  registerFn: 'registerDeployCheck',
  idOf: (check) => check.id,
  validate: (check) => {
    if (typeof check?.id !== 'string' || !ID_PATTERN.test(check.id)) {
      throw new Error(`Deploy check id "${String(check?.id)}" is invalid: use lowercase letters, digits and hyphens.`);
    }
    if (typeof check.title !== 'string' || check.title.trim() === '') {
      throw new Error(`Deploy check "${check.id}" needs a title.`);
    }
    if (check.severity !== 'required' && check.severity !== 'recommended') {
      throw new Error(`Deploy check "${check.id}" needs severity "required" or "recommended".`);
    }
    if (typeof check.run !== 'function') {
      throw new Error(`Deploy check "${check.id}" needs a run function.`);
    }
    if (builtinIds().includes(check.id)) {
      throw new Error(`Deploy check id "${check.id}" is already a built-in check; choose another id.`);
    }
    const known = [...builtinIds(), ...registry.list().map((existing) => existing.id)];
    for (const required of check.requires ?? []) {
      if (!known.includes(required)) {
        throw new Error(
          `Deploy check "${check.id}" requires "${required}", which is not a built-in or an earlier-registered check.`,
        );
      }
    }
  },
});

/**
 * Adds a prerequisite check to `doctor` and to the install and update
 * preflight, after the built-in checks.
 *
 * @param check - The check: id, title, severity, optional `requires`, and `run`.
 * @throws Error on a malformed or duplicate id (built-in ids included), a
 *   `requires` naming an unknown check, or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerDeployCheck({
 *   id: 'coach-token',
 *   title: 'Coach API token present',
 *   severity: 'required',
 *   async run(context) {
 *     return context.env?.get('COACH_API_TOKEN')
 *       ? { status: 'pass', detail: 'set' }
 *       : { status: 'fail', detail: 'COACH_API_TOKEN is empty', remedy: 'Set COACH_API_TOKEN in .env' };
 *   },
 * });
 * ```
 */
export function registerDeployCheck(check: DeployCheck): void {
  registry.register(check);
}

/**
 * The app checks registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listRegisteredDeployChecks(): readonly DeployCheck[] {
  return registry.list();
}

/**
 * A registered check as the doctor runner runs it: the context narrowed (and
 * the environment stripped of secrets) before the app's function sees it.
 *
 * @internal
 */
export function toRunnerCheck(check: DeployCheck): Check {
  return {
    id: check.id,
    title: check.title,
    severity: check.severity,
    ...(check.requires === undefined ? {} : { requires: check.requires }),
    run: (context: CheckContext) =>
      check.run({
        deployRoot: context.deployRoot,
        bindPort: context.bindPort,
        composeProject: context.composeProject,
        proxyRoot: context.proxyRoot,
        domain: context.domain,
        env: context.env === undefined ? undefined : redactedValues(() => context.env),
        skipProxy: context.skipProxy === true,
      }),
  };
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeDeployCheckRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetDeployCheckRegistryForTests(): void {
  registry.reset();
}
