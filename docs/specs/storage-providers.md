# Object Storage Providers

> **Status:** shipped · **Code:** `packages/platform-api/src/storage/` (`@marinoscar/platform-api/storage`; [slice README](../../packages/platform-api/src/storage/README.md); the drivers are in `drivers/`), `packages/platform-contract/src/storage/` (the wire shapes), `packages/platform-web/src/storage/` (the page, the hook and the driver panel registry) · **API:** `/api/admin/storage-config/*` (see `/api/docs`) · **Admin UI:** `/admin/settings/storage` · **Runbook:** [storage-configuration.md](../runbooks/storage-configuration.md) · **Recipe:** [Add a driver from an app or package](#add-a-driver-from-an-app-or-package)

Object storage is configured at runtime by an administrator, with no restart.
Each kind of object store is a **storage driver**. The platform ships three,
all speaking the S3 protocol (`s3` for AWS S3, `r2` for Cloudflare R2,
`s3compatible` for any S3-compatible endpoint); an app or package adds more
with `registerStorageDriver` (§4). The `storage` system-settings namespace
holds the active driver's id and every driver's non-secret settings, the
encrypted credential store holds the driver's secrets, and every storage call
resolves the two into a provider built by the active driver. Every consumer
injects the same `STORAGE_PROVIDER` token and never sees the difference.

## 1. Purpose

A deployment needs one place to put files: uploads, avatars, job artifacts,
AI outputs and database backups. This feature lets an operator choose the
driver, its location and its credential from the admin UI, prove the
configuration works before saving it, create and harden the bucket (or
whatever the driver's equivalent is), and rotate the key without a restart.
An app built from the template adds its own object store (Azure Blob, Google
Cloud Storage, a local disk) without editing a package, and gets the admin
form, the encrypted secrets and every storage consumer for free.

There are no storage environment variables. No variable names a provider,
bucket, region, endpoint or credential; the admin UI is the only source.

What it is not:

- **Not a migration tool.** Switching bucket or provider does not copy
  objects (§2.7).
- **Not multi-bucket.** One configuration is live at a time. Objects written
  under an earlier configuration keep their recorded `bucket` and
  `storage_provider`, but are not readable through the new one.
- **Not a bundled non-S3 store.** The platform ships the S3 family. Azure
  Blob, Google Cloud Storage or a local disk are drivers an app registers (§4);
  the reference app's `local-fs` driver is a worked example, not a production
  recommendation.

## 2. How it works

### 2.1 Configuration model: settings plus a separate secret

The `storage` namespace (`systemStorageSchema` in
`packages/platform-contract/src/storage/settings-schemas.ts`, re-exported by
`apps/api/src/common/schemas/settings.schema.ts`) stores two fields:

| Field | Notes |
|---|---|
| `provider` | The id of the active driver: a built-in (`s3`, `r2`, `s3compatible`; `BUILTIN_STORAGE_PROVIDER_KINDS`) or any id an app registered. A pattern (`^[a-z][a-z0-9-]{1,47}$`), not an enum. |
| `drivers` | A record, driver id to that driver's own non-secret settings, each entry validated by the driver's `settingsSchema`. Every registered driver has an entry, defaults filled. |

The three built-in drivers keep the settings they always had. Each is a
driver of the S3 family and declares one secret, `secretAccessKey`:

| Setting | `s3` | `r2` | `s3compatible` | Notes |
|---|---|---|---|---|
| `bucket` | yes | yes | yes | No default, ever. `''` means "not configured". |
| `region` | yes | yes | yes | Required for `s3`. |
| `endpoint` | yes | yes | yes | Required for `s3compatible`. An explicit value always wins, for every driver. |
| `accountId` | | yes | | R2 only; the endpoint is derived from it (`deriveR2Endpoint`). |
| `accessKeyId` | yes | yes | yes | An identifier, shown in the UI. Not a secret. |
| `forcePathStyle` | yes | yes | yes | Tri-state: `true`, `false`, or `null` (use the vendor default; §2.4). |

- Every string defaults to `''`, and `readNamespace` validates each setting
  independently (against the driver's own schema), so one corrupted field does
  not lose the others.
- A **stored entry for a driver that is no longer registered** (its package was
  removed) is ignored with one warning per process; it stays stored until the
  next save.
- **A secret is never in the namespace.** A driver declares its secrets
  (`StorageDriverDefinition.secrets`); they live in `CredentialsService`. A
  custom driver's are at `(purpose: 'storage_<id>', name: <secret name>)`, the
  purpose registered for it by `registerStorageDriver`. The built-ins keep the
  one address they have always used, `(purpose: 'storage', name: 'default')`
  (`packages/platform-api/src/storage/storage-credential.constants.ts`), through
  `credentialAddress`.
- Two compile-time and registration-time proofs hold the line.
  `StorageSettingsCarriesNoSecret` breaks the build if `secretAccessKey`,
  `secretKey`, `password` or similar names are added to `systemStorageSchema`;
  `registerStorageDriver` throws for a `settingsSchema` field named like a
  secret (`secretAccessKey`, `apiKey`, `token`, `password`, ...).

**Compatibility with the flat shape.** Before drivers were pluggable the
namespace stored six flat fields (`bucket`, `region`, `endpoint`, `accountId`,
`accessKeyId`, `forcePathStyle`). They are still understood:

- **Read.** A stored row with no `drivers` reads unchanged: its flat fields
  become `drivers.<provider>`, field by field (so one damaged field keeps the
  bucket next to it). Nothing is migrated; no migration exists.
- **Published.** `GET /api/system-settings` and `GET /api/admin/storage-config`
  keep the six flat fields as a deprecated read view of the active built-in
  driver (empty for a driver that does not declare them).
- **Accepted.** PUT, PATCH and the admin routes accept the flat fields as
  aliases of the settings of the driver named by `provider`. A write stores
  `{ provider, drivers }` only, so the first write after an upgrade converts
  the row.
- **Ambiguous is a `400`.** A flat field and `drivers.<provider>` that name
  one setting with different values are refused (`details.reason`
  `STORAGE_CONFLICTING_SETTINGS`) rather than guessing which one was meant.

### 2.2 Resolution and its cache

`StorageConfigService.resolve()` joins the namespace and the decrypted secrets
of the active driver into a `StorageConfigResolution`:

- `{ configured: true, config }`: a `ResolvedStorageConfig` (`provider`,
  `bucket`, `region`, `endpoint?`, the driver's parsed `settings` and its
  decrypted `secrets`). `bucket`, `region` and `endpoint` come from the
  driver's `location` (R2 endpoint derived, fallback region applied).
- `{ configured: false, provider, missing }`: every missing field name, not
  just the first (`string[]`). A provider id with no registered driver is
  `missing: ['driver']`, never a crash.

Caching is asymmetric:

- **The settings half is cached** for `STORAGE_POLICY_CACHE_MS` (5 s).
- **The secrets are never cached.** Each is re-read from
  `CredentialsService.getSecret` on every call, so a rotated key is live on
  the next call and no plaintext copy sits on a singleton.
- **A failed settings read propagates** as a `500`. There is no safe fallback
  for a call that may write bytes.
- **`invalidateCache()`** must run synchronously after a settings write and
  before the audit row. A credential-only rotation does not need it.

**"Configured" is the active driver's definition.** The service asks the
driver's pure `missing(settings, secrets)` (default: every `required` declared
secret that is absent); it holds no per-driver rule. For the S3 family the
single definition is `resolveS3Config` in
`packages/platform-api/src/storage/drivers/s3/s3-config.ts` (`resolveStorageConfig`
there is its deprecated, S3-only wrapper over the flat policy). It injects
nothing; the secret is an argument. The provider, the 503 path, the connection
test and the bucket provisioner all ask it. It requires:

| Driver | Always | Plus | Fallback region |
|---|---|---|---|
| `s3` | `bucket`, `accessKeyId`, secret | `region` | none |
| `r2` | same | `accountId`, unless `endpoint` is set | `auto` |
| `s3compatible` | same | `endpoint` | `us-east-1` |

Anonymous access is not supported: a public bucket cannot serve a presigned
URL or complete a multipart upload.

### 2.3 `ResolvingStorageProvider`

`STORAGE_PROVIDER` is bound with `useClass: ResolvingStorageProvider`
(`storage-providers.module.ts`), unless the app passes
`StorageModule.forRoot({ provider })`, which replaces it for every consumer
(and overrides whatever driver the settings select). Each of its thirteen
`StorageProvider` methods is one line: resolve the delegate, call the same
method. The delegate is the `StorageProvider` the **active driver's `build`**
returned. Consumers
(`ObjectsService`, `ProfileImageService`, `AvatarService`,
`ObjectProcessingService`, `StorageCleanupHandler`, the database-backup
services, `ExampleChecksumHandler`, `NodeDataPlaneService`, AI storage) are
unaware of it.

- **It never throws at construction**, so an unconfigured install boots.
- **Delegate cache:** at most two built providers (`DELEGATE_CACHE_LIMIT = 2`),
  least recently used. An evicted provider is closed with its own `destroy()`
  when it has one (the S3 provider destroys its `S3Client`). Two lets an upload
  in flight finish on the previous provider after a save.
- **Cache key:** a SHA-256 fingerprint of the resolved configuration,
  including the secrets (`fingerprintStorageConfig`). A new secret, or a switch
  of driver, means a new provider on the next call. Never log the fingerprint;
  use `describeStorageConfig` for log lines.

#### The `getBucket()` snapshot

`StorageProvider.getBucket(): string` is synchronous, and callers
(`ObjectsService.initUpload`, the database-backup runner) write its result
onto rows that outlive the request. It answers from
`StorageConfigService.lastKnownBucket()`: the bucket named by the last
successful settings read that named one. That value is warmed once at startup
(best-effort) and refreshed by every async method. A later empty read does
not clear it. If nothing is known, `getBucket()` throws
`StorageNotConfiguredError.unresolved()` (a `503`); it never returns `''`.

### 2.4 The S3 family: one provider, three driver shapes

The three built-in drivers (`drivers/s3/`) share one provider class,
`S3StorageProvider`, for all three vendors.
`buildS3ClientConfig` (`packages/platform-api/src/storage/providers/s3/s3-storage.provider.ts`)
turns a resolved configuration into `S3ClientConfig`. Endpoint and region are
already resolved (§2.2); this function adds the path-style default and the
checksum flags.

| Driver | Endpoint | Region | `forcePathStyle` default | Checksums |
|---|---|---|---|---|
| `s3` | SDK default host | operator's | `false` | SDK default |
| `r2` | derived from `accountId` | `auto` | `false` | `WHEN_REQUIRED` |
| `s3compatible` | operator's | `us-east-1` | `true` | SDK default |

- **`forcePathStyle` is tri-state.** `null` (the shipped default) applies the
  table's default. An explicit `true` or `false` always wins, for every
  driver. A plain boolean cannot say "unset", and a stored `false` breaks
  MinIO, which requires path style.
- **R2 checksum flags.** `@aws-sdk/client-s3` v3.729.0+ sends a CRC32
  `x-amz-trailer` by default, which R2 rejects with a misleading signature
  error. `requestChecksumCalculation` and `responseChecksumValidation` are set
  to `'WHEN_REQUIRED'` for `r2` only. Do not widen this condition.
- **`CopySource` encoding.** `setMetadata` uses `CopyObjectCommand` with
  `MetadataDirective: 'REPLACE'`. The SDK does not encode `CopySource`, so
  `encodeCopySource` percent-encodes the key segment by segment and keeps `/`.
  `Key` stays raw.
- `buildS3ClientConfig` is exported so the S3 connection test and bucket
  provisioner (`drivers/s3/s3-connection-test.ts`, `s3-provision.ts`) build
  clients exactly as the real provider does.

### 2.5 Unconfigured deployments answer 503

A fresh install has no storage until an administrator fills in the form.
Every storage call in that state throws `StorageNotConfiguredError`, a `503`:

- `.missing(provider, missing)` — the ordinary case. The body names every
  missing field (never a value) and the remedy path `/admin/settings/storage`.
- `.unresolved()` — only from `getBucket()` (§2.3).

Not `500`: nothing is broken, and the same request succeeds once the form is
saved. Not `''`: an empty bucket written to a row fails months later, when a
sweep or a restore cannot find the object.

### 2.6 Admin probes answer 200

`POST /api/admin/storage-config/test` and `POST /api/admin/storage-config/bucket`
run against the **submitted, unsaved** body, so an operator can prove a new
bucket before committing to it. A blank submitted secret uses the stored one.

**Both answer HTTP `200` even when the diagnosis is bad.** The result is in
the body: `success` for the test, `outcome` for the bucket action. The
production error envelope hides detail, so a diagnosis sent as a 4xx would
arrive as "Request failed". Only real transport failures (auth, RBAC,
malformed body, a bug) are 4xx/5xx. Read the field, not the status.

Each probe is a delegation: the service prepares the submitted configuration
(the stored settings, then the submitted `drivers` entry, validated by the
driver; the submitted secrets or the stored ones), calls the **active
driver's** `testConnection` or `provision`, redacts every string it returns,
and audits the attempt. A driver that throws is answered as a failed result,
not a `500`.

**Connection test.** `success` is the driver's `ok` and, when it reports
`checks`, every check passed. The result always carries a driver-authored
`message` and optionally `details` (small non-secret facts: a directory, a
region). The S3 family reports four checks, separately, in order:
`credentials` → `bucket` → `roundTrip` → `presignedUrl`. A check that could
not run because an earlier one failed is `skipped`, not `failed`. A driver with
no steps returns `checks: []` and a message.

- `bucket` distinguishes `bucket_missing` (HeadBucket 404) from
  `bucket_forbidden` (403). On a 403 only, a second `ListBuckets` call
  disambiguates `credentials_rejected`.
- `roundTrip` writes a throwaway object under a probe prefix and deletes it.
- Every error string is redacted; every attempt is audited.

**Bucket provisioning.** The result is always the same four steps, reported
separately: `create`, `publicAccessBlock`, `encryption`, `cors`. The S3 family
fills them in; a driver that reports no steps gets one `create` step carrying
its message and the rest `skipped`. A driver with no `provision` answers
`outcome: 'failed'` with every step `skipped` and a message saying it has no
bucket or container to create.

- `publicAccessBlock` and `encryption` are AWS-only and `skipped` for `r2` and
  `s3compatible` (R2 buckets are private and encrypted already).
- `cors` runs for every S3-family driver. The rule allows `PUT`/`GET`/`HEAD` from
  `APP_URL`'s origin and exposes `ETag`. Without `ETag` exposed, the browser
  multipart upload transfers every byte and then cannot complete.
- `LocationConstraint` is sent only for a non-`us-east-1` `s3` region.
- `outcome` is `created`, `already_exists`, `partial`, `guided` or `failed`.

**`guided` is a designed-in path, not an error.** A credential without
`s3:CreateBucket` is ordinary least privilege (and R2 tokens usually lack
bucket-admin scope). `guided` carries `guidance.reason`, `guidance.commands`
(a paste-ready block with this deployment's real bucket, region, endpoint and
CORS origin), and `guidance.runbook` (`STORAGE_RUNBOOK_PATH`,
`docs/runbooks/storage-configuration.md`). It fires only on a permission or
unsupported-API denial, never on a rejected credential or an unreachable
endpoint. The shape matches the database backup's `guided` outcomes.

### 2.7 The SWITCH confirmation

`PUT /api/admin/storage-config` answers `409` when a save would **relocate**
a configured deployment while rows still point at the old location:

- Relocation means a different driver (`provider`), or a different location
  as the driver reports it (`StorageDriver.location`): its `bucket` (a
  container or a directory for another driver) or its *effective* endpoint (the
  derived R2 host counts). `region`, `accessKeyId` and `forcePathStyle` do not.
  Moving to a new driver strands existing objects exactly like moving to a new
  bucket.
- The 409 names the counts, for example
  `1,284 object(s) and 30 database backup(s) still point at s3 bucket "old-bucket"`.
- Re-send with `{"confirmation":"SWITCH"}` to proceed.
- Silent on a first configuration (`bucket` was `''`) and when nothing would
  be stranded.

**The confirmation acknowledges; it does not migrate.** No object is copied.
Existing `storage_objects` rows, avatars and `database_backup_runs` archives
keep addressing the old bucket. Downloads 404 and old backups become
unrestorable, with no error logged.

`PUT` names the active driver (`provider`) and merges the submitted
`drivers.<id>` entries over the stored settings (an omitted setting keeps its
stored value, `''` clears a text setting, `null` resets a driver to its
defaults), each validated by the driver that owns it, plus an optional secret
rotation (blank preserves the stored secret). It checks `If-Match` before
touching the credential and re-checks it inside the settings write. A rotation
is audited with the actor; the value never is.

### 2.8 The storage driver contract

A storage driver is a plain object (`StorageDriverDefinition`,
`packages/platform-api/src/storage/drivers/storage-driver.ts`) registered with
`registerStorageDriver`. It is one implementation of the `storage-driver`
pluggable kind (`storageDriverKind`, built with `definePluggableKind` of
`@marinoscar/platform-api/core`), so the registry, the per-driver settings
record, the secret declaration and the generated form descriptor are the same
machinery the AI providers use. The three built-ins register through that same
function; there is no private fast path and no S3 code outside
`drivers/s3/`.

**The definition** (what an admin form needs):

| Member | Required | Meaning |
|---|---|---|
| `id` | yes | `^[a-z][a-z0-9-]{1,47}$`. **Permanent** once a setting, a secret or an object row exists: it is the key of `storage.drivers`, the value of `storage.provider`, `StorageProvider.kind` and `storage_objects.storage_provider`. |
| `label`, `description` | label yes | What the admin page shows. |
| `settingsSchema` | yes | A `z.object` of the driver's **non-secret** settings only. `.describe('help')` is a field's help text, `.meta({ label })` its label. A field named like a secret is refused at registration. |
| `defaults` | yes | The settings of a fresh install; must parse with `settingsSchema`. |
| `secrets` | no | `[{ name, label, required, help? }]`: an account key, a connection string, a service account. Kept encrypted in the credential store, by default at the credential purpose `storage_<id>` under the secret's own name (the purpose is registered for you; registration throws if another owner already holds it). |
| `credentialAddress(name)` | no | Where a secret lives when it must not use `storage_<id>`. The built-ins use it to keep `(storage, default)`. The purpose is then the caller's to register. |
| `egressHosts(settings)` | no | The hosts an instance calls, for the Doctor's network-egress view. Empty for a local backend. |

**The operations** (what the slice calls). Each receives
`{ settings, secret(name), logger, partSize, appOrigin }`: the driver's parsed
settings (defaults filled), a resolver for the secrets it declared (`null`
when none is stored), and the slice's context.

| Operation | Required | Called by | Rules |
|---|---|---|---|
| `build(ctx)` | yes | `ResolvingStorageProvider`, when the configuration (settings or secrets) changes | Returns the `StorageProvider` every consumer shares. Not called per request; `destroy()` is called on the previous provider when it has one. |
| `testConnection(ctx)` | yes | `POST /test` | **Never throws**; every failure is `{ ok: false, message }`. Never returns secret material, not even in `message` or `details`. May return `checks` (a per-step report). |
| `provision(ctx)` | no | `POST /bucket` | Creates the bucket or container. Safe to repeat. Omit it for a backend with no such concept. |
| `listKeys(ctx, prefix)` | no | `npm run storage:purge` | Every object key under `prefix`; the purge deletes each through the provider. |
| `purge(ctx, { prefixes, dryRun })` | no | `npm run storage:purge` | A purge the driver does itself (S3 versioned buckets need every version removed); takes precedence over `listKeys`. |
| `location(settings)` | no | The admin view, the switch gate, every row that records where bytes went | `{ bucket, endpoint?, region? }`. Default: `settings.bucket`, else the driver id. Pure. |
| `missing(settings, secrets)` | no | `StorageConfigService.resolve()` | The names of what is still unset, `[]` when complete. Default: every `required` secret that is absent. Pure; names only, never values. |
| `defaultRegion` | no | The resolved configuration | The region used when the settings state none. |

**Delegation.** The connection test, bucket provisioning, the purge, the
Doctor egress row and the resolving provider hold no per-driver `switch`: each
asks the active driver. A provider id with no registered driver (its package
was removed) is "not configured, missing `driver`" on a read and a `400
STORAGE_UNKNOWN_DRIVER` on a write.

**Purge.** `runStoragePurge` enumerates only the registered key prefixes (§4).
What deleting them means is the driver's: `purge` if it defines it, else
`listKeys` plus a delete through the provider. A driver with neither answers
the outcome `unsupported`: nothing is listed or deleted, and
`npm run storage:purge` prints `The <id> storage driver can neither purge nor
list its keys; nothing was done.` and exits `3` (`0` is success, `2` a
confirmation that did not match the live bucket).

**Doctor egress.** The `network.egress` view lists the active driver's
`egressHosts`: the id `storage.s3` for the three built-ins (the id the S3 family
has always had) and `storage.<driver id>` for any other. A driver with no hosts
contributes no row.

**Conformance.** `describeStorageDriverConformance` (§5) is the kit every
driver runs. It cannot prove everything: a driver that buffers a whole upload
in memory is indistinguishable from one that pipes it, from outside (§5).

## 3. Configuration and permissions

**Settings:** the `storage` namespace (§2.1) and the active driver's credentials (the built-ins' `storage` credential; another driver's `storage_<id>` purpose).

**Environment:** only four deployment limits, in
`apps/api/src/config/configuration.ts`. None of them names a location or a
credential (§1):

| Variable | Default | Meaning |
|---|---|---|
| `MAX_FILE_SIZE` | 10 GB | Largest upload accepted; enforced on resumable-upload init (`413`) and caps the simple upload's multipart limit (the smaller of 100 MB and this) |
| `ALLOWED_MIME_TYPES` | empty (allow every type) | Upload type allowlist; exact types or `type/*` wildcards, else `415` |
| `SIGNED_URL_EXPIRY` | 3600 s | Presigned URL lifetime |
| `STORAGE_PART_SIZE` | 10 MB | Multipart part size |

`SECRETS_ENCRYPTION_KEY` is required in practice: a driver's secrets live
in the encrypted store. `SES_REGION` remains an environment-backed fallback
default for the SES email transport; its AWS credential lives in its own
settings field and encrypted credential-store entry, not the environment.

**Permissions:** `storage_config:read` and `storage_config:write`, seeded
Admin only. They are distinct from `system_settings:*` and from `storage:*`
(§6). The matrix lives in [ARCHITECTURE.md](../ARCHITECTURE.md). The
`Storage` card in `apps/web/src/config/adminSections.tsx` is gated on
`storage_config:read`; write controls are disabled inside the page without
`storage_config:write`.

| Route | Purpose | Permission |
|---|---|---|
| `GET /api/admin/storage-config` | The active driver, every driver's settings and descriptor, `configured`, `missing`, `effectiveEndpoint`, masked `secretStatus`. Never decrypts a secret. | `storage_config:read` |
| `PUT /api/admin/storage-config` | Select the driver and merge its settings; blank secret preserves; `If-Match`; `409` + `SWITCH` on relocation | `storage_config:write` |
| `POST /api/admin/storage-config/test` | The active driver's `testConnection` against the submitted config; always `200` | `storage_config:write` |
| `POST /api/admin/storage-config/bucket` | The active driver's `provision` (the S3 family creates and hardens the bucket); always `200`, may be `guided` | `storage_config:write` |

**Wire shape** (the zod schemas are in `@marinoscar/platform-contract/storage`;
the details are the generated OpenAPI):

| Message | Fields |
|---|---|
| `GET` / `PUT` response | `provider`, `drivers` (every registered driver's settings, defaults filled), `descriptors` (one `PluggableDescriptor` per registered driver: its settings fields, then one write-only `secret` field per declared secret carrying only `hasValue`), `configured`, `missing` (`string[]`), `effectiveEndpoint`, `secretStatus`, `version`, `updatedAt`, `updatedBy`, and the six deprecated flat fields (§2.1) |
| `PUT`, `/test` and `/bucket` bodies | `provider`, `drivers` (`{ <id>: settings }`, `null` resets a driver), `secrets` (`{ <id>: { <name>: value } }`; blank keeps the stored value), the legacy aliases (the flat fields and `secretAccessKey`), and, on `PUT`, `confirmation` |
| `/test` result | `success`, `provider`, `bucket`, `region`, `effectiveEndpoint`, `usedStoredSecret`, `checks`, `message`, `details`, `attemptedAt` |
| `/bucket` result | `outcome`, `provider`, `bucket`, `region`, `effectiveEndpoint`, `steps`, `guidance`, `corsOrigin`, `message`, `attemptedAt` |

Errors: a `400` whose `details.reason` is `STORAGE_UNKNOWN_DRIVER` (the id is
not registered; the message lists the registered ones),
`STORAGE_DRIVER_SETTINGS_INVALID` (the driver's schema refused the settings;
`details.fields` names them) or `STORAGE_CONFLICTING_SETTINGS` (§2.1), and the
`409` `STORAGE_LOCATION_IN_USE` of the switch gate (§2.7).

Two limits of the wire shape today: `secretStatus` describes only the active
driver's **first** declared secret (every driver's presence is in
`descriptors`), and a descriptor has no flag saying whether the driver
implements `provision`, so the page learns that only from the answer to
**Create bucket**. A driver's `message` is a plain string.

## 4. Extending it in a fork

The slice's extension points, with a reference-app example each, are catalogued in the [storage slice README](../../packages/platform-api/src/storage/README.md#extension-point-catalog). The numbered recipe for the app side is [EXTENDING.md, Add a storage driver](../EXTENDING.md#add-a-storage-driver).

- **Use storage:** import `StorageProvidersModule`, inject `STORAGE_PROVIDER`
  and call the `StorageProvider` interface
  (`packages/platform-api/src/storage/providers/storage-provider.interface.ts`).
  Handle `StorageNotConfiguredError` as the `503` it is.
- **Add a vendor that speaks S3:** it usually needs nothing new; use
  `s3compatible` with an endpoint. If it needs a driver tweak (as R2's
  checksums did), add a modelled setting or a narrow branch in
  `buildS3ClientConfig`, and cover it in `s3-storage.provider.spec.ts`.
- **Add a non-S3 backend (Azure Blob, Google Cloud Storage, a local disk):**
  register a driver (below). The admin page, the encrypted secrets and every
  consumer follow.
- **Replace the object store outright (rung 3):** for a backend that is not
  configured at runtime, implement `StorageProvider` (including `kind`, the id
  written to the rows) and bind it through the slice:
  `StorageModule.forRoot({ provider: { useClass: YourProvider } })`. It
  overrides whatever driver the settings select and every package consumer
  receives it. A provider declared in an app module does not reach them,
  because every package module imports `StorageProvidersModule` and Nest
  resolves the token there first. Recipe:
  [EXTENDING.md](../EXTENDING.md#replace-the-object-store).
- **Process uploads:** register an `ObjectProcessor` with
  `ObjectProcessorRegistry` from its `onModuleInit` (the
  `OBJECT_PROCESSOR` token no longer exists). Recipe:
  [`apps/api/src/examples/storage/README.md`](../../apps/api/src/examples/storage/README.md).
- **Never** add an environment variable for provider, bucket, region,
  endpoint or credential.
- **Write under a new key prefix:** declare it, or `npm run storage:purge`
  (`appctl deploy uninstall --purge-storage`) leaves its objects in the
  bucket. The purge enumerates only the prefixes registered in the storage
  key-prefix registry (`packages/platform-api/src/storage/storage-key-prefix.registry.ts`;
  `allKeyPrefixes()` of the booted app), never a filtered listing of the whole
  bucket, because a filter can be inverted by a later edit and a fixed
  enumeration cannot. Register a `StorageKeyPrefixDef` (`id`, `prefix`,
  `owner`, `description`, and `scope`: `org`, `user` or `deployment`) with
  `registerKeyPrefix` from the app's manifest
  (`apps/api/src/app-registrations/storage-prefixes.ts` is loaded by
  `apps/api/src/platform/storage/storage-key-prefix.manifest.ts`), and build
  keys with `buildObjectKey(id, { orgId, userId }, ...parts)`. A prefix ends
  with exactly one `/`, has no leading `/` and no `//`, and neither repeats nor
  overlaps another registered prefix; anything else fails at registration with
  a `RegistryError`. Name the writer's constant `*_KEY_PREFIX`:
  `apps/api/src/platform/storage/storage-key-prefixes.spec.ts` scans
  `apps/api/src` and `packages/platform-api/src` for every such literal and
  fails on one no registered prefix covers.
- **Key layout:** new objects of an org-scoped prefix are written under
  `<prefix><orgId>/…` (uploads: `uploads/<orgId>/<timestamp>/<uuid><ext>`), so
  an organization's objects are one listable prefix per root
  (`orgKeyPrefixes(orgId)`). Rows written before keep their stored
  `uploads/<timestamp>/…` key; reads, downloads and deletes use the stored key
  and never rebuild one, and the full purge's root prefixes cover both
  layouts. Org offboarding combines `orgKeyPrefixes(orgId)` with the stored
  keys of `storage_objects WHERE org_id = $1`.

### Add a driver from an app or package

The definition and operations are in §2.8; the steps:

1. **Define it** (`StorageDriverDefinition`, from `@marinoscar/platform-api/storage`):
   an `id`, a `label`, a `settingsSchema` of the non-secret settings,
   `defaults`, `secrets` for each key or token, `build` and `testConnection`,
   and, as the backend allows, `provision`, `listKeys` or `purge`, `location`,
   `missing` and `egressHosts`. Keep the vendor's SDK in the driver's own
   files.
2. **Register it at import time**, before the application bootstraps:
   `registerStorageDriver(def)`. The reference app does it in
   `apps/api/src/app-registrations/storage.ts`, which
   `apps/api/src/platform/storage/storage.config.ts` imports first. The
   registry freezes at bootstrap (a later call throws `FROZEN`), a duplicate id
   throws, and a malformed definition throws (a bad id, a secret-named
   setting, defaults that do not parse, a missing operation). A package ships a
   driver as a module-scope `registerStorageDriver(...)` behind an entry the
   app imports.
3. **That is all.** Registering gives the driver:
   - **A settings record.** `drivers.<id>` in the `storage` namespace,
     validated by its `settingsSchema` on every write.
   - **An admin form.** `GET /api/admin/storage-config` serves its descriptor;
     the page draws a generated form with write-only fields for its secrets,
     **Test connection** and **Create bucket**, with no web code. To replace
     the generated form, register a panel with `registerStorageDriverPanel` of
     `@marinoscar/platform-web/storage/ui` (the API still validates every save).
   - **A credential purpose** for its secrets (`storage_<id>`), never an
     environment variable.
   - **Every consumer.** Once an administrator selects and saves it, the
     objects API, profile images, exports, database backups and the node object
     store write through the provider it builds. Selecting it relocates the
     deployment, so while objects exist the `SWITCH` confirmation (§2.7)
     applies.
   - **Purge, egress and backups.** `npm run storage:purge` uses its
     `purge` or `listKeys` (§2.8); the Doctor lists its `egressHosts`; its id
     is a valid `databaseBackup.storageProvider` (a backup pins the driver id
     the way it pins `r2`).
4. **Run the kit:** `describeStorageDriverConformance(driver, { describe, it,
   expect, settings, secrets })` from `@marinoscar/platform-api/storage/testing`
   (§5), against a fake (a temporary directory, an in-memory SDK, a local
   emulator).
5. **Prove it with the real consumers:** select the driver through the admin
   routes and assert a profile image, an export and a backup land under it.

**Worked example: `local-fs`** (`apps/api/src/platform-extensions/storage/local-fs.driver.ts`,
registered by `app-registrations/storage.ts`, proven by
`apps/api/test/examples/storage/local-fs-driver.spec.ts` and, on the web,
`apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx`).
Objects are files under one directory on the API host, written through a
temporary file and one `rename`; no secret. It is registered but **off** until
an administrator selects it: a fresh install keeps `s3`. Its limits are the
example's, and a fork that selects it must know them:

- **Signed download URLs need a route the app mounts.** The driver signs
  `<origin>/api/local-fs/objects/<token>` with a key derived from
  `SECRETS_ENCRYPTION_KEY` (`deriveSigningKey`), and exports
  `verifyLocalFsToken` for the other half. The app mounts **no** such route by
  default, so a deployment that selects the driver must add one that verifies
  the token and streams the object; without it a download URL returns `404`.
- **No browser-direct uploads.** The resumable upload (presigned part URLs) and
  signed PUT URLs raise a clear error; server-side uploads (profile images,
  exports, backups, node output) are fully supported.
- It is a single-host store: a second API instance does not see the files
  unless the directory is a shared volume.

## 5. Guardrails

| Invariant | Test |
|---|---|
| Required fields per S3 flavour; every missing field reported; region/endpoint fallbacks; `deriveR2Endpoint` | `packages/platform-api/test/storage/drivers/s3/s3-config.spec.ts` |
| Fingerprint changes with the secret, the driver and any setting; `describeStorageConfig` never includes a secret | `packages/platform-api/test/storage/config/storage-config.spec.ts` |
| The namespace reads a row stored in the flat shape unchanged, salvages it field by field, drops an unregistered driver, merges and validates `drivers.<id>` per driver, and writes the new shape only | `packages/platform-api/test/storage/config/storage.system-settings.spec.ts`, `apps/api/test/settings/settings-catalog.spec.ts` |
| The three built-ins register through `registerStorageDriver` and pass the driver kit | `packages/platform-api/test/storage/drivers/s3/s3-driver.conformance.spec.ts` |
| The driver kit itself fails what it claims to fail (a throwing or secret-echoing `testConnection`, a wrong `kind`, a `listKeys` that leaks) | `packages/platform-api/test/storage/testing/driver-conformance.spec.ts` |
| An app-registered driver is listed, off until selected, tested, provisioned and selected through the admin routes, and every consumer (profile image, export, backup) writes through it | `apps/api/test/examples/storage/local-fs-driver.spec.ts` |
| The Doctor egress row asks the active driver for its hosts (`storage.s3` for the built-ins, `storage.<id>` otherwise, none for a local driver) | `packages/platform-api/test/storage/config/doctor/egress/storage.egress.contributor.spec.ts`, `apps/api/test/doctor/network-egress.integration.spec.ts` |
| Settings cache TTL, `fresh: true`, `invalidateCache()`; secret never cached; `lastKnownBucket()` rules; failed read propagates | `packages/platform-api/test/storage/config/storage-config.service.spec.ts` |
| Never throws at construction; delegate reuse, rotation and bounded eviction; unconfigured 503; `getBucket()` never returns `''` | `packages/platform-api/test/storage/providers/resolving-storage.provider.spec.ts` |
| Provider table; explicit `forcePathStyle` wins; R2-only checksum flags; `CopySource` encoding | `packages/platform-api/test/storage/providers/s3/s3-storage.provider.spec.ts` |
| Masked secret; `If-Match`; blank-preserves rotation; switch gate; invalidation ordering | `packages/platform-api/test/storage/config/storage-config-admin.service.spec.ts` |
| Four checks, `skipped` vs `failed`, 404 vs 403, redaction, auditing | `packages/platform-api/test/storage/config/storage-connection-test.service.spec.ts` |
| CORS rule, `LocationConstraint`, all outcomes, `guided` with real values, runbook path | `packages/platform-api/test/storage/config/storage-bucket-provision.service.spec.ts` |
| Permissions per route; no secret in any response; probes answer `200` | `apps/api/test/settings/storage-config.integration.spec.ts` |
| The page is drawn from the descriptors the API serves; a registered panel replaces the generated form; the built-in forms' markup is unchanged; a secret is sent once, under `secrets.<id>`, and never rendered | `packages/platform-web/test/storage/StorageConfigPage.drivers.test.tsx`, `packages/platform-web/test/storage/storageDriverPanelRegistry.test.ts`, `packages/platform-web/test/storage/StorageGenericDriverPanel.test.tsx`, `packages/platform-web/test/storage/StorageConfigPage.builtin-dom.test.tsx`, `apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx` |
| Key prefixes: well formed, no overlap, rejected at registration; every `*_KEY_PREFIX` literal in `apps/api/src` and `packages/platform-api/src` registered; writers match their entries; the purge enumerates exactly the registered prefixes of the booted app, purges a key-listing driver through its provider and answers `unsupported` (exit `3`) for a driver that can do neither | `apps/api/src/platform/storage/storage-key-prefix.registry.spec.ts`, `apps/api/src/platform/storage/storage-key-prefixes.spec.ts`, `apps/api/src/storage-purge.main.spec.ts`, `packages/platform-api/test/storage/purge/run-storage-purge.spec.ts` |
| Scopes and the key builder: org keys need an organization (the default org only in single mode), `orgKeyPrefixes` lists only org prefixes, legacy keys stay under their root | `packages/platform-api/test/storage/key-prefix-registry.spec.ts`, `apps/api/test/storage/org-keys.db.spec.ts` |
| Processors register through the registry and run on upload | `packages/platform-api/test/storage/processing/object-processor.registry.spec.ts`, `apps/api/src/examples/storage/example-metadata.processor.spec.ts` |
| The slice's invariants in the consuming app (prefixes, org keys, no secret) | `apps/api/test/storage/storage-conformance.spec.ts` (the `storage` conformance suite) |
| The cleanup cron only enqueues | `apps/api/test/conformance.spec.ts`, suite `cron-enqueue-only` (scans the storage slice's root) |

The unit suites mock the AWS SDK. They prove request shapes and error
classification, not live vendor behaviour.

**The driver kit** (`describeStorageDriverConformance` of
`@marinoscar/platform-api/storage/testing`) is runner-agnostic: it takes the
runner's `describe`, `it` and `expect`, the driver (or its id), valid
`settings` and a value for each declared `secrets` entry, and needs no network
(point the driver at a fake). It checks, each scenario skippable by name with
a reason of the caller's:

| Scenario | What it proves |
|---|---|
| `definition` | A valid id and label, defaults that parse with the driver's own schema, `build` and `testConnection` present |
| `provider` | The full `StorageProvider` surface, a `kind` equal to the driver id, a `getBucket()` that names the configured location |
| `roundTrip` | Put, exists, head, get, delete (twice: a missing object is not an error), exists after |
| `streamedUpload` | A 6 MiB stream from a lazily generated source round-trips byte for byte |
| `signedUrl` | A signed GET URL (declare `supportsSignedUrls: false` if the backend cannot sign; pass `readSignedUrl` to fetch it and compare bytes) |
| `listKeys` | When defined: exactly the keys under the prefix, none outside it |
| `testConnection` | Never throws and never returns secret material, with valid settings, with the defaults and no secrets, and with a sentinel secret it must not echo into `message`, `details` or `checks` |
| `provision` | When defined: can be repeated |
| `pure` | `location` and `missing`, when defined, are pure and well formed |

**What the kit cannot prove.** It cannot detect a driver that buffers a whole
stream in memory before writing it: from outside, that is indistinguishable
from one that pipes it, and the rule that a backup archive is never buffered
([database-backup.md](database-backup.md)) is the driver author's to keep (the
S3 provider uses the SDK's multipart `Upload`; `local-fs` uses `pipeline`). It
also cannot prove the secret never reaches a log line or an error a consumer
later prints.

## 6. Design decisions

- **Secret outside the namespace.** `GET /api/system-settings` returns the
  whole document and every write is copied into an audit row's `meta`. A
  secret there would be one admin `GET` from a browser and one audit query
  from a permanent plaintext copy.
- **`accessKeyId` in the namespace.** It is an identifier sent in clear in
  every SigV4 request. Showing it lets an operator tell a rotated key from a
  mistyped one.
- **A delegating provider, not `useFactory`.** A factory resolves once at boot,
  losing live reconfiguration, and cannot boot an unconfigured install.
- **One provider class for the S3 family, three driver definitions.** All
  three vendors use the same protocol and SDK; only a few config lines differ,
  so `S3StorageProvider` is one class and `s3`, `r2` and `s3compatible` are
  three small definitions over shared code in `drivers/s3/`.
- **A driver registry, not a wider enum.** The provider kind was a closed list
  used as a `z.enum` in several schemas and a `switch` in the connection test,
  the provisioner, the purge and the egress labels. Adding Azure meant editing
  all of them. A registered driver carries its own schema, secrets and
  operations, and the slice calls it. Rejected: keeping the enum and adding
  members, which forces a package edit per backend and cannot give a backend
  fields of its own.
- **The built-ins use the public path.** If `s3` had a private fast path, an
  app's driver would be a second-class citizen and the registry would be
  unproven. The cost is that S3 code moves to `drivers/s3/` and the services
  delegate.
- **Per-driver settings in a record, secrets by purpose.** `drivers.<id>`
  keeps every driver's settings side by side, so selecting another driver and
  back loses nothing, and a driver's schema never leaks into another's. Secrets
  use one credential purpose per driver (`storage_<id>`) so a driver's keys are
  addressed and rotated like any other credential. Rejected: a free-form
  `settings` blob (no validation) and one shared secret slot (a second secret
  has nowhere to go).
- **The flat fields stay readable.** Existing rows, scripts and clients use
  them. Read-time folding means no data migration and no flag day; writing the
  new shape only converts a row on its first save. A contradiction is a `400`
  rather than a guess.
- **`testConnection` never throws, even though the service guards it.** A
  refused request is a diagnosis, not a failure, and the service converting a
  throw into a failed result is a net, not a contract. The kit fails a driver
  that throws.
- **Secret never cached.** One indexed lookup and one AES-GCM decrypt per call
  is cheap next to a network round trip, and a revoked key stops working on
  the next call.
- **`storage_config:*`, not `system_settings:*`.** A wrong bucket or secret
  breaks every upload, avatar, artifact and backup at once. Same "distinct
  blast radius" argument as `push:*`, `nodes:*` and `broadcasts:*`.
- **`storage_config:*`, not `storage:*`.** `storage:*` gates object access and
  is seeded to Viewer and Contributor; reusing it would show the credential
  screen to every user.
- **No permanent env fallback.** Two sources of truth for the live credential
  is the ambiguity this design removes. A fallback only some deployments use
  is untested until a rotation depends on it.
- **Switch gated, not blocked.** Blocking would leave a deployment that must
  change vendor no path forward. The count makes "are you sure?" answerable.
- **No copy on switch.** A bucket-to-bucket copy of unbounded data is a queue
  job with its own design (resumability, conflicts, uploads mid-copy), not a
  clause in a `PUT`.
- **No per-object historical provider resolution.** It would thread a
  provider identity through every method or cache a client per past
  configuration. `storage_objects.bucket`/`.storage_provider` already record
  where each object is.
- **`getBucket()` stays synchronous.** Making it async is the right long-term
  fix but touches every consumer, including backup call sites inside a retry
  loop around an `INSERT`.

## 7. Verification

```bash
npx jest --config packages/platform-api/test/jest.config.js --rootDir packages/platform-api test/storage   # the slice, the drivers, the kit
npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/storage test/settings
npm run test:run --workspace=@marinoscar/platform-web -- test/storage
npm run test:run --workspace=web -- src/__tests__/examples/storage StorageConfigPage
```

Against a real provider, follow the
[runbook](../runbooks/storage-configuration.md):

1. Open `/admin/settings/storage`, fill in the form and click **Test connection**. All
   four checks should pass.
2. If the bucket does not exist, use **Create bucket**. Expect `created`, or
   `guided` with paste-ready commands.
3. Save, then upload a profile picture. It should appear without a restart.
4. Rotate the secret and upload again. The new key is used immediately.
5. With a driver an app registered (the reference app's `local-fs`): open the
   same page, choose it, click **Test connection** (expect a message and the
   directory in `details`) and **Create bucket**, save, upload a profile
   picture, and see the file under `<directory>/objects/`. Select the S3 driver
   again: its settings are as you left them.
6. Run `npm run storage:purge` (a dry run) against it: the report lists the
   registered prefixes. For a driver that defines neither `purge` nor
   `listKeys`, it prints the `unsupported` message and exits `3`.

## History

- #108 added the encrypted credential store that holds the storage secret.
- #373 (epic #372) added the `storage` namespace, the encrypted secret,
  `StorageConfigService` and `ResolvingStorageProvider`, with a temporary
  environment bridge.
- #374 added one driver for three provider shapes, tri-state
  `forcePathStyle`, R2's checksum flags and the `CopySource` fix.
- #375 added the `/api/admin/storage-config` API: read, replace, test,
  create bucket, and the SWITCH gate.
- #376 added the `/admin/settings/storage` page.
- #377 removed `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`
  and the bridge, and moved the SES region fallback to `SES_REGION`.
- #378 added the operator runbook and wired `guidance.runbook` to it.
- #519 enforced `MAX_FILE_SIZE` on resumable-upload init and the simple
  upload's multipart limit, and changed the `ALLOWED_MIME_TYPES` default to
  empty (allow every type).
- #585 moved the SES AWS credential off environment variables and onto its
  own admin-configurable settings field + encrypted credential-store entry,
  exactly like the SMTP password.
- #736 (PP-8.3) moved the slice into `@marinoscar/platform-api/storage`,
  `@marinoscar/platform-contract/storage` and `@marinoscar/platform-web/storage`,
  replaced `OBJECT_PROCESSOR` with `ObjectProcessorRegistry`, added scopes and
  org-aware keys to the key-prefix registry, and split the purge into
  `runStoragePurge` and the thin `apps/api/src/storage-purge.main.ts`.
- #925 (PP-14.7, epic #918) opened the provider kind: `registerStorageDriver`
  and the `storage-driver` pluggable kind, the `{ provider, drivers }` shape of
  the `storage` namespace with read-time compatibility for the flat fields, the
  S3 code moved into the built-in drivers (`drivers/s3/`), the connection test,
  provisioning, purge and egress delegated to the active driver,
  `describeStorageDriverConformance`, the web driver panel registry and generic
  panel, and the `local-fs` example in the reference app.
