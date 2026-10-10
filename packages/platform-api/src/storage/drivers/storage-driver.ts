// =============================================================================
// Storage drivers: the `storage-driver` pluggable kind (PP-14.7, #925)
// =============================================================================
//
// A storage driver is the part of the storage slice that knows ONE kind of
// object store: how to build a `StorageProvider` for it, how to prove a
// configuration works, how to create its bucket or container, how to list what
// is in it. The slice itself (the objects API, profile images, exports, backups,
// the node object store) only ever talks to the `StorageProvider`; which driver
// built it, and with which settings and secrets, is runtime configuration an
// administrator edits at /admin/settings/storage.
//
//   definition   id + label + settingsSchema + defaults + secrets   (what a form needs)
//   operations   build / testConnection / provision / listKeys / purge   (what the slice calls)
//
// The three S3 flavours the platform ships (`s3`, `r2`, `s3compatible`)
// register through `registerStorageDriver` exactly as an app's driver does
// (`./builtin-storage-drivers.ts`): no private fast path, and no S3 code
// outside them.
//
// FRAMEWORK-LIGHT, AND A LEAF: this file imports the pluggable-kind primitive,
// the credential purpose registry and types. It must stay importable from the
// settings declaration and the config services without pulling an SDK in; the
// built-ins' SDK imports live in their own files.
// =============================================================================

import type { Logger } from '@nestjs/common';
import {
  STORAGE_DRIVER_ID_PATTERN,
  STORAGE_SECRET_FIELD_NAMES,
  type StorageBucketOutcome,
  type StorageBucketStep,
  type StorageBucketStepId,
  type StorageConnectionCheck,
} from '@marinoscar/platform-contract/storage';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import type { z } from 'zod';

import {
  definePluggableKind,
  type PluggableBuildInput,
  type PluggableImplementation,
  type PluggableKind,
  type PluggableSecretPresence,
  type PluggableSecretSpec,
} from '../../core/index';
import { credentialPurposeRegistry, registerCredentialPurpose } from '../../credentials/index';
import type { StorageProvider } from '../providers/storage-provider.interface';

/**
 * A driver's non-secret settings, as its `settingsSchema` parses them.
 *
 * @stability experimental
 */
export type StorageDriverSettings = Record<string, unknown>;

/**
 * What the slice passes to every driver call besides the driver's own
 * settings and secrets.
 *
 * @stability experimental
 */
export interface StorageDriverBuildContext {
  /** A logger scoped to the storage slice. Never log a secret through it. */
  logger: Logger;
  /** The multipart part size in bytes the deployment is configured for (`storage.partSize`). */
  partSize: number;
  /**
   * The deployment's own origin (`APP_URL`), for a driver that sets a CORS rule
   * on the bucket it provisions. Absent when the deployment has none.
   */
  appOrigin?: string;
}

/**
 * The argument of every driver operation: this driver's settings (parsed with
 * its `settingsSchema`, defaults filled), a resolver for the secrets it
 * declared, and the slice's context.
 *
 * `secret(name)` resolves one of the driver's DECLARED secrets for this call
 * and returns `null` when none is stored. Hold the value only for the call.
 *
 * @typeParam S - the driver's parsed settings.
 *
 * @stability experimental
 */
export type StorageDriverContext<S extends StorageDriverSettings = StorageDriverSettings> = PluggableBuildInput<
  StorageDriverBuildContext,
  S
>;

/**
 * The outcome of {@link StorageDriver.testConnection}.
 *
 * @stability experimental
 */
export interface StorageDriverTestResult {
  /** Whether the driver worked end to end. */
  ok: boolean;
  /**
   * One sentence an operator can act on, authored by the driver: what worked,
   * or what to change. NEVER carries secret material.
   */
  message: string;
  /** Small non-secret facts worth showing (a directory, a container, a region). */
  details?: Record<string, string | number | boolean>;
  /**
   * An optional per-step report. The S3 family reports four (`credentials`,
   * `bucket`, `roundTrip`, `presignedUrl`); a driver with no steps omits it.
   */
  checks?: readonly StorageConnectionCheck[];
}

