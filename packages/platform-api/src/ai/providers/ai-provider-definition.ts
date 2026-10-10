// =============================================================================
// AI provider definitions: the `ai-provider` pluggable kind (PP-14.6, #924)
// =============================================================================
//
// An AI provider is two things. The ADAPTER (`AiProviderAdapter`) talks to the
// provider's API and registers itself in `AiProviderRegistry` from a Nest
// module's `onModuleInit`. The DEFINITION (this file) is what the rest of the
// slice needs to KNOW about the provider before any adapter runs: its id and
// label, the Nest module that provides the adapter, the shape of its
// non-secret settings, whether it needs a key and an endpoint, and which SDK
// packages it may import. The admin settings page, the `ai` settings
// namespace, the key routes and the conformance suites are all driven by the
// definitions, so adding a provider needs no edit to any of them.
//
// The five built-in providers register through `registerAiProvider` exactly as
// an app's provider does (`./builtin-ai-providers.ts`): no private fast path.
//
// FRAMEWORK-LIGHT, AND A LEAF: this file imports only the pluggable-kind
// primitive, zod and the id pattern. It must stay importable from the
// settings declaration and the config services without pulling a provider
// module (and its SDK) in; the built-ins' module imports live in
// `builtin-ai-providers.ts`.
// =============================================================================

import type { Type } from '@nestjs/common';
import { AI_PROVIDER_ID_PATTERN } from '@marinoscar/platform-contract/ai';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

import { definePluggableKind, type PluggableImplementation, type PluggableKind } from '../../core/pluggable/index';

/**
 * What an app or package tells the AI slice about a provider it adds.
 *
 * Register it with {@link registerAiProvider}, at import time and before
 * `AiModule.forRoot()` is called, then list its module through the definition
 * (`AiModule.forRoot` imports every registered definition's `module`, or the
 * ids named in its `providers` option).
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/ai.ts
 * registerAiProvider({
 *   id: 'example-transcribe',
 *   label: 'Example Transcribe',
 *   module: ExampleTranscribeModule,
 *   settingsSchema: z.object({ region: z.enum(['us', 'eu']).default('us').describe('Processing region') }),
 *   defaults: { region: 'us' },
 *   requiresKey: true,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface AiProviderDefinition {
  /**
   * The provider id, `^[a-z][a-z0-9-]{1,47}$`. Permanent once a setting, a
   * key or a usage row exists under it: it is the key of `ai.providers`, the
   * credential name of the deployment's key, `UserAiKey.provider` and the
   * provider part of an `ai.limits.perModel` key. It must equal the `id` of
   * the adapter the module registers.
   */
  id: string;
  /** The human label the admin pages show (`Example Transcribe`). */
  label: string;
  /** One sentence on what the provider is. */
  description?: string;
  /**
   * The Nest module whose provider registers the `AiProviderAdapter` in
   * `onModuleInit`, as the built-in provider modules do. It should import
   * `AiCoreModule` to inject `AiProviderRegistry`.
   */
  module: Type<unknown>;
  /**
   * The provider's own NON-SECRET settings, stored beside `enabled` in
   * `ai.providers.<id>`. The built-ins' schemas are their current fields
   * (`baseUrl`, `apiVersion`, ...). `.describe('help')` becomes the field's
   * help text and `.meta({ label })` its label in the generated form. A field
   * may not be named like a secret (`apiKey`, `key`, `token`, `password`,
   * `secret`, ...): a key lives in the credential stores, never in settings,
   * and not named `enabled` or `hasKey`.
   */
  settingsSchema: z.ZodObject<z.ZodRawShape>;
  /** The provider's settings on a fresh install (without `enabled`, which starts `false`). Must parse with `settingsSchema`. */
  defaults: Record<string, unknown>;
  /**
   * Whether a call needs an API key. `false` is a provider that authenticates
   * some other way (a key-less self-hosted server): its calls resolve with
   * `keySource: 'none'` and no user needs a key. `true` makes the admin page
   * show a write-only key field.
   */
  requiresKey: boolean;
  /**
   * Whether the provider cannot be enabled before `settings.baseUrl` is set
   * (a provider with no default host: an Azure resource, a self-hosted
   * server). `settingsSchema` must then declare `baseUrl`.
   */
  requiresBaseUrl?: boolean;
  /** Help the admin page shows beside the key and the endpoint field. */
  help?: {
    /** Under the key field. */
    key?: string;
    /** Under the endpoint (`baseUrl`) field. */
    baseUrl?: string;
  };
  /**
   * The npm packages the provider's adapter may import (`['assemblyai']`). The
   * `ai-no-sdk-leak` conformance suite bans every registered package outside
   * the directories passed as its `providerDirs` option, so an app-side
   * adapter folder may import its SDK and nothing else may.
   */
  sdkPackages?: readonly string[];
}

