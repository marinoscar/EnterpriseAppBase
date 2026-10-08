/**
 * The object-storage admin API (`/api/admin/storage-config`), as the web app
 * sees it.
 *
 * Issue #376, epic #372 — the client half of the controller merged in #375
 * (`@marinoscar/platform-api/storage`, `config/`). In
 * `@marinoscar/platform-web/storage` since #736: the four calls take the
 * app's transport (`PlatformApiClient`, the platform host's `api`), which
 * keeps the auth header, the refresh dance and the maintenance recogniser.
 *
 * =============================================================================
 * THE SECRET ACCESS KEY ONLY EVER TRAVELS ONE WAY
 * =============================================================================
 *
 * No response type below carries the secret access key, because no endpoint
 * returns it — the API holds it in the encrypted credential store and answers
 * with {@link StorageSecretStatus}, a masked hint mirroring `SmtpPasswordStatus`
 * and `PrivateKeyStatus`. It appears in exactly one place in this file: the
 * optional, WRITE-ONLY `secretAccessKey` on {@link StorageConfigInput}, where
 * blank/absent means "keep the stored one". Nothing here, and nothing built on
 * it, should grow a field that could hold the real key coming back.
 *
 * `accessKeyId` IS returned, deliberately: it travels in the clear in every
 * SigV4 `Authorization` header, and an administrator who cannot see it cannot
 * tell a rotated key from a mistyped one.
 *
 * =============================================================================
 * ⚠ TWO ENDPOINTS ANSWER 200 WHEN THE ANSWER IS BAD
 * =============================================================================
 *
 * `POST /test` and `POST /bucket` both always return HTTP 200; the outcome is
 * in the BODY (`success` for the test, `outcome` for the bucket action). A
 * caller that reads the status code reports success for every misconfiguration
 * there is — see each DTO's header on the API side, and `sendTestEmail`, which
 * makes the same argument first. Neither function below rejects on a bad
 * diagnosis; both reject only when the call itself fails.
 */

import {
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_BUCKET_OUTCOMES,
  STORAGE_BUCKET_STEP_IDS,
  STORAGE_BUCKET_STEP_STATUSES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SWITCH_CONFIRMATION,
  STORAGE_TEST_CHECK_CODES,
  STORAGE_TEST_CHECK_IDS,
  STORAGE_TEST_CHECK_STATUSES,
} from '@marinoscar/platform-contract/storage';

import type { PlatformApiClient } from '../../core/index.js';

// The value lists are the contract's (`@marinoscar/platform-contract/storage`,
// #736), re-exported here so the page and its tests keep one import; the types
// below are the page's own view of the same shapes.

/**
 * Which object store this deployment talks to.
 *
 * Mirrors `STORAGE_PROVIDER_KINDS` in
 * `apps/api/src/common/schemas/settings.schema.ts`, as a const tuple so the
 * union and the list a form iterates are one declaration rather than two.
 */
export { STORAGE_PROVIDER_KINDS };
/**
 * Which object store this deployment talks to.
 *
 * @stability experimental
 */
export type StorageProviderKind = (typeof STORAGE_PROVIDER_KINDS)[number];

/**
 * Every field the configuration needs and might not have.
 *
 * `secretAccessKey` is in here even though it is not a settings field: from
 * "can this deployment store a file?", a missing credential row and an empty
 * bucket are the same kind of problem. Mirrors
 * `MISSING_STORAGE_CONFIG_FIELDS`.
 */
export { MISSING_STORAGE_CONFIG_FIELDS };
/**
 * A field the configuration needs and does not have.
 *
 * @stability experimental
 */
export type MissingStorageConfigField = (typeof MISSING_STORAGE_CONFIG_FIELDS)[number];

/**
 * What the UI may know about the stored secret access key. Mirrors
 * `SmtpPasswordStatus` / `PrivateKeyStatus` field for field: never the
 * plaintext, only enough to say WHICH credential is live and when it was set.
 *
 * @stability experimental
 */
export interface StorageSecretStatus {
  /** Whether a secret is stored. */
  configured: boolean;
  /** A masked hint (e.g. `"••••ab12"`), or `null`. NEVER the real key. */
  hint: string | null;
  /** When it was last written (ISO), or `null`. */
  updatedAt: string | null;
  /** Who last wrote the secret, or `null`. */
  updatedByUserId: string | null;
}

