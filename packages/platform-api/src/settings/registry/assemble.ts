// =============================================================================
// Assembling the namespace lists: contributions, extensions, defaults (PP-14.21)
// =============================================================================
//
// The app's manifests used to register "the platform's namespaces, then the
// app's". A separately installed package (an `@acme/billing-settings`) could
// not contribute a namespace without the app listing it by hand. Three things
// change that, all resolved BEFORE anything is registered so the registry only
// ever holds the final declarations:
//
//   - `registerSettingsContribution` is a pre-bootstrap collector: a package's
//     side-effect import calls it, and the manifest folds what it collected.
//   - `overrideSettingsNamespaceDefaults` changes the DEFAULTS of a namespace
//     (never its shape or its merge), validated against the schema.
//   - the assemblers (`assembleSystemSettingsNamespaces`,
//     `assembleUserSettingsNamespaces`) apply them all in ONE documented order.
//
// THE ORDER (registration order is the stored JSON's key order and the OpenAPI
// document's, so it is a contract):
//
//   1. the platform's namespaces, in the order the app lists them
//   2. the contributions' namespaces, in import order
//   3. the app's own namespaces
//
//   then, over the whole list:
//   4. extensions: the contributions' (import order), then the app's
//   5. defaults overrides (system only): `overrideSettingsNamespaceDefaults`
//      calls in call order, then the app's list
//
// Framework-free: zod and the registry primitive only.
// =============================================================================

import { defineRegistry } from '../../core/index';
import { SETTINGS_NAMESPACE_KEY_PATTERN, type SystemSettingsNamespace } from './system-settings-namespace';
import {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  foldSettingsExtensions,
  type SystemSettingsNamespaceExtension,
  type UserSettingsNamespaceExtension,
} from './extend';
import { schemaAt, unwrapToObject } from './nested';
import type { UserSettingsNamespace } from './user-settings-namespace';

// -----------------------------------------------------------------------------
// Defaults overrides
// -----------------------------------------------------------------------------

/**
 * A change to the DEFAULTS of a registered system namespace: a partial value
 * merged (objects deeply, everything else replaced) onto the namespace's
 * defaults. The shape, the merge and every schema stay as the namespace
 * declared them.
 *
 * @stability experimental
 */
export interface SettingsDefaultsOverride {
  /** The system namespace whose defaults change. */
  readonly key: string;
  /** The partial defaults; every path must exist in the stored schema and the result must satisfy it. */
  readonly defaults: Readonly<Record<string, unknown>>;
}

/**
 * A {@link SettingsDefaultsOverride} as the registry holds it, with the unique
 * id the registry keys it by (`<namespace>:<call number>`).
 *
 * @stability experimental
 */
export interface RegisteredSettingsDefaultsOverride extends SettingsDefaultsOverride {
  /** The registry id. */
  readonly id: string;
}

let overrideSequence = 0;

/**
 * The defaults overrides registered with {@link overrideSettingsNamespaceDefaults},
 * in call order. Read by the manifests through {@link assembleSystemSettingsNamespaces}.
 *
 * @stability experimental
 */
export const settingsDefaultsOverrideRegistry = defineRegistry<RegisteredSettingsDefaultsOverride>({
  name: 'settings-defaults-overrides',
  idOf: (override) => override.id,
  validate: (override) => {
    if (!SETTINGS_NAMESPACE_KEY_PATTERN.test(override.key)) {
      throw new Error(`"${override.key}" is not a settings namespace key`);
    }
    if (!isPlainObject(override.defaults) || Object.keys(override.defaults).length === 0) {
      throw new Error('defaults must be a non-empty object of the values to change');
    }
  },
});