/**
 * The outcome of {@link StorageDriver.provision}.
 *
 * @stability experimental
 */
export interface StorageDriverProvisionResult {
  /** Whether this call created the bucket or container (`false`: it already existed). */
  created: boolean;
  /** One sentence for the whole run. */
  message: string;
  /** The overall outcome when the driver distinguishes more than created/existing (S3: `partial`, `guided`, `failed`). */
  outcome?: StorageBucketOutcome;
  /** Per-step report (S3: create, public access block, encryption, CORS). */
  steps?: readonly StorageBucketStep[];
  /** Ready-to-paste instructions for when the credential may not create buckets. */
  guidance?: { reason: string; commands: string; runbook: string | null } | null;
  /** The CORS origin the driver allowed, when it set one. */
  corsOrigin?: string | null;
}

/**
 * Where a driver's objects live, for the admin view, the switch confirmation
 * and the rows that record where bytes went.
 *
 * @stability experimental
 */
export interface StorageDriverLocation {
  /**
   * The bucket, container or root directory name. Recorded on every object and
   * backup row (`storage_objects.bucket`) and shown beside the driver. Empty
   * means "not configured".
   */
  bucket: string;
  /** The origin the driver talks to, or `null` for the SDK's own default host. */
  endpoint?: string | null;
  /** The region, when the backend has one. */
  region?: string;
}

/**
 * One prefix's tally from {@link StorageDriver.purge}.
 *
 * @stability experimental
 */
export interface StorageDriverPurgePrefixReport {
  /** The prefix. */
  prefix: string;
  /** Objects (or object versions) found under it. */
  objects: number;
  /** Their total size in bytes (0 when the backend does not say). */
  bytes: number;
}

/**
 * What {@link StorageDriver.purge} returns.
 *
 * @stability experimental
 */
export interface StorageDriverPurgeResult {
  /** Bucket versioning, for backends that have it; `unversioned` otherwise. */
  versioning: 'enabled' | 'suspended' | 'unversioned' | 'unknown';
  /** One report per prefix, in the order given. */
  prefixes: StorageDriverPurgePrefixReport[];
  /** How many objects (or versions) were deleted; 0 on a dry run. */
  deleted: number;
}

/**
 * The operations of a storage driver. Every method receives the same
 * {@link StorageDriverContext}, so a driver is a plain object with no state of
 * its own.
 *
 * @typeParam S - the driver's parsed settings.
 *
 * @example
 * ```ts
 * const driver: StorageDriver<{ directory: string }> = {
 *   build: ({ settings }) => new LocalFsProvider(settings.directory),
 *   testConnection: async ({ settings }) => ({ ok: true, message: `Writable: ${settings.directory}` }),
 * };
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface StorageDriver<S extends StorageDriverSettings = StorageDriverSettings> {
  /**
   * Builds the runtime provider the whole slice uses. Called when the
   * configuration (settings or secrets) changes, not per request; the provider
   * is reused until then, and `destroy()` is called on it when it is superseded
   * (when it has one).
   */
  build(ctx: StorageDriverContext<S>): StorageProvider | Promise<StorageProvider>;
  /**
   * The admin page's "Test connection". NEVER THROWS: a refused request is a
   * successful diagnosis, so every failure is `{ ok: false, message }`. Never
   * returns secret material, not even inside `message` or `details`: redact
   * anything an SDK error echoes back.
   */
  testConnection(ctx: StorageDriverContext<S>): Promise<StorageDriverTestResult>;
  /**
   * Creates the bucket or container (and anything the slice needs on it).
   * Omit it for a backend with no such concept. Safe to repeat.
   */
  provision?(ctx: StorageDriverContext<S>): Promise<StorageDriverProvisionResult>;
  /**
   * Lists every object key under `prefix`, for `npm run storage:purge`. A driver
   * that defines it can be purged generically (list, then `delete` each key).
   */
  listKeys?(ctx: StorageDriverContext<S>, prefix: string): AsyncIterable<string>;
  /**
   * A purge the driver does itself, for backends whose purge is not "list and
   * delete" (S3 versioned buckets also need every version and delete marker
   * removed). Takes precedence over `listKeys`. With `dryRun` it only counts.
   * `client` is a pre-built client of the driver's own kind, for tests.
   */
  purge?(
    ctx: StorageDriverContext<S>,
    input: { prefixes: readonly string[]; dryRun: boolean; client?: unknown },
  ): Promise<StorageDriverPurgeResult>;
  /** The region used when the settings state none, if the backend has regions. */
  defaultRegion?: string;
  /**
   * Where this configuration points. Default: `settings.bucket` when it is a
   * string, else the driver id. Pure: reads nothing.
   */
  location?(settings: S): StorageDriverLocation;
  /**
   * The names of the settings and secrets this configuration still needs,
   * `[]` when complete. `secrets` says which of the driver's declared secrets
   * are stored. Default: every `required` declared secret that is absent.
   * Pure: no I/O, and the names are shown to operators, never values.
   */
  missing?(settings: S, secrets: Readonly<Record<string, boolean>>): string[];
}

