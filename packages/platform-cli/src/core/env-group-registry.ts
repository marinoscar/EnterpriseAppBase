import { createCliRegistry } from './cli-registry.js';

// =============================================================================
// Env-key feature groups  (PP-14.22)
// =============================================================================
//
// A group is a named, opt-in bundle of `.env.example` keys: the deploy wizard
// skips a group's keys unless the operator enabled the group. The platform
// ships three (`observability`, `email`, `microsoft-oauth`); the list used to
// be a closed constant (`ENV_GROUPS`), so an app could not make its own keys an
// opt-in group. Now the platform registers its groups through
// `registerEnvGroup` like an app does, an env-spec fragment names a group by
// id, and a key naming an unregistered group is refused loudly (a typo would
// otherwise mean its keys are never asked).
// =============================================================================

/**
 * One feature group of env keys.
 *
 * @stability experimental
 */
export interface EnvGroupRegistration {
  /** Lowercase letters, digits and hyphens. What `--group` and `EnvVarMetadata.group` name. */
  id: string;
  /** Short name shown by the wizard. */
  label: string;
  /** One sentence: what turning the group on adds. */
  description: string;
  /**
   * Enabled for every deployment unless the group is not wanted: added to the
   * requested or recorded groups by `effectiveGroups`, like the telemetry
   * group. `false` makes the group opt-in.
   */
  defaultEnabled: boolean;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const registry = createCliRegistry<EnvGroupRegistration>({
  name: 'env group',
  registerFn: 'registerEnvGroup',
  idOf: (group) => group.id,
  validate: (group) => {
    if (typeof group.id !== 'string' || !ID_PATTERN.test(group.id)) {
      throw new Error(`Env group id "${String(group.id)}" is invalid: use lowercase letters, digits and hyphens.`);
    }
    if (typeof group.label !== 'string' || group.label.trim() === '') {
      throw new Error(`Env group "${group.id}" needs a label.`);
    }
    if (typeof group.description !== 'string') {
      throw new Error(`Env group "${group.id}" needs a description.`);
    }
    if (typeof group.defaultEnabled !== 'boolean') {
      throw new Error(`Env group "${group.id}" needs defaultEnabled: true or false.`);
    }
  },
});

/**
 * Registers an opt-in group of env keys. The deploy wizard (and the TUI's
 * install form) lists it, `--group <id>` enables it, and an env-spec fragment
 * puts keys in it with `group: '<id>'`.
 *
 * @param group - The id, label, description and whether it is on by default.
 * @throws Error on a malformed or duplicate id, or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerEnvGroup({ id: 'coach', label: 'Coach', description: 'The coaching assistant.', defaultEnabled: false });
 * registerEnvSpecFragment({ id: 'coach', metadata: { COACH_API_TOKEN: { group: 'coach', secret: true } } });
 * ```
 */
export function registerEnvGroup(group: EnvGroupRegistration): void {
  registry.register(Object.freeze({ ...group }));
}

/**
 * The registered groups, built-ins first, then in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listEnvGroups(): readonly EnvGroupRegistration[] {
  return registry.list();
}

/**
 * A registered group, or undefined.
 *
 * @param id - The group id.
 * @stability experimental
 */
export function getEnvGroup(id: string): EnvGroupRegistration | undefined {
  return registry.get(id);
}

/**
 * Refuses later registrations; `createCli` calls it.
 *
 * @param by - Who froze it, named in the error a late registration gets.
 * @internal
 * @stability experimental
 */
export function freezeEnvGroupRegistry(by: string): void {
  registry.freeze(by);
}

/**
 * Empties the registry. Tests only.
 *
 * @internal
 * @stability experimental
 */
export function resetEnvGroupRegistryForTests(): void {
  registry.reset();
}
