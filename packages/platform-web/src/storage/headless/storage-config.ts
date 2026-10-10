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
 * A DRIVER'S SECRETS ONLY EVER TRAVEL ONE WAY
 * =============================================================================
 *
 * No response type below carries a secret (the S3 secret access key, or any
 * secret a custom driver declares), because no endpoint returns one — the API
 * holds them in the encrypted credential store and answers with
 * {@link StorageSecretStatus} (a masked hint for the active driver's first
 * secret) and `hasValue` on each `secret` field of a descriptor. A secret
 * appears in exactly one place in this file: the optional, WRITE-ONLY `secrets`
 * (and the built-ins' deprecated `secretAccessKey` alias) on
 * {@link StorageConfigInput}, where blank/absent means "keep the stored one".
 * Nothing here, and nothing built on it, should grow a field that could hold
 * the real value coming back.
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

import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import {
  BUILTIN_STORAGE_PROVIDER_KINDS,
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
 * The storage drivers the platform ships (`s3`, `r2`, `s3compatible`). NOT a
 * closed set since PP-14.7 (#925): an app or package registers more with
 * `registerStorageDriver` (`@marinoscar/platform-api/storage`), and the page
 * lists whatever `descriptors` the API serves. Use this for the built-ins' own
 * questions ("is this one of the S3 flavours"), never to validate a provider.
 */
export { BUILTIN_STORAGE_PROVIDER_KINDS, STORAGE_PROVIDER_KINDS };

/**
 * One of the three built-in drivers.
 *
 * @stability experimental
 */
export type BuiltinStorageProviderKind = (typeof BUILTIN_STORAGE_PROVIDER_KINDS)[number];

/**
 * Which object store this deployment talks to: a registered driver's id
 * (`s3`, `r2`, `s3compatible`, or an app's own such as `local-fs`).
 *
 * @stability experimental
 */
export type StorageProviderKind = string;

/**
 * One driver's non-secret settings, as the driver's own schema defines them
 * (`drivers.s3.bucket`, `drivers.local-fs.directory`, ...).
 *
 * @stability experimental
 */
export type StorageDriverSettings = Record<string, unknown>;

/**
 * Every field the configuration needs and might not have. The built-in
 * drivers' vocabulary; a custom driver names its own, so
 * {@link MissingStorageConfigField} is any string.
 *
 * `secretAccessKey` is in here even though it is not a settings field: from
 * "can this deployment store a file?", a missing credential row and an empty
 * bucket are the same kind of problem. Mirrors
 * `MISSING_STORAGE_CONFIG_FIELDS`.
 */
export { MISSING_STORAGE_CONFIG_FIELDS };
/**
 * A field the configuration needs and does not have: a setting or secret name
 * of the active driver.
 *
 * @stability experimental
 */
export type MissingStorageConfigField = string;

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
  /** The active driver's id: `s3`, `r2`, `s3compatible` or a registered driver's own. */
  provider: StorageProviderKind;
  /**
   * Every registered driver's own non-secret settings, defaults filled, keyed by
   * driver id. The current shape: the page edits these.
   */
  drivers: Record<string, StorageDriverSettings>;
  /**
   * One descriptor per registered driver (`kind: 'storage-driver'`): its label
   * and a field per setting, then one `secret` field per declared secret
   * (presence only, never a value). The page lists drivers from these and
   * draws the form of a driver that has no registered panel from them.
   */
  descriptors: PluggableDescriptor[];
  /** @deprecated Read view of `drivers.<provider>.bucket` (the built-ins); `''` when the active driver has none. */
  bucket: string;
  /** @deprecated Read view of `drivers.<provider>.region` (the built-ins). */
  region: string;
  /** @deprecated Read view of `drivers.<provider>.endpoint` (the built-ins), verbatim. `''` when there is none. */
  endpoint: string;
  /** @deprecated Read view of `drivers.<provider>.accountId` (`r2` only). */
  accountId: string;
  /** @deprecated Read view of `drivers.<provider>.accessKeyId` (the built-ins): an identifier, never the secret. */
  accessKeyId: string;
  /** @deprecated Read view of `drivers.<provider>.forcePathStyle`. TRI-STATE: `null` is "use this vendor's convention", not `false`. */
  forcePathStyle: boolean | null;
  /**
   * Where the active driver's client would actually be pointed at — READ-ONLY,
   * and derived server-side (for R2, from `accountId`), so a settings page never
   * builds that host itself. `null` for plain AWS S3, where the SDK builds its
   * own, and for a driver with no endpoint.
   */
  effectiveEndpoint: string | null;
  /** The single definition of "this deployment can store a file". */
  configured: boolean;
  /** Every setting or secret of the active driver standing in the way of `configured`. */
  missing: MissingStorageConfigField[];
  /** The masked status of the active driver's first declared secret (the built-ins': the secret access key). */
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
 * The body of `PUT`, `POST /test` and `POST /bucket` — the same fields in all
 * three, which is what lets the two probes run against a configuration that has
 * NOT been saved yet.
 *
 * `provider` is the only required field. `drivers` merges settings over the
 * stored ones, per driver (`null` resets that driver to its defaults); a
 * string field the admin cleared is sent as `''`, because an absent key keeps
 * the stored value. `secrets` is WRITE-ONLY: a blank value is omitted (keep the
 * stored one), and there is no way to erase a stored secret here.
 *
 * @stability experimental
 */
export interface StorageConfigInput {
  /** The driver to use: a registered driver's id. */
  provider: StorageProviderKind;
  /** Settings to merge over the stored ones, by driver id; `null` resets a driver. */
  drivers?: Record<string, StorageDriverSettings | null>;
  /** WRITE-ONLY. Secrets by driver id and declared name. Omitted entirely when nothing was retyped. */
  secrets?: Record<string, Record<string, string>>;
  /** @deprecated Alias of `drivers.<provider>.bucket` (the built-ins). */
  bucket?: string;
  /** @deprecated Alias of `drivers.<provider>.region` (the built-ins). */
  region?: string;
  /** @deprecated Alias of `drivers.<provider>.endpoint` (the built-ins). */
  endpoint?: string;
  /** @deprecated Alias of `drivers.<provider>.accountId` (`r2`). */
  accountId?: string;
  /** @deprecated Alias of `drivers.<provider>.accessKeyId` (the built-ins). */
  accessKeyId?: string;
  /** @deprecated Alias of `drivers.<provider>.forcePathStyle` — TRI-STATE, `null` means "vendor convention". */
  forcePathStyle?: boolean | null;
  /** @deprecated WRITE-ONLY alias of `secrets.<provider>.secretAccessKey` (the built-ins). */
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
  /** Which provider (driver id). */
  provider: StorageProviderKind;
  /** The bucket (or, for a driver without one, whatever the driver names its location). */
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
  /** Which driver was tested (its id). */
  provider: StorageProviderKind;
  /** The bucket name (the driver's location). */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The endpoint the client actually used, or `null` for the SDK default. */
  effectiveEndpoint: string | null;
  /** True when the submitted body left a declared secret blank, so the stored one was used. */
  usedStoredSecret: boolean;
  /**
   * One entry per check, in order. The four S3 checks for a built-in driver;
   * `[]` for a driver that reports only {@link StorageConnectionTestResult.message}.
   */
  checks: StorageConnectionCheck[];
  /** The driver's own one-line verdict (secret material already redacted). Present for a custom driver. */
  message?: string;
  /** The driver's own safe key/value facts (a directory, a container, a version). Never a secret. */
  details?: Record<string, string | number | boolean>;
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
  /** Which driver (its id). */
  provider: StorageProviderKind;
  /** The bucket name (the driver's location). */
  bucket: string;
  /** The region (`auto` for R2). */
  region: string;
  /** The endpoint the client actually used, or `null` for the SDK default. */
  effectiveEndpoint: string | null;
  /** One entry per step, in order. Skipped for a driver without `provision`. */
  steps: StorageBucketStep[];
  /** The driver's own one-line outcome. Present for a custom driver, and for a driver that cannot provision. */
  message?: string;
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
  /** `PUT` (`storage_config:write`): `provider` plus the `drivers` settings and `secrets` to merge; `If-Match` is the loaded version. */
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
