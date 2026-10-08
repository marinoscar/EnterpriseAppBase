// =============================================================================
// System settings namespace `storage` (issue #677; namespace #373, epic #372)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
//
// NO SECRET ACCESS KEY HERE, AND THERE NEVER MAY BE ONE: it lives in the
// encrypted credential store at `(purpose 'storage', name 'default')`. Proved
// at compile time in `common/schemas/settings.schema.ts`
// (`STORAGE_SETTINGS_CARRIES_NO_SECRET`) and at import time by the registry.
// =============================================================================

import type { z } from 'zod';
import {
  systemStoragePatchSchema,
  systemStorageSchema,
  type SystemStorageValue,
} from '@marinoscar/platform-contract/storage';
import {
  storageSettingsPatchSchema,
  storageSettingsSchema,
} from '@marinoscar/platform-contract/storage';
import { storageResponseSchema } from '@marinoscar/platform-contract/storage';
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

export const STORAGE_SYSTEM_SETTINGS = {
  key: 'storage',
  description: 'Object-storage provider configuration: provider, bucket, region, endpoint and the non-secret access key id.',
  storedSchema: systemStorageSchema,
  patchSchema: systemStoragePatchSchema,
  putSchema: storageSettingsSchema,
  wirePatchSchema: storageSettingsPatchSchema,
  responseSchema: storageResponseSchema,
  defaults: STORAGE_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  // Field-by-field salvage (the default `read`) matters more here than
  // anywhere else: "not configured" is already spelled as an empty string, so
  // a damaged `region` that dragged the whole namespace back to the defaults
  // would also blank the bucket an operator typed.
  merge(current, patch) {
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
  },
} satisfies SystemSettingsNamespace<'storage', SystemStorageValue, z.infer<typeof storageSettingsPatchSchema>>;

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
    storage: typeof STORAGE_SYSTEM_SETTINGS;
  }
}
