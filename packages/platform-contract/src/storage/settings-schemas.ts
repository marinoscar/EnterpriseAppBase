// =============================================================================
// Storage: the `storage` system-settings namespace's schemas (issue #736)
// =============================================================================
//
// The five schemas the namespace declaration of
// `@marinoscar/platform-api/storage` (`STORAGE_SYSTEM_SETTINGS`) is built
// from: the stored value and its partial, the PUT and PATCH wire branches,
// and the GET response branch. Moved verbatim (design comments included) from
// the reference app's `common/schemas/settings.schema.ts`,
// `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`,
// which re-export them. Every bound is unchanged, so the OpenAPI document of
// `/api/system-settings` is too.
//
// THE SECRET ACCESS KEY IS NOT HERE, AND MUST NEVER BE ADDED: it lives in the
// encrypted credential store at `(purpose 'storage', name 'default')`.
// `StorageSettingsCarriesNoSecret` at the bottom fails to compile the moment a
// secret-named field is added.
// =============================================================================

import { z } from 'zod';

import { STORAGE_PROVIDER_KINDS, STORAGE_SECRET_FIELD_NAMES } from './constants.js';

/**
 * Object-storage provider configuration (`storage`).
 *
 * EVERY FIELD HAS A DEFAULT, and every string default is the EMPTY STRING
 * rather than `null` or an absent key. That is what lets this namespace degrade
 * field by field like its neighbours: `readNamespace` in
 * `system-settings.service.ts` validates each field on its own and substitutes
 * that field's default when storage holds something unusable, so a row with a
 * corrupt `region` keeps the bucket an operator typed. A `null`-or-string union
 * would make every consumer ask the same question twice ("absent, or empty?")
 * and get a different answer in different places.
 *
 * EMPTY MEANS "NOT CONFIGURED", and it is a legal, expected, persisted state —
 * it is what a fresh deployment reads, and it is why `bucket` carries no
 * `.min(1)`. Refusing to store an empty bucket would mean the only way to reach
 * a valid configuration is to type every field correctly in one request, and
 * would make the very first save of a half-filled form a 400. Whether the
 * configuration is COMPLETE ENOUGH TO USE is a question for the consumer that
 * builds a client from it, not for the shape of the document — and that
 * consumer is `storage/config/storage-config.ts` (`resolveStorageConfig`),
 * which holds every completeness rule in one place and is the ONLY place that
 * answers it.
 *
 * `region` defaults to empty rather than to `us-east-1`: a wrong region is a
 * confusing runtime failure ("bucket is in another region"), and inheriting one
 * silently from a schema default is how a deployment ends up with a value
 * nobody chose. R2 wants the literal `auto` here.
 *
 * `endpoint` empty means "derive it or use none" — the SDK's own host for `s3`,
 * the account-scoped host for `r2`. An explicit value always wins, which is
 * what makes pointing `s3` at a local MinIO for development possible without
 * changing `provider`.
 *
 * `forcePathStyle` selects `https://host/bucket/key` over
 * `https://bucket.host/key`, and is TRI-STATE — `true`, `false` or `null`.
 * `null` IS THE SHIPPED DEFAULT AND MEANS "USE THIS VENDOR'S CONVENTION":
 * path style for `s3compatible`, virtual-host style for `s3` and `r2`, applied
 * in exactly one place (`buildS3ClientConfig`, storage/providers/s3). It is not
 * inferred from `provider` HERE because an explicit value must be able to beat
 * the convention for every provider: MinIO needs path style, R2 does not, and
 * an S3-compatible appliance behind a TLS certificate that does not cover
 * wildcard subdomains needs it regardless of who made it.
 *
 * WHY NULLABLE RATHER THAN A PLAIN BOOLEAN, which is the same argument the
 * string fields above make. Empty string is how a string here says "the
 * operator has not said"; `null` is a boolean's only spelling of that, since
 * both `true` and `false` are answers an operator can mean. A plain
 * `z.boolean()` defaulting to `false` cannot express "unset", so every saved
 * configuration carried an explicit `false` into the driver and the
 * per-vendor default below it could never fire — which is precisely how
 * selecting `s3compatible`, typing a MinIO endpoint and saving produced a
 * deployment MinIO rejects (it requires path style). Consumers ask the same
 * one question the strings do ("did the operator state a value?"), and get
 * the same answer everywhere.
 *
 * NO `.default()` ON ANY FIELD, exactly as in the operations section above. The
 * defaults live in `DEFAULT_SYSTEM_SETTINGS` (settings.types.ts) and nowhere
 * else; a `.default()` here would mint values in whichever `parse` happened to
 * run first, and move "what does a fresh deployment do?" out of the one object
 * that is supposed to answer it.
 *
 * @stability experimental
 */
export const systemStorageSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS),
  // No `.min(1)`: empty is "not configured yet". See the block comment above.
  bucket: z.string().trim().max(255),
  region: z.string().trim().max(255),
  // Longer bound than the rest: an endpoint is a URL, and a self-hosted one
  // behind a path prefix is routinely longer than a bucket name.
  endpoint: z.string().trim().max(512),
  accountId: z.string().trim().max(255),
  // An IDENTIFIER, not a secret — see the block comment above, and the
  // compile-time proof at the bottom of this file.
  accessKeyId: z.string().trim().max(255),
  // TRI-STATE. `null` is "use this vendor's convention", and is the default in
  // `DEFAULT_SYSTEM_SETTINGS`; `true`/`false` are an operator overriding it.
  // See the block comment above for why a plain boolean cannot say "unset".
  forcePathStyle: z.boolean().nullable(),
});