/**
 * What an app or package registers with {@link registerStorageDriver}: the
 * driver's definition (what an admin form needs) and its operations.
 *
 * @typeParam S - the driver's parsed settings.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface StorageDriverDefinition<S extends StorageDriverSettings = StorageDriverSettings> extends StorageDriver<S> {
  /**
   * The driver id, `^[a-z][a-z0-9-]{1,47}$`. Permanent once a setting, a secret
   * or an object row exists under it: it is the key of `storage.drivers`, the
   * value of `storage.provider`, `StorageProvider.kind` and the
   * `storage_objects.storage_provider` of every object it stored.
   */
  id: string;
  /** The human label the admin page shows (`Local filesystem`). */
  label: string;
  /** One sentence on what the driver is. */
  description?: string;
  /**
   * The driver's own NON-SECRET settings (`z.object`). `.describe('help')`
   * becomes a field's help text and `.meta({ label })` its label in the
   * generated form. A field may not be named like a secret (`secretAccessKey`,
   * `apiKey`, `token`, `password`, ...): declare it in {@link secrets}.
   */
  settingsSchema: z.ZodObject<z.ZodRawShape>;
  /** The settings of a fresh install; must parse with `settingsSchema`. An unconfigured driver is complete only when `missing` says so. */
  defaults: S;
  /**
   * The secrets the driver needs (an account key, a connection string, a service
   * account), kept encrypted in the credential store, never in settings and
   * never in an environment variable. By default each lives in the credential
   * purpose `storage_<id>` under the secret's own name; the purpose is
   * registered for you.
   */
  secrets?: readonly PluggableSecretSpec[];
  /**
   * Where the driver's secrets live when it must not use `storage_<id>` (the
   * built-in S3 family keeps its secret access key at `(storage, default)`).
   * The purpose is then the caller's to register. `label` is the non-secret
   * label stored beside the credential (default: the secret's declared label).
   */
  credentialAddress?(secretName: string): { purpose: string; name: string; label?: string };
  /** The hosts an instance with these settings calls, for the Doctor's network-egress view. Empty for a local backend. */
  egressHosts?(settings: S): readonly string[];
}

/**
 * The `storage-driver` pluggable kind. Its instances are the definitions
 * themselves. Use {@link registerStorageDriver} and the helpers below rather
 * than the kind directly.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const storageDriverKind: PluggableKind<StorageDriverDefinition<any>> = definePluggableKind<
  StorageDriverDefinition<any>
>({
  kind: 'storage-driver',
  label: 'Storage driver',
});

const SECRET_LOOKING_FIELDS: ReadonlySet<string> = new Set(
  ['secretAccessKey', 'secretKey', 'sessionToken', 'secret', 'password', 'apiKey', 'apiKeys', 'key', 'token', 'privateKey', ...STORAGE_SECRET_FIELD_NAMES].map((name) =>
    name.toLowerCase(),
  ),
);

/**
 * Human labels for the four bucket-provisioning steps, sent in the response so
 * a client need not carry them.
 *
 * @stability experimental
 */
