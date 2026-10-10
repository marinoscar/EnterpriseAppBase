// =============================================================================
// Storage: plain values of the storage slice's wire shapes (issue #736, PP-8.3)
// =============================================================================
//
// Zod-free, so a consumer that needs only a provider list or a status list
// (the web app) never bundles the schemas or zod. Moved from the API's
// `common/schemas/settings.schema.ts` and `storage/config/storage-config.ts`
// with their comments; the API re-exports them.
// =============================================================================

/**
 * The pattern every storage driver id must match: a lower-case letter, then
 * letters, digits and hyphens, 2 to 48 characters. The same pattern as every
 * pluggable id (`PLUGGABLE_ID_PATTERN` of `@marinoscar/platform-contract/settings`).
 * An id is the key its settings are stored under, so it is permanent once a
 * row exists.
 *
 * @stability experimental
 */
export const STORAGE_DRIVER_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * The storage drivers the platform SHIPS (S3-compatible object stores). Not a
 * closed set: an app or package registers more with `registerStorageDriver`
 * (`@marinoscar/platform-api/storage`) and its id is any
 * {@link STORAGE_DRIVER_ID_PATTERN} string. Use this list for defaults, labels
 * and the "is this one of the S3 flavours" question, never to validate an id.
 *
 *  - `s3`           - AWS S3 proper. `region` is required by the SDK;
 *                     `endpoint` is left empty and the SDK derives it.
 *  - `r2`           - Cloudflare R2: its `region` is literally `auto`, and its
 *                     endpoint is DERIVED from `accountId`.
 *  - `s3compatible` - MinIO, Backblaze B2, Wasabi, Ceph RGW and anything else
 *                     speaking the same protocol at an operator-supplied
 *                     `endpoint`.
 *
 * @stability experimental
 */
export const BUILTIN_STORAGE_PROVIDER_KINDS = ['s3', 'r2', 's3compatible'] as const;

/**
 * The built-in storage provider kinds.
 *
 * @deprecated Use {@link BUILTIN_STORAGE_PROVIDER_KINDS}. The list is no longer
 *   the set of valid providers: any registered storage driver id is one.
 * @stability stable
 */
export const STORAGE_PROVIDER_KINDS = BUILTIN_STORAGE_PROVIDER_KINDS;

/**
 * One of {@link BUILTIN_STORAGE_PROVIDER_KINDS}.
 *
 * @stability experimental
 */
export type BuiltinStorageProviderKind = (typeof BUILTIN_STORAGE_PROVIDER_KINDS)[number];

/**
 * A configured object-storage provider: the id of a registered storage driver.
 * A plain string since storage drivers became pluggable (PP-14.7); the
 * built-ins are {@link BuiltinStorageProviderKind}.
 *
 * @stability stable
 */
export type StorageProviderKind = string;

/**
 * The names of the legacy flat fields the `storage` namespace stored before
 * drivers had a settings record of their own. They are a read-only view of the
 * active built-in driver's settings; the namespace stores the new shape
 * (`provider` plus `drivers`).
 *
 * @stability experimental
 */
export const LEGACY_STORAGE_FLAT_FIELDS = ['bucket', 'region', 'endpoint', 'accountId', 'accessKeyId', 'forcePathStyle'] as const;

/**
 * The five `StorageObjectStatus` values of the `storage` fragment, in its
 * declaration order (the order the OpenAPI enum lists them in).
 *
 * @stability stable
 */
export const STORAGE_OBJECT_STATUSES = ['pending', 'uploading', 'processing', 'ready', 'failed'] as const;

/**
 * One storage object status.
 *
 * @stability stable
 */
export type StorageObjectStatusName = (typeof STORAGE_OBJECT_STATUSES)[number];

/**
 * Every field the BUILT-IN (S3 family) storage drivers can be missing, in the
 * order the admin page and the 503 list them. `secretAccessKey` is the
 * credential store's half; the rest are the driver's settings. A driver an app
 * registers reports its own field names, so the wire shape of `missing` is a
 * list of strings; this list names the built-ins' values.
 *
 * @stability stable
 */
export const MISSING_STORAGE_CONFIG_FIELDS = [
  'bucket',
  'region',
  'endpoint',
  'accountId',
  'accessKeyId',
  'secretAccessKey',
] as const;

/**
 * Field names the `storage` settings namespace may never declare, at any
 * case: the secret half of the storage credential lives in the encrypted
 * credential store at `(purpose 'storage', name 'default')`, never in the
 * settings blob `GET /api/system-settings` returns wholesale.
 *
 * `accessKeyId` is deliberately ABSENT: it is an identifier that travels in
 * the clear in every SigV4 `Authorization` header and authorises nothing by
 * itself. The settings slice's own list (`SETTINGS_SECRET_FIELD_NAMES` of
 * `@marinoscar/platform-api/settings`) is the registry-time check of every
 * namespace; this is the contract's compile-time copy for the one namespace
 * it owns.
 *
 * @stability stable
 */
export const STORAGE_SECRET_FIELD_NAMES = [
  'secretAccessKey',
  'secretKey',
  'sessionToken',
  'secret',
  'password',
  'apiKey',
  'token',
  'privateKey',
] as const;

/**
 * The entries of a zod enum built from a value list (`{ s3: 's3', ... }`):
 * the schemas cast `z.enum(list)` to `z.ZodEnum<StorageEnum<typeof list>>`
 * so the declarations name the list instead of spelling every entry.
 *
 * @typeParam T - the value list.
 *
 * @stability experimental
 */
export type StorageEnum<T extends readonly string[]> = { [K in T[number]]: K };
