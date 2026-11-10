// =============================================================================
// The pluggable-kind primitive (PP-14.5, issue #923)
// =============================================================================
//
// Seven slices each hard-code a list of implementations with a fixed settings
// key per implementation (AI providers, storage drivers, email transports,
// sign-in providers, notification channels, the telemetry store, the backup
// target). A pluggable kind is the ONE shape they all share, so an extension
// author learns it once:
//
//   kind           'ai-provider' | 'storage-driver' | ...   (one registry each)
//   implementation id + label + settingsSchema + defaults + secrets + build()
//
//   - REGISTRY: built on `defineRegistry`, so a duplicate id throws and the
//     kind freezes once the application has bootstrapped. Register at import
//     time (`apps/api/src/app-registrations/`).
//   - SETTINGS: stored as a record keyed by implementation id,
//     `{ <id>: <that implementation's settings> }`. Each implementation
//     supplies its own zod schema and defaults. A WRITE rejects an unknown id
//     and parses each entry; a READ drops an unknown id with one warning, so
//     removing a plugin never bricks the settings row.
//   - SECRETS: never in settings, never in env vars. An implementation DECLARES
//     the secrets it needs (name, label, required); the slice that consumes the
//     kind stores them in the encrypted credential store and passes presence
//     flags to `describe`. The wire descriptor carries `hasValue`, never a value.
//   - DESCRIPTORS: `describe` turns the settings schema plus the declared
//     secrets into the `PluggableDescriptor` a generated form renders.
//
// FRAMEWORK-FREE like registry.ts: zod and the registry primitive only, so a
// kind can be defined where no Nest container exists (seeds, scripts, DTOs).
// =============================================================================