export const STORAGE_BUCKET_STEP_LABELS: Record<StorageBucketStepId, string> = {
  create: 'Create the bucket',
  publicAccessBlock: 'Block all public access',
  encryption: 'Enable default encryption at rest',
  cors: 'Apply the CORS rule browsers need',
};

/** The credential purpose a driver's secrets use by default. */
export function storageDriverCredentialPurpose(id: string): string {
  return `storage_${id}`;
}

function assertValidDefinition(def: StorageDriverDefinition<any>): void {
  const where = `Storage driver "${def.id}"`;

  if (typeof def.id !== 'string' || !STORAGE_DRIVER_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid storage driver id ${JSON.stringify(def.id)}: it must match ${STORAGE_DRIVER_ID_PATTERN}.`);
  }
  if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error(`${where}: label must be a non-empty string.`);
  for (const operation of ['build', 'testConnection'] as const) {
    if (typeof def[operation] !== 'function') throw new Error(`${where}: ${operation} must be a function.`);
  }
  for (const operation of ['provision', 'listKeys', 'purge', 'location', 'missing', 'egressHosts', 'credentialAddress'] as const) {
    if (def[operation] !== undefined && typeof def[operation] !== 'function') throw new Error(`${where}: ${operation} must be a function.`);
  }
  if (typeof def.settingsSchema !== 'object' || def.settingsSchema === null || typeof def.settingsSchema.shape !== 'object') {
    throw new Error(`${where}: settingsSchema must be a z.object(...).`);
  }
  for (const field of Object.keys(def.settingsSchema.shape)) {
    if (SECRET_LOOKING_FIELDS.has(field.toLowerCase())) {
      throw new Error(
        `${where}: settingsSchema declares "${field}", which looks like a secret. A secret is never a setting: ` +
          'declare it in `secrets`; it is stored encrypted in the credential store.',
      );
    }
  }
  const parsedDefaults = def.settingsSchema.safeParse(def.defaults);
  if (!parsedDefaults.success) {
    throw new Error(
      `${where}: defaults do not parse with settingsSchema: ` +
        parsedDefaults.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    );
  }
}

/**
 * Registers a storage driver. Call it at import time, before the application
 * bootstraps (the reference app does it from
 * `apps/api/src/app-registrations/storage.ts`, which `platform/storage/storage.config.ts`
 * imports first). The three built-in S3 drivers register through this same
 * function.
 *
 * Registering is all it takes: the `storage` settings namespace gains a
 * `drivers.<id>` record validated by the driver's `settingsSchema`,
 * `GET /api/admin/storage-config` describes it (`descriptors`, and a generated
 * form on the admin page), its secrets get a credential purpose
 * (`storage_<id>`) unless `credentialAddress` names one, and once an
 * administrator selects it, every consumer of `STORAGE_PROVIDER` (the objects
 * API, profile images, exports, backups, the node object store) uses the
 * provider it builds.
 *
 * @param def - the driver.
 * @throws Error when the definition is malformed (an id that does not match the pattern, a secret-looking settings field, defaults that do not parse, a missing operation).
 * @throws RegistryError `DUPLICATE_ID` when the id is registered, `FROZEN` after the application bootstrapped.
 *
 * @example
 * ```ts
 * registerStorageDriver({
 *   id: 'local-fs',
 *   label: 'Local filesystem',
 *   settingsSchema: z.object({ directory: z.string().describe('Directory the objects are written under') }),
 *   defaults: { directory: '' },
 *   build: ({ settings }) => new LocalFsStorageProvider(settings.directory),
 *   testConnection: async ({ settings }) => ({ ok: true, message: `Writable: ${settings.directory}` }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerStorageDriver<S extends StorageDriverSettings>(def: StorageDriverDefinition<S>): void {
  assertValidDefinition(def);

  const secrets = def.secrets ?? [];
  const purpose = storageDriverCredentialPurpose(def.id);
  const ownsPurpose = secrets.length > 0 && def.credentialAddress === undefined;
  if (ownsPurpose && credentialPurposeRegistry.has(purpose)) {
    throw new Error(`Storage driver "${def.id}": the credential purpose "${purpose}" is already registered by another owner. Pick another driver id.`);
  }

  const implementation: PluggableImplementation<StorageDriverDefinition<any>, object> = {
    id: def.id,
    label: def.label,
    ...(def.description === undefined ? {} : { description: def.description }),
    settingsSchema: def.settingsSchema,
    defaults: def.defaults,
    secrets,
    build: () => def,
    ...(def.egressHosts === undefined ? {} : { egressHosts: def.egressHosts as (settings: Record<string, unknown>) => readonly string[] }),
  };

  storageDriverKind.register(implementation);

  if (ownsPurpose) {
    registerCredentialPurpose({ purpose, owner: 'storage', label: `${def.label} secrets`, tiers: ['system'] });
  }
}

/**
 * Every registered storage driver, in registration order (the built-ins first;
 * the order the admin page lists them).
 *
 * @stability experimental
 */
export function storageDriverDefinitions(): readonly StorageDriverDefinition<any>[] {
  return storageDriverKind.list().map((impl) => definitionOf(impl));
}

/**
 * The ids of every registered storage driver, in registration order.
 *
 * @stability experimental
 */
export function storageDriverIds(): string[] {
  return storageDriverKind.ids();
}

/**
 * The driver registered under `id`, or `undefined`.
 *
 * @param id - the driver id.
 * @stability experimental
 */
export function getStorageDriver(id: string): StorageDriverDefinition<any> | undefined {
  return storageDriverKind.has(id) ? definitionOf(storageDriverKind.get(id)) : undefined;
}

/**
 * The driver registered under `id`.
 *
 * @param id - the driver id.
 * @throws PluggableUnknownError when none is registered; the message names the registered ids.
 * @stability experimental
 */
export function requireStorageDriver(id: string): StorageDriverDefinition<any> {
  return definitionOf(storageDriverKind.get(id));
}

function definitionOf(impl: PluggableImplementation<StorageDriverDefinition<any>, object, any>): StorageDriverDefinition<any> {
  return impl.build({ settings: {}, secret: async () => null }) as StorageDriverDefinition<any>;
}

/**
 * Where `driver`'s secret `name` lives in the credential store.
 *
 * @param driver - a registered driver.
 * @param name - one of the secrets it declares.
 * @returns the `(purpose, name)` address.
 * @stability experimental
 */
export function storageSecretAddress(
  driver: Pick<StorageDriverDefinition<any>, 'id' | 'credentialAddress'>,
  name: string,
): { purpose: string; name: string; label?: string } {
  return driver.credentialAddress ? driver.credentialAddress(name) : { purpose: storageDriverCredentialPurpose(driver.id), name };
}

/**
 * The descriptor of every registered driver for a generated form: its
 * non-secret fields, then one write-only `secret` field per declared secret
 * carrying only whether a value is stored.
 *
 * @param presence - which of a driver's secrets are stored.
 * @stability experimental
 */
export function describeStorageDrivers(presence: (id: string) => PluggableSecretPresence): PluggableDescriptor[] {
  return storageDriverKind.describeAll(presence);
}

/**
 * The names of a driver's still-missing settings and secrets
 * ({@link StorageDriver.missing}, or every required secret that is absent).
 *
 * @param driver - a registered driver.
 * @param settings - its parsed settings.
 * @param present - which of its declared secrets are stored.
 * @stability experimental
 */
export function missingStorageFields(
  driver: StorageDriverDefinition<any>,
  settings: StorageDriverSettings,
  present: Readonly<Record<string, boolean>>,
): string[] {
  if (driver.missing) return driver.missing(settings, present);
  return (driver.secrets ?? []).filter((secret) => secret.required && present[secret.name] !== true).map((secret) => secret.name);
}

/**
 * Where `driver`'s objects live for these settings ({@link StorageDriver.location}, or the `bucket` setting).
 *
 * @param driver - a registered driver.
 * @param settings - its parsed settings.
 * @stability experimental
 */
export function storageLocationOf(driver: StorageDriverDefinition<any>, settings: StorageDriverSettings): StorageDriverLocation {
  if (driver.location) return driver.location(settings);
  return { bucket: typeof settings.bucket === 'string' ? settings.bucket : driver.id };
}
