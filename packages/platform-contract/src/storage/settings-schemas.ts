// =============================================================================
// Storage: the `storage` system-settings namespace's schemas (issue #736)
// =============================================================================
//
// PP-14.7 (#925): THE NAMESPACE STORES `provider` (a driver id, any
// `STORAGE_DRIVER_ID_PATTERN` string) AND `drivers` (a record of each driver's
// own non-secret settings, validated by that driver in the API). The six flat
// fields the namespace used to store (`bucket` ... `forcePathStyle`) survive
// as a deprecated READ VIEW of the active built-in driver and as accepted
// aliases on PUT and PATCH, so no existing client, script or row breaks.
//
// The five schemas the namespace declaration of
// `@marinoscar/platform-api/storage` (`STORAGE_SYSTEM_SETTINGS`) is built
// from: the stored value and its partial, the PUT and PATCH wire branches,
// and the GET response branch (moved from the reference app's
// `common/schemas/settings.schema.ts` by #736, which re-exports them).
//
// THE SECRET ACCESS KEY IS NOT HERE, AND MUST NEVER BE ADDED: it lives in the
// encrypted credential store at `(purpose 'storage', name 'default')`.
// `StorageSettingsCarriesNoSecret` at the bottom fails to compile the moment a
// secret-named field is added.
// =============================================================================

import { z } from 'zod';

import { STORAGE_DRIVER_ID_PATTERN, STORAGE_SECRET_FIELD_NAMES } from './constants.js';

/**
 * A storage driver id: any string matching {@link STORAGE_DRIVER_ID_PATTERN}.
 * Not an enum: an app registers drivers (`registerStorageDriver`), and the API
 * validates the id against the registry.
 *
 * @extensionPoint option
 * @stability experimental
 */
export const storageDriverIdSchema = z.string().regex(STORAGE_DRIVER_ID_PATTERN);

/**
 * One driver's non-secret settings as stored: whatever that driver's
 * `settingsSchema` declares. The contract cannot see the registry, so it
 * checks the shape (a record) and the API validates each entry with the
 * driver that owns it.
 *
 * @stability experimental
 */
export const storageDriverSettingsSchema = z.record(z.string(), z.unknown());

/**
 * The `drivers` record: driver id to that driver's settings.
 *
 * @stability experimental
 */
export const storageDriversSchema = z.record(storageDriverIdSchema, storageDriverSettingsSchema);

/**
 * The `drivers` record of a PATCH: `null` removes a driver's stored settings
 * (back to its defaults), an object is merged over them.
 *
 * @stability experimental
 */
export const storageDriversPatchSchema = z.record(storageDriverIdSchema, storageDriverSettingsSchema.nullable());

/**
 * Object-storage configuration (`storage`).
 *
 * `provider` is the id of the active driver; `drivers` holds every driver's own
 * non-secret settings (`drivers.s3.bucket`, `drivers.local-fs.directory`, ...).
 * "Not configured" is a driver whose settings are incomplete (the built-ins:
 * `bucket === ''`), never a missing block, exactly as before drivers were
 * pluggable.
 *
 * The six trailing fields are the DEPRECATED FLAT VIEW (`bucket`, `region`,
 * `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`): optional here so a
 * row written by an earlier release still reads (the API's read adapter folds
 * them into `drivers.<provider>`), and filled on read from the active built-in
 * driver's settings so existing readers of `GET /api/system-settings` see what
 * they saw. They are never written by the API; a write stores `provider` and
 * `drivers` only. Their semantics are the built-in drivers':
 *
 *  - `bucket` empty means not configured; `region` empty means not stated (R2
 *    wants `auto`); `endpoint` empty means "derive it, or use the SDK's host"
 *    and an explicit value always wins; `accountId` is R2 only;
 *  - `forcePathStyle` is TRI-STATE, `null` meaning "use this vendor's
 *    convention" (path style for `s3compatible`, virtual-host for `s3` and
 *    `r2`).
 *
 * NO `.default()` ON ANY FIELD: the defaults live in the namespace declaration
 * (`STORAGE_SYSTEM_SETTINGS`) and nowhere else.
 *
 * NO SECRET, EVER: a driver's secrets are declared by the driver and stored in
 * the encrypted credential store. `StorageSettingsCarriesNoSecret` below fails
 * to compile if a secret-named field is added.
 *
 * @stability experimental
 */