/**
 * `GET /api/admin/storage-config`, and the body `PUT` returns.
 *
 * @stability experimental
 */
export interface StorageConfigView {
  /** Which provider: `s3`, `r2` or `s3compatible`. */
  provider: StorageProviderKind;
  /** The bucket name. */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The operator's endpoint override, verbatim. `''` when there is none. */
  endpoint: string;
  /** Cloudflare account id — only meaningful for `r2`. */
  accountId: string;
  /** The access key id: an identifier, never the secret. */
  accessKeyId: string;
  /** TRI-STATE: `null` is "use this vendor's convention", not `false`. */
  forcePathStyle: boolean | null;
  /**
   * What an S3 client would actually be pointed at — READ-ONLY, and derived
   * server-side (for R2, from `accountId`), so a settings page never builds
   * that host itself. `null` for plain AWS S3, where the SDK builds its own.
   */
  effectiveEndpoint: string | null;
  /** The single definition of "this deployment can store a file". */
  configured: boolean;
  /** Every field standing in the way of `configured`. */
  missing: MissingStorageConfigField[];
  /** The masked status of the stored secret access key. */
  secretStatus: StorageSecretStatus;
  /** Bumped on every write. Pass back as `If-Match` on the next `PUT`. */
  version: number;
  /** When it was last written (ISO), or `null`. */
  updatedAt: string | null;
  /** Who last saved it, or `null`. */
  updatedBy: {
    /** Their user id. */
    id: string;
    /** Their address. */
    email: string;
  } | null;
}

/**
 * The body of `PUT`, `POST /test` and `POST /bucket` — the same seven settings
 * fields in all three, which is what lets the two probes run against a
 * configuration that has NOT been saved yet.
 *
 * `secretAccessKey` is optional and write-only: omit it (or send it blank) to
 * keep the stored one. There is no way to erase a stored secret here.
 *
 * @stability experimental
 */
export interface StorageConfigInput {
  /** Which provider: `s3`, `r2` or `s3compatible`. */
  provider: StorageProviderKind;
  /** The bucket name. */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The endpoint; empty or `null` means the SDK's own host. */
  endpoint: string;
  /** The Cloudflare account id (R2 only). */
  accountId: string;
  /** The access key id: an identifier, never the secret. */
  accessKeyId: string;
  /** TRI-STATE — `null` means "vendor convention", and is a real saved value. */
  forcePathStyle: boolean | null;
  /** WRITE-ONLY. Omitted entirely when the admin did not retype it. */
  secretAccessKey?: string;
}

/**
 * The exact string the API's Zod literal requires when a save would repoint a
 * deployment that still holds objects (`STORAGE_SWITCH_CONFIRMATION`,
 * `dto/update-storage-config.dto.ts`). Held as a constant for the same reason
 * `RESTORE`/`ROLLBACK`/`ROTATE` are: the dialog compares what an admin typed
 * against this, never against a string re-typed in a component.
 */
export { STORAGE_SWITCH_CONFIRMATION };

/**
 * One storage location: a provider, a bucket and its endpoint.
 *
 * @stability experimental
 */
export interface StorageLocation {
  /** Which provider. */
  provider: StorageProviderKind;
  /** The bucket. */
  bucket: string;
  /** The endpoint, or `null` for the SDK's own host. */
  endpoint: string | null;
}

/**
 * The `details` a `409 STORAGE_LOCATION_IN_USE` carries — what is about to be stranded.
 *
 * @stability experimental
 */
export interface StorageLocationInUseDetails {
  /** The literal to type (`SWITCH`). */
  confirmation: string;
  /** Where the objects are now. */
  from: StorageLocation;
  /** Where the save would point the deployment. */
  to: StorageLocation;
  /** Stored objects still in the old location. */
  storageObjects: number;
  /** Backup archives still in the old location. */
  databaseBackupRuns: number;
  /** Both counts together. */
  total: number;
}

/**
 * The API's code for "this save relocates storage and you have not said SWITCH".
 *
 * @stability experimental
 */