/** Settings field names an `ai.providers.<id>` slot may never carry (a key is not a setting). */
const SECRET_LOOKING_FIELDS: ReadonlySet<string> = new Set(
  ['secretAccessKey', 'secretKey', 'sessionToken', 'secret', 'password', 'apiKey', 'apiKeys', 'key', 'token'].map((name) =>
    name.toLowerCase(),
  ),
);

/** Fields the slot owns, not the provider. */
const RESERVED_FIELDS: ReadonlySet<string> = new Set(['enabled', 'haskey']);

/**
 * The name of the one secret every keyed provider declares (the deployment's
 * key, stored by `PUT /api/admin/ai/providers/:provider/key`).
 *
 * @stability experimental
 */
export const AI_PROVIDER_KEY_SECRET = 'apiKey';

/**
 * The `ai-provider` pluggable kind. Its instances are the definitions
 * themselves; a slot is `{ enabled } & settings`, so the implementation
 * registered in the kind has `enabled` as its first settings field. Use
 * {@link registerAiProvider} and the helpers below rather than the kind
 * directly.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiProviderKind: PluggableKind<AiProviderDefinition> = definePluggableKind<AiProviderDefinition>({
  kind: 'ai-provider',
  label: 'AI provider',
});

function isConstructor(value: unknown): boolean {
  return typeof value === 'function';
}

function assertValidDefinition(def: AiProviderDefinition): void {
  const where = `AI provider "${def.id}"`;

  if (typeof def.id !== 'string' || !AI_PROVIDER_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid AI provider id ${JSON.stringify(def.id)}: it must match ${AI_PROVIDER_ID_PATTERN}.`);
  }
  if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error(`${where}: label must be a non-empty string.`);
  if (!isConstructor(def.module)) throw new Error(`${where}: module must be the Nest module class that registers the adapter.`);
  if (typeof def.requiresKey !== 'boolean') throw new Error(`${where}: requiresKey must be a boolean.`);
  if (typeof def.settingsSchema !== 'object' || def.settingsSchema === null || typeof def.settingsSchema.shape !== 'object') {
    throw new Error(`${where}: settingsSchema must be a z.object(...).`);
  }

  for (const field of Object.keys(def.settingsSchema.shape)) {
    const lowered = field.toLowerCase();
    if (RESERVED_FIELDS.has(lowered)) {
      throw new Error(`${where}: settingsSchema may not declare "${field}": the slot owns it.`);
    }
    if (SECRET_LOOKING_FIELDS.has(lowered)) {
      throw new Error(
        `${where}: settingsSchema declares "${field}", which looks like a secret. A key is never a setting: ` +
          'set requiresKey and the key is stored encrypted by PUT /api/admin/ai/providers/:provider/key.',
      );
    }
  }
  if (def.requiresBaseUrl === true && !('baseUrl' in def.settingsSchema.shape)) {
    throw new Error(`${where}: requiresBaseUrl is set but settingsSchema declares no "baseUrl" field.`);
  }
  if (def.sdkPackages !== undefined && !(Array.isArray(def.sdkPackages) && def.sdkPackages.every((p) => typeof p === 'string' && p !== ''))) {
    throw new Error(`${where}: sdkPackages must be an array of package names.`);
  }
}

/** The slot schema: `enabled` first, then the provider's own fields. */
function slotSchemaOf(def: AiProviderDefinition): z.ZodObject<z.ZodRawShape> {
  return z.object({
    enabled: z.boolean().meta({ label: 'Enabled' }).describe('Switch the provider on for this deployment.'),
    ...def.settingsSchema.shape,
  });
}

