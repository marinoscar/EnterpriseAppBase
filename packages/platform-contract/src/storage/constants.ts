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
 * S3-compatible providers this app can be pointed at.
 *
 * A closed enum rather than a free string (unlike `databaseBackup
 * .storageProvider`, which names a provider REGISTRATION and is deliberately
 * open for forks) because this value selects which set of the configuration
 * fields is meaningful and how an endpoint is derived.
 *
 *  - `s3`           — AWS S3 proper. `region` is required by the SDK;
 *                     `endpoint` is left empty and the SDK derives it.
 *  - `r2`           — Cloudflare R2: its `region` is literally `auto`, and its
 *                     endpoint is DERIVED from `accountId`.
 *  - `s3compatible` — MinIO, Backblaze B2, Wasabi, Ceph RGW and anything else
 *                     speaking the same protocol at an operator-supplied
 *                     `endpoint`.
 *
 * A non-S3 backend is not a new member here: an app overrides the whole
 * `STORAGE_PROVIDER` token (`@marinoscar/platform-api/storage`).
 *
 * @stability stable
 */
export const STORAGE_PROVIDER_KINDS = ['s3', 'r2', 's3compatible'] as const;

/**
 * A configured object-storage provider. See {@link STORAGE_PROVIDER_KINDS}.
 *
 * @stability stable
 */
export type StorageProviderKind = (typeof STORAGE_PROVIDER_KINDS)[number];

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
 * Every field the resolved storage configuration can be missing, in the order
 * the admin page and the 503 list them. `secretAccessKey` is the credential
 * store's half; the rest are the `storage` settings namespace's.
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