import { PLUGGABLE_ID_PATTERN, type PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import type { z } from 'zod';

import { defineRegistry, type Registry } from '../registry/registry';
import { describeConfigFields } from './describe-config-fields';
import { PluggableSettingsError, PluggableUnknownError } from './pluggable-errors';

/**
 * One secret an implementation needs (an API key, a signing token). Declared,
 * never stored in settings: the consuming slice keeps the value in the
 * encrypted credential store and tells `describe` only whether one exists.
 *
 * @stability experimental
 */
export interface PluggableSecretSpec {
  /** The secret's name, e.g. `apiKey`. Passed to `build`'s `secret(name)`. */
  name: string;
  /** The label a form shows, e.g. `API key`. */
  label: string;
  /** Whether the implementation cannot work without it. */
  required: boolean;
  /** One sentence of help for the form. */
  help?: string;
}

/**
 * What `build` receives: the kind's own build context, the implementation's
 * parsed settings and a resolver for its declared secrets.
 *
 * @stability experimental
 */
export type PluggableBuildInput<TBuildContext, TSettings extends Record<string, unknown>> = TBuildContext & {
  /** This implementation's settings, parsed with its `settingsSchema`, defaults filled. */
  settings: TSettings;
  /** Resolves one of the implementation's declared secrets; `null` when none is stored. Held only for the call. */
  secret(name: string): Promise<string | null>;
};

/**
 * One implementation of a pluggable kind.
 *
 * @typeParam TInstance - what `build` returns (the provider, driver, transport...).
 * @typeParam TBuildContext - what the consuming slice passes to `build` besides
 *   `settings` and `secret` (a logger, a tenant scope...).
 * @typeParam TSettings - the parsed settings; `settingsSchema` produces them.
 *
 * @stability experimental
 */
export interface PluggableImplementation<
  TInstance,
  TBuildContext,
  TSettings extends Record<string, unknown> = Record<string, unknown>,
> {
  /** `^[a-z][a-z0-9-]{1,47}$`; permanent once stored. */
  id: string;
  /** The human label. */
  label: string;
  /** One sentence on what it is. */
  description?: string;
  /**
   * The NON-secret settings. A field here whose name looks like a secret
   * (`key`, `secret`, `token`, `password`) fails the conformance kit: declare it
   * in {@link PluggableImplementation.secrets} instead. `.describe('help')`
   * becomes the field's help text and `.meta({ label })` its label.
   */
  settingsSchema: z.ZodObject<z.ZodRawShape>;
  /** The settings of a fresh install; must parse with `settingsSchema`. */
  defaults: TSettings;
  /** The secrets it needs, stored in the credential store, never in settings. */
  secrets?: readonly PluggableSecretSpec[];
  /**
   * Builds the instance. Called by the consuming slice with its context, the
   * parsed settings and a secret resolver.
   */
  build(input: PluggableBuildInput<TBuildContext, TSettings>): TInstance | Promise<TInstance>;
  /** The hosts an instance with these settings calls, for the Doctor's egress contributors. */
  egressHosts?: (settings: TSettings) => readonly string[];
}

/**
 * Whether each of an implementation's declared secrets has a stored value.
 *
 * @stability experimental
 */
export interface PluggableSecretPresence {
  /** Secret name to whether a value is stored. A missing name counts as `false`. */
  secrets: Record<string, boolean>;
}

/**
 * One pluggable kind: a registry of implementations plus the settings,
 * secrets and descriptor logic they share. Create it with
 * {@link definePluggableKind}.
 *
 * @typeParam TInstance - what an implementation builds.
 * @typeParam TBuildContext - what the consuming slice passes to `build`.
 *
 * @stability experimental
 */
export interface PluggableKind<TInstance, TBuildContext = object> {
  /** The kind id (`ai-provider`). Also names the registry: `pluggable.<kind>`. */
  readonly kind: string;
  /** The human label of the kind (`AI provider`). */
  readonly label: string;
  /**
   * Adds an implementation. Call it at import time, before the application
   * bootstraps (`apps/api/src/app-registrations/`).
   *
   * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
   */
  register(impl: PluggableImplementation<TInstance, TBuildContext, any>): void;
  /**
   * The implementation registered under `id`.
   *
   * @throws PluggableUnknownError when there is none; the message names the
   *   kind, the id and the registered ids.
   */
  get(id: string): PluggableImplementation<TInstance, TBuildContext, any>;
  /** Whether an implementation is registered under `id`. */
  has(id: string): boolean;
  /** Every registered id, in registration order. */
  ids(): string[];
  /** Every implementation, in registration order. */
  list(): readonly PluggableImplementation<TInstance, TBuildContext, any>[];
  /**
   * Validates one implementation's stored settings and fills its defaults.
   * `undefined` and `null` count as `{}`.
   *
   * @throws PluggableUnknownError for an unregistered id.
   * @throws PluggableSettingsError with the zod issues when the settings do not parse.
   */
  parseSettings(id: string, raw: unknown): Record<string, unknown>;
  /**
   * Merges a patch into a stored record `{ [id]: settings }` on WRITE. For each
   * patched id: an unregistered id is rejected, `null` removes the entry, and
   * anything else is merged over the stored entry (shallow) and parsed with that
   * implementation's schema, defaults filled. Entries the patch does not name,
   * including ones stored for implementations that are no longer registered,
   * are kept as they are.
   *
   * @throws PluggableUnknownError for an unregistered id in the patch.
   * @throws PluggableSettingsError when a patched entry does not parse.
   */
  mergeSettingsRecord(stored: Record<string, unknown>, patch: Record<string, unknown>): Record<string, Record<string, unknown>>;
  /**
   * Reads a stored record `{ [id]: settings }` on READ. An id that is no longer
   * registered is dropped with ONE `warn` call naming all of them; an entry
   * that no longer parses falls back to the implementation's defaults with one
   * `warn` call. Reading never throws on stored data, so removing a plugin
   * never bricks the settings row.
   */
  readSettingsRecord(stored: Record<string, unknown>, warn: (msg: string) => void): Record<string, Record<string, unknown>>;
  /**
   * Describes one implementation for a generated form: its non-secret fields
   * in declaration order, then one `secret` field per declared secret carrying
   * only whether a value is stored.
   *
   * @throws PluggableUnknownError for an unregistered id.
   */
  describe(id: string, presence: PluggableSecretPresence): PluggableDescriptor;
  /** Describes every implementation, in registration order. */
  describeAll(presence: (id: string) => PluggableSecretPresence): PluggableDescriptor[];
}

/**
 * Options of {@link definePluggableKind}.
 *
 * @stability experimental
 */
export interface DefinePluggableKindOptions {
  /** The kind id: `^[a-z][a-z0-9-]{1,47}$` (`ai-provider`). Must be unique across kinds. */
  kind: string;
  /** The human label of the kind (`AI provider`). */
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateImplementation(impl: PluggableImplementation<unknown, unknown, any>): void {
  if (typeof impl.label !== 'string' || impl.label.trim() === '') throw new Error('label must be a non-empty string');
  if (typeof impl.settingsSchema !== 'object' || impl.settingsSchema === null || typeof impl.settingsSchema.shape !== 'object') {
    throw new Error('settingsSchema must be a z.object(...)');
  }
  if (!isRecord(impl.defaults)) throw new Error('defaults must be an object');
  const seen = new Set<string>();
  for (const secret of impl.secrets ?? []) {
    if (typeof secret.name !== 'string' || secret.name.trim() === '') throw new Error('every secret needs a name');
    if (seen.has(secret.name)) throw new Error(`secret "${secret.name}" is declared twice`);
    seen.add(secret.name);
  }
}

/**
 * Defines a pluggable kind: a registry of implementations that each bring
 * their own settings schema, defaults, secrets and `build`. Call it once, at
 * module scope, in the file that owns the kind.
 *
 * Built on {@link defineRegistry}: the registry is named `pluggable.<kind>`, a
 * duplicate implementation id throws and the kind freezes once the application
 * has bootstrapped.
 *
 * @param options - the kind id and label.
 * @returns the kind.
 * @throws RegistryError `INVALID_ID` for a malformed kind id; `DUPLICATE_REGISTRY` when the kind is already defined.
 *
 * @example
 * ```ts
 * // apps/api/src/platform-extensions/core/greeter.kind.ts
 * export const greeterKind = definePluggableKind<Greeter>({ kind: 'greeter', label: 'Greeter' });
 *
 * // apps/api/src/app-registrations/core.ts
 * greeterKind.register({
 *   id: 'shouting',
 *   label: 'Shouting greeter',
 *   settingsSchema: z.object({ exclaim: z.boolean() }),
 *   defaults: { exclaim: true },
 *   build: ({ settings }) => ({ greet: async (name) => `HELLO ${name}${settings.exclaim ? '!' : ''}` }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function definePluggableKind<TInstance, TBuildContext = object>(
  options: DefinePluggableKindOptions,
): PluggableKind<TInstance, TBuildContext> {
  type Impl = PluggableImplementation<TInstance, TBuildContext, any>;
  const { kind, label } = options;

  if (!PLUGGABLE_ID_PATTERN.test(kind)) {
    throw new Error(`Invalid pluggable kind id ${JSON.stringify(kind)}: it must match ${PLUGGABLE_ID_PATTERN}.`);
  }
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Pluggable kind "${kind}": label must be a non-empty string.`);
  }

  const registry: Registry<Impl> = defineRegistry<Impl>({
    name: `pluggable.${kind}`,
    idOf: (impl) => impl.id,
    idPattern: PLUGGABLE_ID_PATTERN,
    validate: (impl) => validateImplementation(impl),
    describeDuplicate: (_existing, incoming) =>
      `Duplicate ${kind} implementation "${incoming.id}": an implementation with that id is already registered.`,
  });

  const get = (id: string): Impl => {
    const impl = registry.get(id);
    if (impl === undefined) throw new PluggableUnknownError(kind, id, registry.ids());
    return impl;
  };

  const parseSettings = (id: string, raw: unknown): Record<string, unknown> => {
    const impl = get(id);
    const supplied = raw === undefined || raw === null ? {} : raw;
    const candidate = isRecord(supplied) ? { ...impl.defaults, ...supplied } : supplied;
    const result = impl.settingsSchema.safeParse(candidate);
    if (!result.success) throw new PluggableSettingsError(kind, id, result.error.issues);
    return result.data as Record<string, unknown>;
  };

  const describe = (id: string, presence: PluggableSecretPresence): PluggableDescriptor => {
    const impl = get(id);
    const descriptor: PluggableDescriptor = {
      kind,
      id: impl.id,
      label: impl.label,
      fields: [
        ...describeConfigFields(impl.settingsSchema),
        ...(impl.secrets ?? []).map((secret) => ({
          name: secret.name,
          label: secret.label,
          ...(secret.help === undefined ? {} : { help: secret.help }),
          kind: 'secret' as const,
          hasValue: presence.secrets[secret.name] === true,
          required: secret.required,
        })),
      ],
    };
    if (impl.description !== undefined) descriptor.description = impl.description;
    return descriptor;
  };

  return {
    kind,
    label,
    register: (impl) => registry.register(impl),
    get,
    has: (id) => registry.has(id),
    ids: () => registry.ids(),
    list: () => registry.list(),
    parseSettings,

    mergeSettingsRecord(stored, patch) {
      const next: Record<string, Record<string, unknown>> = {};
      for (const [id, value] of Object.entries(stored)) {
        if (isRecord(value)) next[id] = value;
      }
      for (const [id, value] of Object.entries(patch)) {
        get(id);
        if (value === null) {
          delete next[id];
          continue;
        }
        if (!isRecord(value)) {
          throw new PluggableSettingsError(kind, id, [
            { code: 'custom', path: [], message: 'Expected an object of settings (or null to remove them).' },
          ]);
        }
        next[id] = parseSettings(id, { ...next[id], ...value });
      }
      return next;
    },

    readSettingsRecord(stored, warn) {
      const result: Record<string, Record<string, unknown>> = {};
      const unknown: string[] = [];
      for (const [id, value] of Object.entries(stored ?? {})) {
        if (!registry.has(id)) {
          unknown.push(id);
          continue;
        }
        try {
          result[id] = parseSettings(id, value);
        } catch (error) {
          if (!(error instanceof PluggableSettingsError)) throw error;
          warn(`Stored ${kind} settings for "${id}" no longer parse (${error.message}); using its defaults.`);
          result[id] = parseSettings(id, {});
        }
      }
      if (unknown.length > 0) {
        warn(
          `Ignoring stored ${kind} settings for ${unknown.map((id) => `"${id}"`).join(', ')}: ` +
            `no such implementation is registered (registered: ${registry.ids().join(', ') || '(none)'}).`,
        );
      }
      return result;
    },

    describe,
    describeAll: (presence) => registry.ids().map((id) => describe(id, presence(id))),
  };
}