export const STORAGE_LOCATION_IN_USE_CODE = 'STORAGE_LOCATION_IN_USE';

// ---------------------------------------------------------------------------
// POST /test
// ---------------------------------------------------------------------------

/** The four checks, in the order the API reports them. */
export { STORAGE_TEST_CHECK_IDS };
/**
 * One connection-test check id.
 *
 * @stability experimental
 */
export type StorageTestCheckId = (typeof STORAGE_TEST_CHECK_IDS)[number];

export { STORAGE_TEST_CHECK_STATUSES };
/**
 * How one check went: `passed`, `failed` or `skipped`.
 *
 * @stability experimental
 */
export type StorageTestCheckStatus = (typeof STORAGE_TEST_CHECK_STATUSES)[number];

/**
 * The machine-readable diagnosis of one check.
 *
 * ⚠ `bucket_missing` (404 — no such bucket, create it) and `bucket_forbidden`
 * (403 — it exists and this key may not see it, so widen the policy or fix a
 * typo that landed on somebody else's bucket) are deliberately NOT collapsed
 * together: they need opposite actions, and offering "Create bucket" for the
 * second would ask an admin to create a bucket that already exists.
 */
export { STORAGE_TEST_CHECK_CODES };
/**
 * One check's machine-readable cause.
 *
 * @stability experimental
 */
export type StorageTestCheckCode = (typeof STORAGE_TEST_CHECK_CODES)[number];

/**
 * One check of the connection test.
 *
 * @stability experimental
 */
export interface StorageConnectionCheck {
  /** The id. */
  id: StorageTestCheckId;
  /** A human label. */
  label: string;
  /** How it went. */
  status: StorageTestCheckStatus;
  /** The machine-readable cause. */
  code: StorageTestCheckCode;
  /** Actionable prose, written by the API for a human. */
  detail: string;
  /** The provider's verbatim message, or `null`. */
  error: string | null;
}

/**
 * What `POST /test` returns, always HTTP 200: read `success`.
 *
 * @stability experimental
 */
export interface StorageConnectionTestResult {
  /** Whether every check passed. */
  success: boolean;
  /** Which provider: `s3`, `r2` or `s3compatible`. */
  provider: StorageProviderKind;
  /** The bucket name. */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The endpoint the client actually used, or `null` for the SDK default. */
  effectiveEndpoint: string | null;
  /** True when the submitted body left `secretAccessKey` blank. */
  usedStoredSecret: boolean;
  /** One entry per check, in order. */
  checks: StorageConnectionCheck[];
  /** When it ran (ISO). */
  attemptedAt: string;
}

/**
 * Does any check in this result say the bucket is simply not there?
 *
 * The one condition under which offering "Create bucket" is honest. Exported
 * so the page and its tests agree on it rather than each re-deriving the rule.
 *
 * @stability experimental
 */
export function reportsBucketMissing(result: StorageConnectionTestResult | null): boolean {
  return !!result?.checks.some((check) => check.code === 'bucket_missing');
}

// ---------------------------------------------------------------------------
// POST /bucket
// ---------------------------------------------------------------------------

export { STORAGE_BUCKET_STEP_IDS };
/**
 * One bucket-provisioning step id.
 *
 * @stability experimental
 */
export type StorageBucketStepId = (typeof STORAGE_BUCKET_STEP_IDS)[number];

export { STORAGE_BUCKET_STEP_STATUSES };
/**
 * How one step went: `passed`, `failed` or `skipped`.
 *
 * @stability experimental
 */
export type StorageBucketStepStatus = (typeof STORAGE_BUCKET_STEP_STATUSES)[number];

/**
 * ⚠ `guided` IS A SUCCESSFUL 200, NOT AN ERROR. A least-privilege credential
 * without `s3:CreateBucket` is the ORDINARY configuration — an IAM policy
 * scoped to one bucket's objects, or an R2 API token minted object-read-write.
 * The API answers with `guidance.commands`, a paste-ready block carrying this
 * deployment's real values, and rendering that as a failure would tell an
 * administrator their correct setup is broken.
 */
export { STORAGE_BUCKET_OUTCOMES };
/**
 * How bucket provisioning ended.
 *
 * @stability experimental
 */
