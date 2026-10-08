// =============================================================================
// System settings namespace `storage` (issue #677; namespace #373, epic #372)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/storage`'s since #736). Registered by the
// app's system-settings manifest. Recipe: packages/platform-api/src/settings/README.md.
//
// NO SECRET ACCESS KEY HERE, AND THERE NEVER MAY BE ONE: it lives in the
// encrypted credential store at `(purpose 'storage', name 'default')`. Proved
// at compile time in `@marinoscar/platform-contract/storage`
// (`StorageSettingsCarriesNoSecret`) and at import time by the registry
// (`SETTINGS_SECRET_FIELD_NAMES`).
// =============================================================================

import {
  storageResponseSchema,
  storageSettingsPatchSchema,
  storageSettingsSchema,
  systemStoragePatchSchema,
  systemStorageSchema,
  type StorageSettingsPatchInput,
  type SystemStorageValue,
} from '@marinoscar/platform-contract/storage';
import type { SystemSettingsNamespace } from '../../settings/index';

// UNCONFIGURED: `provider: 's3'` names the shape the empty fields would be
// filled in for, and every field that would actually make a request go
// somewhere is empty. These are the ONLY source of a storage configuration —
// `STORAGE_PROVIDER`/`S3_*` were removed in #377 — so a fresh deployment
// refuses storage operations with a 503 naming the empty fields until an
// administrator fills them in at /admin/settings/storage.
//
// `'s3'` rather than `null` because `provider` is a closed enum with no "none"
// member: "no storage configured" is `bucket === ''`, one question with one
// answer, instead of a second way to spell the same state that every consumer
// would then have to check for separately.
const STORAGE_SYSTEM_DEFAULTS: SystemStorageValue = {
  provider: 's3',
  bucket: '',
  // Empty, not 'us-east-1'. Inheriting a region nobody chose is how a
  // deployment gets "the bucket you are attempting to access must be
  // addressed using the specified endpoint" from a settings page that looks
  // filled in. R2 wants the literal 'auto' here.
  region: '',
  // Empty means "derive it, or let the SDK use its own host".
  endpoint: '',
  // R2 only; the account-scoped endpoint is derived from it.
  accountId: '',
  // The IDENTIFIER half of the credential. Its secret half is never here —
  // it goes to the credential store at `(purpose 'storage', name 'default')`.
  accessKeyId: '',
  // `null`, NOT `false` — "use this vendor's convention" (path style for
  // `s3compatible`, virtual-host style for `s3` and `r2`). A default of
  // `false` is an operator's answer nobody gave, and it reached the driver
  // as one: it suppressed the per-vendor default and broke MinIO. Same rule
  // as the empty strings above, spelled the way a boolean has to spell it.
  forcePathStyle: null,
};

/**
 * The `storage` namespace's PATCH merge: a field the patch names replaces the
 * stored one (an empty string included: `''` un-configures a field), an
 * absent field is kept; `forcePathStyle` is replaced on any value but
 * `undefined` (`null` restores the vendor convention).
 *
 * Field-by-field salvage (the default `read`) matters more here than
 * anywhere else: "not configured" is already spelled as an empty string, so a
 * damaged `region` that dragged the whole namespace back to the defaults would
 * also blank the bucket an operator typed.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `storage` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeStorageSettings(current: SystemStorageValue, patch?: StorageSettingsPatchInput): SystemStorageValue {
    // `??` is the RIGHT operator for every STRING field here even though it is
    // the wrong one for `maintenance.startedAt`: none of them is nullable, so a
    // caller can never send `null`, and `??` passes an empty string through
    // unchanged. That last part is load-bearing — `''` is how an operator
    // un-configures a field, and `||` would silently turn "clear the endpoint"
    // into "keep the old endpoint", which is the class of bug that leaves a
    // deployment writing to a bucket it was told to stop writing to.
    //
    // `forcePathStyle` IS THE ONE EXCEPTION, and it uses the `!== undefined`
    // form for exactly the reason `maintenance.startedAt` does: it is
    // tri-state (`true` / `false` / `null`, where `null` means "use this
    // vendor's convention"), so `null` is a value a caller can legitimately
    // SEND, and `??` treats a sent `null` the same as an absent key. Only
    // `undefined` may mean "leave it alone".
    //
    // NOTHING HERE TOUCHES THE SECRET ACCESS KEY. It is not in the DTO, not
    // in the stored value and not in this merge; it is written through
    // `CredentialsService` on its own path.
    return {
      provider: patch?.provider ?? current.provider,
      bucket: patch?.bucket ?? current.bucket,
      region: patch?.region ?? current.region,
      endpoint: patch?.endpoint ?? current.endpoint,
      accountId: patch?.accountId ?? current.accountId,
      accessKeyId: patch?.accessKeyId ?? current.accessKeyId,
      forcePathStyle: patch?.forcePathStyle !== undefined ? patch.forcePathStyle : current.forcePathStyle,
    };
}

/**
 * The `storage` system-settings namespace (#373, epic #372): the
 * object-storage provider configuration. Registered by the app's system
 * settings manifest, after the operations namespaces. No secret, ever: the
 * secret access key is the credential store's
 * (`(purpose 'storage', name 'default')`).
 *
 * @stability experimental
 */
export const STORAGE_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'storage',
  /** What it holds. */
  description: 'Object-storage provider configuration: provider, bucket, region, endpoint and the non-secret access key id.',
  /** The stored shape. */
  storedSchema: systemStorageSchema,
  /** The stored partial. */
  patchSchema: systemStoragePatchSchema,
  /** The PUT body's branch. */
  putSchema: storageSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: storageSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: storageResponseSchema,
  /** Unconfigured: every field that would send a request somewhere is empty. */
  defaults: STORAGE_SYSTEM_DEFAULTS,
  /** Optional in a PUT body. */
  requiredOnPut: false,
  /** The PATCH merge (`mergeStorageSettings`). */
  merge: mergeStorageSettings,
} satisfies SystemSettingsNamespace<'storage', SystemStorageValue, StorageSettingsPatchInput>;

declare module '../../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Object-storage provider configuration (#373, epic #372): which provider,
     * which bucket, and the non-secret half of the credential. "Not configured"
     * is expressed by empty strings INSIDE the block, never by the block being
     * absent; see `systemStorageSchema`.
     */
    storage: SystemStorageValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `storage` declaration. */
    storage: typeof STORAGE_SYSTEM_SETTINGS;
  }
}