export const systemStorageSchema = z.object({
  /** The id of the active storage driver (`s3`, `r2`, `s3compatible`, or a registered one). */
  provider: storageDriverIdSchema,
  /** Every registered driver's own settings, keyed by driver id. */
  drivers: storageDriversSchema,
  /** @deprecated Read view of `drivers.<provider>.bucket` (built-ins). */
  bucket: z.string().trim().max(255).optional(),
  /** @deprecated Read view of `drivers.<provider>.region` (built-ins). */
  region: z.string().trim().max(255).optional(),
  /** @deprecated Read view of `drivers.<provider>.endpoint` (built-ins). */
  endpoint: z.string().trim().max(512).optional(),
  /** @deprecated Read view of `drivers.<provider>.accountId` (built-ins). */
  accountId: z.string().trim().max(255).optional(),
  /** @deprecated Read view of `drivers.<provider>.accessKeyId` (built-ins). An identifier, never the secret. */
  accessKeyId: z.string().trim().max(255).optional(),
  /** @deprecated Read view of `drivers.<provider>.forcePathStyle` (built-ins). Tri-state. */
  forcePathStyle: z.boolean().nullable().optional(),
});

/**
 * The stored `storage` namespace value, inferred.
 *
 * @stability experimental
 */
export type SystemStorageValue = z.infer<typeof systemStorageSchema>;

/**
 * `storage`, one level deep: the canonical partial. Every field optional; an
 * empty string in a flat field is a meaningful value (it clears the field), so
 * the merge uses `??`, and `forcePathStyle` is the one nullable field (absent
 * leaves it alone, `null` restores the vendor convention).
 *
 * @stability experimental
 */
export const systemStoragePatchSchema = z.object({
  /** The id of the active storage driver. */
  provider: storageDriverIdSchema.optional(),
  /** Driver settings to merge, per driver id; `null` removes a driver's stored settings. */
  drivers: storageDriversPatchSchema.optional(),
  /** Alias of `drivers.<provider>.bucket` (built-ins); empty means not configured. */
  bucket: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.region` (built-ins); `auto` for R2. */
  region: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.endpoint` (built-ins); empty means derive it (R2) or use the SDK's host. */
  endpoint: z.string().trim().max(512).optional(),
  /** Alias of `drivers.<provider>.accountId` (built-ins, R2 only). */
  accountId: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.accessKeyId` (built-ins): an identifier, never the secret. */
  accessKeyId: z.string().trim().max(255).optional(),
  /**
   * Alias of `drivers.<provider>.forcePathStyle` (built-ins). `.nullable().optional()`
   * means two different things, and both are wanted: absent is "leave it alone",
   * explicit `null` is "go back to this vendor's convention".
   */
  forcePathStyle: z.boolean().nullable().optional(),
});

// =============================================================================
// Storage configuration on the wire (#373, epic #372; drivers: PP-14.7)
// =============================================================================
//
// These are the OpenAPI-visible request schemas. Optional in the PUT body like
// the operations namespaces, and for the identical reason: the block ships
// ahead of every client that knows it exists.
//
// NO `secretAccessKey` FIELD, ON EITHER SCHEMA, EVER. A driver's secrets are
// written through the credential store, not through this document: accepting
// one here would put it in the request body of an endpoint whose audit rows
// record the full merged value, and in the response of the GET that follows.

/**
 * The `storage` branch of the `PUT /api/system-settings` body (no secret, ever).
 * Send `provider` and `drivers`; the six flat fields are accepted as aliases of
 * `drivers.<provider>` for clients written before drivers were pluggable.
 *
 * @stability experimental
 */
export const storageSettingsSchema = z.object({
  /** The id of the active storage driver. */
  provider: storageDriverIdSchema,
  /** Every driver's own settings, keyed by driver id. */
  drivers: storageDriversSchema.optional(),
  /** Alias of `drivers.<provider>.bucket` (built-ins); empty means not configured. */
  bucket: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.region` (built-ins); `auto` for R2. */
  region: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.endpoint` (built-ins); empty means derive it (R2) or use the SDK's host. */
  endpoint: z.string().trim().max(512).optional(),
  /** Alias of `drivers.<provider>.accountId` (built-ins, R2 only). */
  accountId: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.accessKeyId` (built-ins): an identifier, never the secret. */
  accessKeyId: z.string().trim().max(255).optional(),
  /** Alias of `drivers.<provider>.forcePathStyle` (built-ins); tri-state, `null` is "use this vendor's convention". */
  forcePathStyle: z.boolean().nullable().optional(),
});