/**
 * Registers an AI provider. Call it at import time, before the application
 * bootstraps and before `AiModule.forRoot()` is called (the reference app does
 * it from `apps/api/src/app-registrations/ai.ts`, which `platform/ai/ai.config.ts`
 * imports first). The five built-in providers register through this same
 * function.
 *
 * Registering is all it takes: the `ai` settings namespace gains a slot for the
 * id, `GET /api/admin/ai/config` describes it (`descriptors`, and a
 * generated form on the admin page), the key routes and the user-key and
 * organization-key pages list it, and `AiModule.forRoot` imports its module.
 *
 * @param def - the provider.
 * @throws Error when the definition is malformed (an id that does not match the pattern, a secret-looking settings field, a default that does not parse).
 * @throws RegistryError `DUPLICATE_ID` when the id is registered, `FROZEN` after the application bootstrapped.
 *
 * @example
 * ```ts
 * registerAiProvider({
 *   id: 'example-transcribe',
 *   label: 'Example Transcribe',
 *   module: ExampleTranscribeModule,
 *   settingsSchema: z.object({ region: z.enum(['us', 'eu']).default('us').describe('Processing region') }),
 *   defaults: { region: 'us' },
 *   requiresKey: true,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiProvider(def: AiProviderDefinition): void {
  assertValidDefinition(def);

  const slot = slotSchemaOf(def);
  const defaults = { enabled: false, ...def.defaults };
  const parsedDefaults = slot.safeParse(defaults);
  if (!parsedDefaults.success) {
    throw new Error(
      `AI provider "${def.id}": defaults do not parse with settingsSchema: ` +
        parsedDefaults.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    );
  }

  const implementation: PluggableImplementation<AiProviderDefinition, object> = {
    id: def.id,
    label: def.label,
    ...(def.description === undefined ? {} : { description: def.description }),
    settingsSchema: slot,
    defaults: parsedDefaults.data as Record<string, unknown>,
    secrets: def.requiresKey ? [{ name: AI_PROVIDER_KEY_SECRET, label: 'API key', required: true, ...(def.help?.key ? { help: def.help.key } : {}) }] : [],
    build: () => def,
  };

  aiProviderKind.register(implementation);
}

/**
 * Every registered AI provider definition, in registration order (the order
 * the admin page lists them: the built-ins first).
 *
 * @stability experimental
 */
export function aiProviderDefinitions(): readonly AiProviderDefinition[] {
  return aiProviderKind.list().map((impl) => definitionOfImplementation(impl));
}

/**
 * The definition registered under `id`, or `undefined`.
 *
 * @param id - the provider id.
 * @stability experimental
 */
export function getAiProviderDefinition(id: string): AiProviderDefinition | undefined {
  return aiProviderKind.has(id) ? definitionOfImplementation(aiProviderKind.get(id)) : undefined;
}

/**
 * The definition registered under `id`.
 *
 * @param id - the provider id.
 * @throws PluggableUnknownError when none is registered; the message names the registered ids and how to register one.
 * @stability experimental
 */
export function requireAiProviderDefinition(id: string): AiProviderDefinition {
  return definitionOfImplementation(aiProviderKind.get(id));
}

function definitionOfImplementation(impl: PluggableImplementation<AiProviderDefinition, object, any>): AiProviderDefinition {
  return impl.build({ settings: {}, secret: async () => null }) as AiProviderDefinition;
}

/**
 * One provider's slot in `ai.providers`: the `enabled` switch and the
 * provider's own non-secret settings.
 *
 * @stability experimental
 */
export interface AiProviderSlotValue {
  /** Whether an administrator switched the provider on. */
  enabled: boolean;
  /** The provider's own settings, as its `settingsSchema` declares them. */
  [setting: string]: unknown;
}

/**
 * A fresh slot for `id`: `enabled: false` and the provider's defaults.
 *
 * @param id - a registered provider id.
 * @throws PluggableUnknownError when `id` is not registered.
 * @stability experimental
 */
export function defaultAiProviderSlot(id: string): AiProviderSlotValue {
  return structuredClone(aiProviderKind.parseSettings(id, {})) as AiProviderSlotValue;
}

/**
 * The descriptor of one registered provider for a generated form: its
 * `enabled` switch and settings fields, then (when it needs a key) a
 * write-only `apiKey` secret field that carries only whether a key is stored.
 *
 * @param id - a registered provider id.
 * @param hasKey - whether the deployment stores a key for it.
 * @throws PluggableUnknownError when `id` is not registered.
 * @stability experimental
 */
export function describeAiProvider(id: string, hasKey: boolean): PluggableDescriptor {
  return aiProviderKind.describe(id, { secrets: { [AI_PROVIDER_KEY_SECRET]: hasKey } });
}

/**
 * The settings field names `id`'s slot accepts besides `enabled`; empty for an
 * id with no definition.
 *
 * @param id - the provider id.
 * @stability experimental
 */
export function aiProviderSettingsFields(id: string): string[] {
  const def = getAiProviderDefinition(id);
  return def ? Object.keys(def.settingsSchema.shape) : [];
}