/**
 * SystemStorageValue.
 *
 * @stability experimental
 */
export type SystemStorageValue = z.infer<typeof systemStorageSchema>;

/**
 * `storage`, one level deep (#373, epic #372).
 *
 * Every field optional, INCLUDING the strings, and an empty string is a
 * meaningful value here rather than a way of saying "leave it alone" — absent
 * is how a caller says that. `{ "storage": { "bucket": "" } }` therefore CLEARS
 * the bucket, which is the only way an operator can un-configure storage
 * through the API without hand-editing JSONB. The service's merge uses `??`
 * against the stored value, and `??` treats `''` as present, so this works
 * without the `!== undefined` dance `maintenance.startedAt` needs (no field
 * here is nullable, so there is no `null`-versus-absent distinction to lose).
 *
 * @stability experimental
 */
export const systemStoragePatchSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS).optional(),
  bucket: z.string().trim().max(255).optional(),
  region: z.string().trim().max(255).optional(),
  endpoint: z.string().trim().max(512).optional(),
  accountId: z.string().trim().max(255).optional(),
  accessKeyId: z.string().trim().max(255).optional(),
  // `.nullable().optional()` means two different things here, and both are
  // wanted: absent is "leave it alone", explicit `null` is "go back to this
  // vendor's convention". See the block comment on `systemStorageSchema`.
  forcePathStyle: z.boolean().nullable().optional(),
});

// =============================================================================
// Storage provider configuration on the wire (#373, epic #372)
// =============================================================================
//
// Restated here rather than imported, for the reason at the top of this file:
// these are the OpenAPI-visible request schemas. Optional in the PUT body like
// the operations namespaces above, and for the identical reason — this block
// ships ahead of every client that knows it exists, so requiring it would 400
// every PUT from this repo's own settings page the moment it merges.
//
// NO `secretAccessKey` FIELD, ON EITHER SCHEMA, EVER. The secret access key is
// written through the credential store (#115, epic #108) at
// `(purpose 'storage', name 'default')`, not through this document. Accepting it
// here would put it in the request body of an endpoint whose audit rows record
// the full merged value, and in the response of the GET that follows. See
// `common/schemas/settings.schema.ts`, which carries the argument and a
// compile-time proof of the absence. `accessKeyId` is fine: it is an identifier
// that rides in the clear in every SigV4 `Authorization` header, the counterpart
// of `smtpUsername`.
//
// Bounds mirror `systemStorageSchema` exactly. No `.min(1)` on the strings:
// empty means "not configured", which is a legal state and the one a fresh
// deployment is in.

/**
 * storageSettingsSchema.
 *
 * @stability experimental
 */
export const storageSettingsSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS),
  bucket: z.string().trim().max(255),
  region: z.string().trim().max(255),
  endpoint: z.string().trim().max(512),
  accountId: z.string().trim().max(255),
  accessKeyId: z.string().trim().max(255),
  // Tri-state, mirroring `systemStorageSchema`: `null` is "use this vendor's
  // convention" and is what a fresh deployment holds.
  forcePathStyle: z.boolean().nullable(),
});

// #373, epic #372. THE LINE THAT MAKES A STORAGE PATCH DO ANYTHING AT ALL.
// Without it `PATCH { "storage": { "bucket": "my-bucket" } }` parses to `{}`
// in the global ZodValidationPipe, the service merges nothing, the row is
// rewritten unchanged and the endpoint answers 200 with a body that looks
// right — no error, no log line, no audit entry. `common/schemas/settings-parity.spec.ts`
// is what fails the build if this is ever dropped.
//
// An empty string here CLEARS a string field (`''` is how a string says
// "un-configure this"); absent leaves the stored value alone. The one
// nullable field, `forcePathStyle`, says the same thing with an explicit
// `null` — see `systemStorageSchema` for why a boolean needs a third state.
/**
 * storageSettingsPatchSchema.
 *
 * @stability experimental
 */
export const storageSettingsPatchSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS).optional(),
  bucket: z.string().trim().max(255).optional(),
  region: z.string().trim().max(255).optional(),
  endpoint: z.string().trim().max(512).optional(),
  accountId: z.string().trim().max(255).optional(),
  // Identifier, never the secret half — see the section header above.
  accessKeyId: z.string().trim().max(255).optional(),
  // Absent leaves it alone; explicit `null` restores the vendor default.
  forcePathStyle: z.boolean().nullable().optional(),
});

// #373, epic #372 — the storage provider configuration, published for the
// same reason the operations namespaces above are: a block this response
// omits is a block no client can echo back in a PUT.
//
// THERE IS NO `secretAccessKey` FIELD AND THERE MUST NEVER BE ONE. The
// secret half of the storage credential lives in the encrypted credential
// store at `(purpose 'storage', name 'default')` and is returned by nothing.
// `accessKeyId` is published deliberately: it is an identifier that travels
// in the clear in every SigV4 request, and an administrator who cannot see
// which key id is configured cannot tell a rotated key from a mistyped one.
// See `common/schemas/settings.schema.ts` for the full argument and its
// compile-time proof.
/**
 * storageResponseSchema.
 *
 * @stability experimental
 */
export const storageResponseSchema = z.object({
  provider: z.enum(['s3', 'r2', 's3compatible']),
  bucket: z.string(),
  region: z.string(),
  endpoint: z.string(),
  accountId: z.string(),
  accessKeyId: z.string(),
  // Tri-state, and `null` is published as `null` rather than coerced to
  // `false`: an administrator reading this must be able to tell "I have not
  // chosen" from "I chose virtual-host style". See `systemStorageSchema`.
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