export type StorageBucketOutcome = (typeof STORAGE_BUCKET_OUTCOMES)[number];

/**
 * One step of bucket provisioning.
 *
 * @stability experimental
 */
export interface StorageBucketStep {
  /** The id. */
  id: StorageBucketStepId;
  /** A human label. */
  label: string;
  /** How it went. */
  status: StorageBucketStepStatus;
  /** What happened, in one sentence. */
  detail: string;
  /** The provider's error, redacted and capped, or `null`. */
  error: string | null;
}

/**
 * The commands to run by hand when the key cannot create buckets.
 *
 * @stability experimental
 */
export interface GuidedBucketInstructions {
  /** Why the credential could not do it — prose, for the alert's body. */
  reason: string;
  /** A ready-to-paste command block, real names already substituted. */
  commands: string;
  /** A runbook link, or `null`. */
  runbook: string | null;
}

/**
 * What `POST /bucket` returns, always HTTP 200: read `outcome`.
 *
 * @stability experimental
 */
export interface StorageBucketProvisionResult {
  /** The outcome; `guided` is not an error. */
  outcome: StorageBucketOutcome;
  /** Which provider: `s3`, `r2` or `s3compatible`. */
  provider: StorageProviderKind;
  /** The bucket name. */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The endpoint the client actually used, or `null` for the SDK default. */
  effectiveEndpoint: string | null;
  /** One entry per step, in order. */
  steps: StorageBucketStep[];
  /** Non-null exactly when `outcome === 'guided'`. */
  guidance: GuidedBucketInstructions | null;
  /** The browser origin the CORS rule names, or `null`. */
  corsOrigin: string | null;
  /** When it ran (ISO). */
  attemptedAt: string;
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

const BASE = '/admin/storage-config';

/**
 * The four `/admin/storage-config` calls over one transport.
 *
 * `PUT`'s `expectedVersion` is passed through as-is, INCLUDING `0` (the check
 * is `!== undefined`, never a truthiness test), so the very first save on a
 * fresh deployment still asserts "nothing is stored yet". `409` means two
 * different things: a version mismatch (reload and re-apply) and
 * `STORAGE_LOCATION_IN_USE` (re-send with `confirmSwitch`); the error's `code`
 * tells them apart. `test` and `provisionBucket` ALWAYS answer HTTP 200: read
 * `success` / `outcome`, never the status.
 *
 * @stability experimental
 */
export interface StorageConfigClient {
  /** `GET` (`storage_config:read`). */
  get(): Promise<StorageConfigView>;
  /** `PUT` (`storage_config:write`): full replace of the seven settings fields; `If-Match` is the loaded version. */
  update(input: StorageConfigInput, expectedVersion?: number, options?: { confirmSwitch?: boolean }): Promise<StorageConfigView>;
  /** `POST /test` (`storage_config:write`): runs against the configuration in the body, saved or not. */
  test(input: StorageConfigInput): Promise<StorageConnectionTestResult>;
  /** `POST /bucket` (`storage_config:write`): creates and hardens the bucket the body names; safe to repeat. */
  provisionBucket(input: StorageConfigInput): Promise<StorageBucketProvisionResult>;
}

/**
 * Builds the storage-config client over a transport.
 *
 * @param api - the app's transport.
 * @returns the client.
 *
 * @stability experimental
 */
export function createStorageConfigClient(api: PlatformApiClient): StorageConfigClient {
  return {
    /** The `get` field. */
    get: () => api.get<StorageConfigView>(BASE),
    /** The `update` field. */
    update: (input, expectedVersion, options = {}) =>
      api.put<StorageConfigView>(
        BASE,
        options.confirmSwitch ? { ...input, confirmation: STORAGE_SWITCH_CONFIRMATION } : input,
        expectedVersion === undefined ? undefined : { ifMatch: String(expectedVersion) },
      ),
    /** The `test` field. */
    test: (input) => api.post<StorageConnectionTestResult>(`${BASE}/test`, input),
    /** The `provisionBucket` field. */
    provisionBucket: (input) => api.post<StorageBucketProvisionResult>(`${BASE}/bucket`, input),
  };
}