// THE LINE THAT MAKES A STORAGE PATCH DO ANYTHING AT ALL. Without it
// `PATCH { "storage": { "bucket": "my-bucket" } }` parses to `{}` in the global
// ZodValidationPipe and the endpoint answers 200 with the row rewritten
// unchanged. `common/schemas/settings-parity.spec.ts` fails the build if it is
// ever dropped.
/**
 * The `storage` branch of the `PATCH /api/system-settings` body; `''` clears a field, absent leaves it.
 *
 * @stability experimental
 */
export const storageSettingsPatchSchema = systemStoragePatchSchema;

/**
 * The `storage` branch of the `GET /api/system-settings` response (no secret,
 * ever). `provider` and `drivers` are the stored shape; the six flat fields are
 * the deprecated read view of the active built-in driver (empty strings and
 * `null` when the active driver is not a built-in).
 *
 * @stability experimental
 */
export const storageResponseSchema = z.object({
  /** The id of the active storage driver. */
  provider: storageDriverIdSchema,
  /** Every registered driver's own settings, keyed by driver id (defaults filled). */
  drivers: storageDriversSchema,
  /** @deprecated Read view of `drivers.<provider>.bucket`; empty means not configured. */
  bucket: z.string(),
  /** @deprecated Read view of `drivers.<provider>.region`. */
  region: z.string(),
  /** @deprecated Read view of `drivers.<provider>.endpoint`. */
  endpoint: z.string(),
  /** @deprecated Read view of `drivers.<provider>.accountId`. */
  accountId: z.string(),
  /** @deprecated Read view of `drivers.<provider>.accessKeyId`: an identifier, never the secret. */
  accessKeyId: z.string(),
  /**
   * @deprecated Read view of `drivers.<provider>.forcePathStyle`. Tri-state, and
   * `null` is published as `null` rather than coerced to `false`.
   */
  forcePathStyle: z.boolean().nullable(),
});

/**
 * The PUT body's `storage` branch, inferred.
 *
 * @stability stable
 */
export type StorageSettingsInput = z.infer<typeof storageSettingsSchema>;

/**
 * The PATCH body's `storage` branch, inferred.
 *
 * @stability stable
 */
export type StorageSettingsPatchInput = z.infer<typeof storageSettingsPatchSchema>;

/**
 * The stored partial, inferred.
 *
 * @stability stable
 */
export type SystemStoragePatchValue = z.infer<typeof systemStoragePatchSchema>;

/**
 * The GET response's `storage` branch, inferred.
 *
 * @stability stable
 */
export type StorageSettingsResponse = z.infer<typeof storageResponseSchema>;

// -----------------------------------------------------------------------------
// Compile-time proof that the `storage` namespace carries no secret (#373)
// -----------------------------------------------------------------------------
//
// Adding `secretAccessKey` (or any of the other names) to
// `systemStorageSchema` makes `StorageSettingsCarriesNoSecret` resolve to
// `never`, and this file stops compiling: a build break at the moment of the
// mistake. If you are here because this line went red: use the credential
// store instead, at `(purpose 'storage', name 'default')`.

/**
 * `true` while {@link SystemStorageValue} has no field named in
 * `STORAGE_SECRET_FIELD_NAMES`; `never` (a compile error below) otherwise.
 *
 * @stability stable
 */
export type StorageSettingsCarriesNoSecret =
  Extract<keyof SystemStorageValue, (typeof STORAGE_SECRET_FIELD_NAMES)[number]> extends never ? true : never;

/**
 * The value that makes {@link StorageSettingsCarriesNoSecret} a compile-time check.
 *
 * @stability stable
 */
export const STORAGE_SETTINGS_CARRIES_NO_SECRET: StorageSettingsCarriesNoSecret = true;
