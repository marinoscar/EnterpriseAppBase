import { createCliRegistry } from '../../../core/cli-registry.js';

import type { Check } from './types.js';

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
 * A deploy prerequisite check: the shape of every built-in doctor check.
 *
 * @stability experimental
 */
export type DeployCheck = Check;

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

/** Refuses later registrations; `createCli` calls it. */
export function freezeDeployCheckRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetDeployCheckRegistryForTests(): void {
  registry.reset();
}