/**
 * Changes the defaults of a registered system namespace, from the app or from a
 * package's side-effect import. Call it at import time, before the app's
 * manifest runs. The change is checked when the manifest assembles the
 * namespaces: every path must exist in the namespace's stored schema and the
 * resulting defaults must satisfy it, so a typo or a wrong type fails the
 * boot naming the namespace. Only the defaults change; the shape, the merge
 * and the org layer stay the namespace's.
 *
 * Several overrides of one namespace apply in call order, later over earlier.
 * User namespaces have no defaults (absent means "use the client's built-in
 * default"), so there is nothing to override for them.
 *
 * @param key - the system namespace key.
 * @param defaults - the partial defaults to apply.
 * @throws RegistryError when the key or the value is malformed or the registry is frozen.
 *
 * @example
 * ```ts
 * overrideSettingsNamespaceDefaults('retention', { jobs: { succeededDays: 14 } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function overrideSettingsNamespaceDefaults(key: string, defaults: Readonly<Record<string, unknown>>): void {
  if (!SETTINGS_NAMESPACE_KEY_PATTERN.test(key)) throw new Error(`"${key}" is not a settings namespace key`);
  overrideSequence += 1;
  settingsDefaultsOverrideRegistry.register({ id: `${key}:${overrideSequence}`, key, defaults });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `patch` merged onto `base`: plain objects deeply, anything else replaced. */
function mergeDefaults(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') throw new Error('"__proto__" is not a settings field');
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeDefaults(out[key], value) : structuredClone(value);
  }
  return out;
}

/** Every leaf-or-record path of `patch`, as segment arrays. */
function pathsOf(patch: Record<string, unknown>, prefix: readonly string[] = []): string[][] {
  const paths: string[][] = [];
  for (const [key, value] of Object.entries(patch)) {
    const here = [...prefix, key];
    if (isPlainObject(value) && Object.keys(value).length > 0) paths.push(here, ...pathsOf(value, here));
    else paths.push(here);
  }
  return paths;
}

/**
 * `namespaces` with each override applied to its namespace's defaults.
 *
 * @param namespaces - the folded declarations.
 * @param overrides - the overrides, in the order to apply.
 * @returns the declarations; those without an override are the same objects.
 * @throws Error naming the namespace when it is unknown, a path does not exist
 *   in its stored schema, or the resulting defaults fail the schema.
 *
 * @stability experimental
 */
