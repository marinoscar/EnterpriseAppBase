// =============================================================================
// PUT /api/admin/storage-config - request body (issue #375, epic #372; drivers: PP-14.7)
// =============================================================================
//
// The active driver, its settings, its write-only secrets and the typed
// confirmation. A save names the active driver (`provider`) and then supplies
// settings in either of two spellings:
//
//   * `drivers`  - `{ <driverId>: { ...that driver's settings } }`. The shape
//                  every driver, built-in or registered by an app, uses. Each
//                  entry is merged over the driver's stored settings (a setting
//                  it omits keeps its stored value), then validated by the
//                  driver; `null` resets a driver to its defaults.
//   * the flat fields (`bucket`, `region`, `endpoint`, `accountId`,
//     `accessKeyId`, `forcePathStyle`) - the shape this route had before drivers
//                  were pluggable. They are the settings of the built-in driver
//                  named by `provider`, so a client written against the old
//                  contract keeps working. A flat field present in the body
//                  replaces that setting; one omitted keeps the stored value.
//                  `drivers.<provider>` wins over a flat field for the same
//                  setting.
//
// An empty string still CLEARS a text field (that is how an operator drops an
// endpoint override, or un-configures storage by clearing `bucket`), and
// `forcePathStyle` is still TRI-STATE (`null` is "use this vendor's
// convention").
//
// -----------------------------------------------------------------------------
// SECRETS ARE WRITE-ONLY, AND BLANK PRESERVES
// -----------------------------------------------------------------------------
//
// `secretAccessKey` is the built-in drivers' secret. A driver an app registers
// declares its own (`secrets: [{ name: 'connectionString' }]`) and the admin
// form sends them in `secrets`, keyed by driver id and secret name. Omitted,
// `null` or `''` means "the admin did not retype it" and the stored value stays.
// There is deliberately no way to erase a stored secret through this endpoint;
// an admin who wants storage off empties the driver's location (`bucket`).
//
// WHY THE SECRET IS ON THIS BODY AT ALL, rather than its own endpoint: the key
// id and the secret are one credential, pasted from one screen at one moment.
// Splitting them across two requests means every rotation has a window in which
// the saved key id and the saved secret are from different key pairs.
// `EmailSettingsController` makes the same call for `smtpPassword`.
// =============================================================================

import { z } from 'zod';

import { storageDriverIdSchema, storageDriversPatchSchema } from './settings-schemas.js';

/**
 * The word `PUT /api/admin/storage-config` requires when the save would point
 * a deployment that already holds objects at a different location.
 *
 * ⚠ EXPORTED, AND THE ONLY DEFINITION. The service raising the 409 and the DTO
 * validating the body both read this constant, and #376's UI sends it back.
 * A second string literal that differs by a character is a confirmation dialog
 * whose "yes" the API rejects.
 *
 * Deliberately a different word from `RESTORE`, `ROLLBACK`, `ROTATE` and
 * `REMOVE` for the reason those four differ from each other: a body copied from
 * one confirming route to another must be refused, not silently accepted. The
 * same argument against `{ "confirm": true }` applies here and is set out in
 * full in `db-backup/dto/db-backup-restore.dto.ts` — in short, a boolean is
 * reproduced by a replayed POST, a retried client and a double-clicked button,
 * and this word is reproduced by none of them accidentally.
 *
 * @stability experimental
 */
export const STORAGE_SWITCH_CONFIRMATION = 'SWITCH';

/**
 * The `PUT /api/admin/storage-config` body: the active driver, its settings (`drivers`, or the legacy flat fields for the built-ins), the write-only secrets and the optional confirmation.
 *
 * @stability experimental
 */
export const updateStorageConfigSchema = z.object({
  /** The id of the storage driver to make active (a built-in, or one an app registered). */
  provider: storageDriverIdSchema,

  /**
   * Driver settings, per driver id, merged over the stored ones and validated
   * by each driver. `null` resets a driver to its defaults. See the header.
   */
  drivers: storageDriversPatchSchema.optional(),

  /**
   * Alias of `drivers.<provider>.bucket` (built-in drivers). No `.min(1)`:
   * `''` is the legal, persisted "not configured" state and is how an operator
   * un-configures storage entirely. Completeness is decided by the driver.
   */
  bucket: z.string().trim().max(255).optional(),

  /** Alias of `drivers.<provider>.region`. `''` is "not stated"; R2 wants the literal `auto`. */
  region: z.string().trim().max(255).optional(),

  /** Alias of `drivers.<provider>.endpoint`. Explicit origin, or `''` to derive it (R2) or use the SDK's host (S3). */
  endpoint: z.string().trim().max(512).optional(),

  /** Alias of `drivers.<provider>.accountId`. R2 account id, from which its endpoint is derived. */
  accountId: z.string().trim().max(255).optional(),

  /**
   * Alias of `drivers.<provider>.accessKeyId`. The identifier half of the
   * credential: NOT A SECRET, in both the request and the response on purpose
   * (it travels in the clear in every SigV4 `Authorization` header).
   */
  accessKeyId: z.string().trim().max(255).optional(),

  /**
   * WRITE-ONLY, AND BLANK PRESERVES. The built-in drivers' secret access key.
   * Omitted, `null` or `''` means "the admin did not retype the secret" and the
   * stored one is left exactly as it is. NEVER ECHOED BACK: no response schema
   * has a field capable of carrying it.
   */
  secretAccessKey: z.string().max(512).nullish(),

  /**
   * WRITE-ONLY secrets of any driver: `{ <driverId>: { <secretName>: value } }`,
   * the names the driver declares (`descriptors[].fields` of kind `secret`).
   * A blank value keeps the stored one. Never echoed back.
   */
  secrets: z.record(storageDriverIdSchema, z.record(z.string(), z.string().max(4096).nullish())).optional(),

  /**
   * Alias of `drivers.<provider>.forcePathStyle`: `https://host/bucket/key`
   * (true) over `https://bucket.host/key` (false), or `null` for "use this
   * vendor's convention".
   */
  forcePathStyle: z.boolean().nullable().optional(),

  /**
   * The literal string `SWITCH`, required only when this save would repoint a
   * deployment that still has objects at the old location.
   *
   * Optional because the ordinary save needs no acknowledgement at all. The
   * service decides whether it was needed and answers `409` with the row counts
   * when it was missing.
   *
   * IT ACKNOWLEDGES, IT DOES NOT MIGRATE. Saving a new location does not copy a
   * single object.
   */
  confirmation: z.literal(STORAGE_SWITCH_CONFIRMATION).optional(),
});

/**
 * The parsed body.
 *
 * @stability experimental
 */
export type UpdateStorageConfigInput = z.output<typeof updateStorageConfigSchema>;