export function applySettingsDefaultsOverrides(
  namespaces: readonly SystemSettingsNamespace[],
  overrides: readonly SettingsDefaultsOverride[],
): SystemSettingsNamespace[] {
  const known = namespaces.map((ns) => ns.key);
  const result = [...namespaces];
  for (const override of overrides) {
    const index = result.findIndex((ns) => ns.key === override.key);
    const ns = result[index];
    if (index < 0 || ns === undefined) {
      throw new Error(
        `Cannot override the defaults of system settings namespace "${override.key}": no such namespace. Known: ${known.join(', ')}.`,
      );
    }
    for (const path of pathsOf(override.defaults as Record<string, unknown>)) {
      // Only an object step can be checked for a misspelt field; a record or a free-form
      // value takes any key, and the schema parse below still judges its contents.
      const parent = unwrapToObject(schemaAt(ns.storedSchema, path.slice(0, -1)));
      const last = path[path.length - 1] as string;
      if (parent !== undefined && !(last in parent.shape)) {
        throw new Error(
          `Cannot override the defaults of system settings namespace "${override.key}": ${path.join('.')} is not a field of its stored schema.`,
        );
      }
    }
    const defaults = mergeDefaults(ns.defaults, override.defaults as Record<string, unknown>);
    const parsed = ns.storedSchema.safeParse(defaults);
    if (!parsed.success) {
      throw new Error(
        `Cannot override the defaults of system settings namespace "${override.key}": the result does not satisfy its stored schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    result[index] = { ...ns, defaults };
  }
  return result;
}

// -----------------------------------------------------------------------------
// Contributions
// -----------------------------------------------------------------------------

/**
 * What a package contributes to the settings registries from a side-effect
 * import. Everything is optional.
 *
 * @stability experimental
 */
export interface SettingsContribution {
  /**
   * Who contributes (the package name, `@acme/billing-settings`). Unique;
   * named in every error the contribution causes.
   */
  readonly id: string;
  /** System namespaces the package owns. */
  readonly system?: readonly SystemSettingsNamespace[];
  /** Optional user namespaces the package owns. */
  readonly user?: readonly UserSettingsNamespace[];
  /** Fields the package adds inside namespaces that already exist (the platform's, the app's, another contribution's). */
  readonly extensions?: {
    /** Inside system namespaces. */
    readonly system?: readonly SystemSettingsNamespaceExtension[];
    /** Inside user namespaces. */
    readonly user?: readonly UserSettingsNamespaceExtension[];
  };
}

/**
 * The contributions collected so far, in import order. Frozen when the
 * application bootstraps, like every static registry.
 *
 * @stability experimental
 */
export const settingsContributionRegistry = defineRegistry<SettingsContribution>({
  name: 'settings-contributions',
  idOf: (contribution) => contribution.id,
  // A package name (`@acme/billing-settings`) starts with `@`.
  idPattern: /^[@A-Za-z0-9][A-Za-z0-9._:/@-]*$/,
  describeDuplicate: (_existing, incoming) =>
    `Settings contribution "${incoming.id}" is already registered: the package was imported twice (two copies of it installed, or two import paths).`,
  validate: (contribution) => {
    for (const part of ['system', 'user'] as const) {
      const list = contribution[part];
      if (list !== undefined && !Array.isArray(list)) throw new Error(`${part} must be an array of namespace declarations`);
    }
    for (const part of ['system', 'user'] as const) {
      const list = contribution.extensions?.[part];
      if (list !== undefined && !Array.isArray(list)) throw new Error(`extensions.${part} must be an array of extensions`);
    }
  },
});

/**
 * Contributes settings namespaces and extensions from a package. Call it at
 * import time from the package's entry module: the app imports the package for
 * its side effect (`app-registrations/settings-contributions.ts`) and its
 * manifest folds what was collected, in import order, between the platform's
 * namespaces and the app's own. The app lists nothing by hand.
 *
 * Nothing is validated beyond the shape here: the namespaces go through the
 * registry's usual checks (duplicate and reserved keys, secret-named fields,
 * defaults against the schema) when the manifest registers them, and an
 * extension of a namespace that does not exist fails the boot naming the key.
 *
 * @param contribution - what the package contributes.
 * @throws RegistryError when the id is taken (a package imported twice through
 *   two paths) or the registry is frozen (imported after the application bootstrapped).
 *
 * @example
 * ```ts
 * // @acme/billing-settings/src/index.ts
 * registerSettingsContribution({ id: '@acme/billing-settings', system: [BILLING_SYSTEM_SETTINGS] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerSettingsContribution(contribution: SettingsContribution): void {
  settingsContributionRegistry.register(contribution);
}

// -----------------------------------------------------------------------------
// The assemblers
// -----------------------------------------------------------------------------

function assertNoDuplicateKeys<N extends { key: string }>(
  groups: ReadonlyArray<{ owner: string; namespaces: readonly N[] }>,
  scope: 'system' | 'user',
): void {
  const seen = new Map<string, string>();
  for (const { owner, namespaces } of groups) {
    for (const ns of namespaces) {
      const first = seen.get(ns.key);
      if (first !== undefined) {
        throw new Error(
          `${scope === 'system' ? 'System' : 'User'} settings namespace "${ns.key}" is already registered: ${owner} declares it, but ${first} already does. ` +
            `Extend it with ${scope === 'system' ? 'extendSystemSettingsNamespace' : 'extendUserSettingsNamespace'} instead of declaring it twice.`,
        );
      }
      seen.set(ns.key, owner);
    }
  }
}

/**
 * What {@link assembleSystemSettingsNamespaces} takes.
 *
 * @stability experimental
 */
export interface SystemSettingsAssembly {
  /** The platform's namespaces, in the order the app registers them. */
  readonly platform: readonly SystemSettingsNamespace[];
  /** The app's own namespaces. */
  readonly app?: readonly SystemSettingsNamespace[];
  /** The app's extensions of existing namespaces. */
  readonly appExtensions?: readonly SystemSettingsNamespaceExtension[];
  /** The app's defaults overrides, applied after every `overrideSettingsNamespaceDefaults` call. */
  readonly appDefaults?: readonly SettingsDefaultsOverride[];
  /** The contributions to fold; default: every one collected by {@link registerSettingsContribution}. */
  readonly contributions?: readonly SettingsContribution[];
}

/**
 * The final, ordered list of system namespaces for the app's manifest to
 * register: platform, contributions (import order), app; extensions folded in
 * (contributions first, then the app's); defaults overrides applied.
 *
 * @param input - see {@link SystemSettingsAssembly}.
 * @returns the declarations in registration order.
 * @throws Error naming the owner (a contribution id, `the platform`, `the app`)
 *   when two declare one key, an extension names a missing namespace, or a
 *   defaults override is invalid.
 *
 * @example
 * ```ts
 * registerSystemSettingsNamespaces(
 *   assembleSystemSettingsNamespaces({ platform: PLATFORM_NAMESPACES, app: APP_SYSTEM_SETTINGS_NAMESPACES, appExtensions: APP_SYSTEM_SETTINGS_EXTENSIONS }),
 * );
 * ```
 *
 * @stability experimental
 */
export function assembleSystemSettingsNamespaces(input: SystemSettingsAssembly): SystemSettingsNamespace[] {
  const contributions = input.contributions ?? settingsContributionRegistry.list();
  const groups = [
    { owner: 'the platform', namespaces: input.platform },
    ...contributions.map((c) => ({ owner: `settings contribution "${c.id}"`, namespaces: c.system ?? [] })),
    { owner: 'the app', namespaces: input.app ?? [] },
  ];
  assertNoDuplicateKeys(groups, 'system');

  const extensions = [...contributions.flatMap((c) => c.extensions?.system ?? []), ...(input.appExtensions ?? [])];
  const { platform, app } = foldSettingsExtensions(
    { platform: groups.slice(0, -1).flatMap((g) => g.namespaces), app: groups[groups.length - 1]?.namespaces ?? [] },
    extensions,
    extendSystemSettingsNamespace,
    'system settings',
  );

  return applySettingsDefaultsOverrides(
    [...platform, ...app],
    [...settingsDefaultsOverrideRegistry.list(), ...(input.appDefaults ?? [])],
  );
}

/**
 * What {@link assembleUserSettingsNamespaces} takes.
 *
 * @stability experimental
 */
export interface UserSettingsAssembly {
  /** The platform's namespaces, in the order the app registers them. */
  readonly platform: readonly UserSettingsNamespace[];
  /** The app's own namespaces. */
  readonly app?: readonly UserSettingsNamespace[];
  /** The app's extensions of existing namespaces. */
  readonly appExtensions?: readonly UserSettingsNamespaceExtension[];
  /** The contributions to fold; default: every one collected by {@link registerSettingsContribution}. */
  readonly contributions?: readonly SettingsContribution[];
}

/**
 * The final, ordered list of user namespaces for the app's manifest to
 * register; the order and the folding are those of
 * {@link assembleSystemSettingsNamespaces}.
 *
 * @param input - see {@link UserSettingsAssembly}.
 * @returns the declarations in registration order.
 * @throws Error naming the owner when two declare one key or an extension names a missing namespace.
 *
 * @stability experimental
 */
export function assembleUserSettingsNamespaces(input: UserSettingsAssembly): UserSettingsNamespace[] {
  const contributions = input.contributions ?? settingsContributionRegistry.list();
  const groups = [
    { owner: 'the platform', namespaces: input.platform },
    ...contributions.map((c) => ({ owner: `settings contribution "${c.id}"`, namespaces: c.user ?? [] })),
    { owner: 'the app', namespaces: input.app ?? [] },
  ];
  assertNoDuplicateKeys(groups, 'user');

  const extensions = [...contributions.flatMap((c) => c.extensions?.user ?? []), ...(input.appExtensions ?? [])];
  const { platform, app } = foldSettingsExtensions(
    { platform: groups.slice(0, -1).flatMap((g) => g.namespaces), app: groups[groups.length - 1]?.namespaces ?? [] },
    extensions,
    extendUserSettingsNamespace,
    'user settings',
  );
  return [...platform, ...app];
}
