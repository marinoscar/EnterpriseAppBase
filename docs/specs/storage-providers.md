# Object Storage Providers

> Epic #372, issues #373–#377 (#373 the `storage` settings namespace, the
> encrypted secret, `StorageConfigService`'s per-call resolve-and-cache, and
> `ResolvingStorageProvider` bound to the unchanged `STORAGE_PROVIDER` token;
> #374 one driver for three provider shapes, tri-state `forcePathStyle`, R2's
> checksum flags, and the `CopySource` encoding fix; #375 the
> `/api/admin/storage-config` admin API — read, replace, test, create-bucket;
> #376 the `/admin/settings/storage` admin page; #377 retiring the storage
> environment variables and deleting the env/settings bridge).
>
> Implemented in `apps/api/src/common/schemas/settings.schema.ts`
> (`systemStorageSchema`, `STORAGE_PROVIDER_KINDS`),
> `apps/api/src/storage/storage-credential.constants.ts`,
> `apps/api/src/storage/config/storage-config.ts` (`resolveStorageConfig`,
> `fingerprintStorageConfig`, `describeStorageConfig`, `deriveR2Endpoint`),
> `apps/api/src/storage/config/storage-config.service.ts`,
> `apps/api/src/storage/config/storage-not-configured.error.ts`,
> `apps/api/src/storage/providers/resolving-storage.provider.ts`,
> `apps/api/src/storage/providers/storage-providers.module.ts`,
> `apps/api/src/storage/providers/s3/s3-storage.provider.ts`
> (`buildS3ClientConfig`), `apps/api/src/storage/config/storage-config.controller.ts`,
> `apps/api/src/storage/config/storage-config-admin.service.ts`,
> `apps/api/src/storage/config/storage-connection-test.service.ts`,
> `apps/api/src/storage/config/storage-bucket-provision.service.ts`,
> `apps/api/src/storage/config/storage-probe.support.ts`,
> `apps/api/src/storage/config/dto/` (`storage-config-response.dto.ts`,
> `update-storage-config.dto.ts`, `storage-connection-test.dto.ts`,
> `storage-bucket-provision.dto.ts`), `apps/api/src/common/constants/roles.constants.ts`
> (`STORAGE_CONFIG_READ`/`STORAGE_CONFIG_WRITE`), `apps/api/src/config/configuration.ts`
> (what is left of `storage.*` after #377), `apps/web/src/pages/Admin/StorageConfigPage.tsx`,
> `apps/web/src/components/admin/StorageSwitchConfirmDialog.tsx`,
> `apps/web/src/services/storageConfig.ts`, `apps/web/src/hooks/useStorageConfig.ts`,
> and `apps/web/src/config/adminSections.tsx` (the `Storage` card).
>
> **On what is merged today.** §1 says what changed and why. §2 is the
> configuration model — the settings/secret split (#373). §3 is the resolver
> and its cache (#373). §4 is `ResolvingStorageProvider` — the delegate cache,
> the fingerprint, why `getBucket()` stays synchronous (#373). §5 is one driver
> for three provider shapes (#374). §6 is the admin API and why its two probes
> always answer 200 (#375). §7 is the switch confirmation (#375). §8 is the
> permission pair (#375, #376). §9 is the unconfigured-deployment posture
> (#373). §10 is what #377 removed. §11 is rejected alternatives. §12 is
> verification.

## 1. What this is, and what changed

Before this epic, object storage was deploy-time configuration:
`STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`,
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` were read once, in
`configuration.ts`, at process boot, by a `useFactory` binding that built one
`S3StorageProvider` for the life of the process. Changing a bucket, rotating a
key, or moving from AWS to R2 meant editing `.env` and restarting every API
instance.

Epic #372 makes storage administrator-editable, live, with no restart —
the same shape Web Push (#355) and SMTP already have. The `storage`
system-settings namespace and an encrypted credential now hold the
configuration; `StorageConfigService` resolves the two into a usable client
configuration on every call; `ResolvingStorageProvider` builds (and caches)
an `S3Client`-backed provider from whatever that resolves to right now; and
`/admin/settings/storage` is where an operator sets it, proves it works, and
creates the bucket if it is not there yet.

**What did not change:** the `StorageProvider` interface, its thirteen
methods, and its `STORAGE_PROVIDER` injection token. Nine existing consumers
(`ObjectsService`, `ProfileImageService`, `AvatarService`,
`ObjectProcessingService`, `StorageCleanupHandler`, `DatabaseBackupRunnerService`
and its three siblings, `ExampleChecksumHandler`, `NodeDataPlaneService`)
inject the same token, call the same methods with the same signatures, and get
the same results. Every design decision in §3–§4 below exists to make that
statement true while the configuration behind the token becomes mutable at
runtime.

## 2. The configuration model: settings namespace, secret split from it

`system_settings.global`'s `storage` namespace
(`systemStorageSchema`) holds seven fields: `provider`, `bucket`, `region`,
`endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`. It does **not** hold
the secret access key.

**Why split.** The `storage` namespace is persisted as part of the `global`
`system_settings` document and returned *wholesale* by `GET /api/system-settings`
— every admin who can read system settings gets the entire blob, and every
write of it is copied verbatim into an audit row's `meta`. A secret access
key living in that namespace would be one admin `GET` away from a browser's
memory and one audit query away from a permanent, unencrypted copy. The
secret instead lives in the encrypted credential store (`CredentialsService`,
epic #108) at `(purpose: 'storage', name: 'default')` — see
`storage-credential.constants.ts`. `settings.schema.ts` carries a
compile-time proof of the split: `StorageSettingsCarriesNoSecret` resolves to
`never` (breaking the build) if `secretAccessKey`, `secretKey`, `password` or
four other secret-shaped names are ever added to `systemStorageSchema`.

**Why `accessKeyId` is on the settings side of that line, not the credential
side.** It is an identifier, not a credential: it travels in the clear in the
`Authorization` header of every SigV4 request, and it authorises nothing by
itself. It is the exact counterpart of `smtpUsername` in
`email-settings.schema.ts` (stored, shown, editable), while the secret half
plays the role `smtpPassword` does. An administrator who cannot see which key
id is configured cannot tell a rotated key from a mistyped one — which is the
diagnosis `GET /admin/storage-config` exists to make possible (§6).

**Why every field defaults to `''`, never `null` or an absent key.** It is
what lets the namespace degrade field by field: `readNamespace` validates each
field independently and substitutes that field's default when the stored
value is unusable, so a row with a corrupted `region` still keeps the bucket
an operator typed. `''` is also the persisted, expected "not configured yet"
state — a fresh deployment reads it, and `bucket` carries no `.min(1)`,
because refusing to store an incomplete configuration would make the very
first save of a half-filled form a 400.

**`forcePathStyle` is tri-state** (`true` / `false` / `null`), not a plain
boolean, and `null` — "use this vendor's convention" — is the shipped
default. §5 covers why a plain boolean cannot express "unset" and what broke
before this was fixed.

Whether a configuration is **complete enough to use** is deliberately *not* a
question the schema answers. It is answered in exactly one place —
`resolveStorageConfig` in `storage-config.ts` — described next.

## 3. Resolution: `StorageConfigService`, its cache, and `resolveStorageConfig`

`StorageConfigService.resolve()` joins the two halves — the settings
namespace and the decrypted secret — into a `StorageConfigResolution`:
either `{ configured: true, config }` (a `ResolvedStorageConfig`, every field
already resolved: R2's endpoint derived, a fallback region applied, nothing
left for a caller to look up) or `{ configured: false, provider, missing }`
(every missing field, not just the first — see the rationale in the file's
own header on why partial reporting turns configuring storage into six round
trips through a 503).

**The settings half is cached; the secret never is.** `readPolicy()` caches
the settings namespace for `STORAGE_POLICY_CACHE_MS` (5 seconds — deliberately
the same constant `MaintenanceModeService` uses, for the same reason: short
enough that an edit reaches a fleet within a poll or two, long enough that a
burst of storage calls — ten presigned multipart parts, a hundred retention
deletes — costs one settings read rather than a hundred). The secret access
key is re-read from `CredentialsService.getSecret` on **every** `resolve()`
call and handed straight to the caller; nothing here assigns it to an
instance field. That is a deliberate, asymmetric trade:

- **Cost:** one indexed `credentials` lookup and one AES-GCM decrypt per
  storage operation — microseconds against an operation about to make a
  network round trip to an object store.
- **Benefit:** no long-lived plaintext copy of the deployment's storage
  credential sitting on a singleton for a heap dump or a careless
  `JSON.stringify` to find, and a rotated key takes effect on the **next
  call**, not up to five seconds (or a restart) later. A revoked key still
  working for a five-second window is the kind of thing nobody can explain
  after the fact.

**REJECTED: caching the resolved config, secret and all, for the same five
seconds.** It reads as the obvious optimisation and it quietly undoes both
halves of the trade above at once.

**A failed settings read is not swallowed here**, unlike
`MaintenanceModeService.readPersisted`, which degrades to its last known
value because a global guard runs on every request and cannot turn an
unreadable database into a 500 for the whole app. A storage call that cannot
read its configuration has nothing useful to fall back to — it would build a
client and possibly write bytes against a configuration this process can no
longer confirm — so the read error surfaces as the 500 it honestly is.

**`invalidateCache()`** drops the cached settings read and must be called
**synchronously, before the audit write**, by any path that changes storage
settings — exactly the ordering `MaintenanceModeService.setMaintenance`
already uses. Anything awaited in between (an audit row, a log flush) widens
the window in which this instance still answers from a stale value. It does
not need to run after a credential-only rotation: the secret is never cached,
so a rotation is already live on the next call.

**`lastKnownBucket()`** is the one synchronous escape hatch in an otherwise
fully asynchronous service, described together with its one caller in §4.

**`resolveStorageConfig` (`storage-config.ts`) is the single, pure definition
of "configured."** It is Nest-free and injects nothing — the secret arrives
as a plain argument — precisely so it can be exercised with a literal and a
string, and so the admin API's connection test (§6) can import it without
dragging `SystemSettingsService`/`CredentialsService` into a module that only
wants to build a URL. Every caller that needs to know whether storage is
usable — the provider that builds an `S3Client`, the 503 an unconfigured
deployment returns, the connection test, the bucket provisioner — asks this
one function. What it requires:

- **`bucket`, `accessKeyId`, `secretAccessKey`** — always. There is no default
  bucket, and there must never be one: a guessed name is either a 404 on
  every request or, worse, somebody else's bucket. Anonymous access is
  deliberately not a supported configuration — a public bucket cannot serve
  a presigned URL or complete a multipart upload, so "no credentials" is
  never a deployment choice, it is an unfinished form.
- **`s3`** additionally needs `region` (the SDK will not sign without one,
  and there is no default — `us-east-1` is a real region a bucket elsewhere
  answers with a redirect nobody reads).
- **`r2`** additionally needs `accountId`, *unless* an explicit `endpoint` was
  typed — the endpoint is derived from the account id (`deriveR2Endpoint`),
  so demanding both would reject a working configuration.
- **`s3compatible`** additionally needs `endpoint` — MinIO, Backblaze, Wasabi,
  a Ceph appliance; there is nothing to derive a host from.

An explicitly typed `endpoint` always wins, for every provider — which is
what lets `provider: 's3'` point at a local MinIO for development without
lying about which provider it is.

## 4. `ResolvingStorageProvider`: live reconfiguration behind an unchanged token

`STORAGE_PROVIDER` still resolves to one class
(`storage-providers.module.ts`, `useClass: ResolvingStorageProvider`), and
every one of its thirteen methods is one line: `return (await
this.delegate()).theSameMethod(...)`.

**Why a delegating provider and not `useFactory`.** The obvious alternative —
`{ provide: STORAGE_PROVIDER, useFactory: async () => new
S3StorageProvider(await resolve()) }` — is three lines and wrong in two ways
that do not show up until they break:

1. **It resolves once, at boot.** A factory runs when the container is
   built, so the entire point of this epic — editing storage with no
   restart — is lost. Nine consumers would hold an instance built from a
   configuration that stopped being true the moment somebody saved the
   settings page.
2. **It makes an unconfigured deployment unbootable.** An async factory that
   cannot resolve must either throw (the API never starts — on a *fresh
   install*, which by definition has no storage configured yet, so nobody
   could ever reach the settings page to fix it) or return something broken.
   Both are worse than a 503 on the calls that actually touch storage.

So the indirection — one object allocation and one small array lookup per
call — is permanent. It buys live reconfiguration and a bootable empty
install.

**The delegate cache holds at most two built clients**
(`DELEGATE_CACHE_LIMIT = 2`), least-recently-used, evicting with
`S3Client.destroy()` to release the HTTP agent's connection pool. One is not
enough: a settings edit or a key rotation happening mid-upload would evict
the very client that upload is using, and destroying a live pool aborts
requests in flight. Keeping the immediately-previous configuration lets work
already underway finish against the client it started with. More than two
buys nothing and costs sockets — configurations arrive one at a time, from a
human saving a form, not from a fleet of tenants.

**The cache key is a SHA-256 fingerprint of the resolved configuration,
including the secret** (`fingerprintStorageConfig`). That is what makes a
key rotation take effect without a restart: a new secret produces a new
fingerprint, misses the cache, and a client with the new credential is built
on the very next call. It is a hash rather than the raw values so the secret
never sits on a long-lived instance field a second time — the built
`S3Client` must hold it to sign requests, and that is unavoidable, but
nothing needs to hold a second copy beside it. **Never log the fingerprint
itself** — it is a hash of a secret, and publishing it invites exactly the
offline-guessing attack a hash is otherwise immune to;
`describeStorageConfig` is the secret-free string for log lines.

**`getBucket(): string` is the one synchronous method on an otherwise
asynchronous configuration**, because `StorageProvider.getBucket()` is fixed
by an interface that predates this epic and three of its four call sites
(`ObjectsService.initUpload`, and two `DatabaseBackupRunnerService` sites)
write the return value onto a row that outlives the request. It answers from
`StorageConfigService.lastKnownBucket()` — the bucket named by the last
settings read that *succeeded and named one* — warmed once at startup
(best-effort, detached, swallowed on failure) and refreshed by every one of
the twelve async methods. It throws `StorageNotConfiguredError.unresolved()`
(a 503) rather than ever returning `''`: an empty bucket written onto a
`storage_objects` row does not fail at the time, it fails months later when
a cleanup sweep or a restore tries to address an object and cannot say where
it is. A loud 503 at the moment of the call is fixable by the person who
caused it; a quietly written `''` is a support ticket with no stack trace.
Making `getBucket()` itself asynchronous is the genuinely correct long-term
fix and is explicitly out of scope here — see §11.

## 5. One driver, three provider shapes (#374)

`buildS3ClientConfig` (`s3-storage.provider.ts`) is the single function that
turns a `ResolvedStorageConfig` into `S3ClientConfig` for AWS S3, Cloudflare
R2, or an S3-compatible endpoint (MinIO, Backblaze B2, Wasabi, Ceph RGW).
There are not three provider *classes* — `S3StorageProvider` is one class,
because all three vendors speak the same protocol through the same SDK and
the thirteen method bodies are byte-for-byte identical work; three classes
would triple everything that is the same to express the few lines that are
not. The endpoint and region are **not** decided here — those are already
resolved, per provider, by `resolveStorageConfig` (§3); this function decides
only what the settings namespace cannot express: the path-style default and
the checksum flags.

| kind | endpoint | region | `forcePathStyle` default | checksums |
|---|---|---|---|---|
| `s3` | unset (SDK's own host) | operator's | `false` | SDK default |
| `r2` | derived from `accountId` | `auto` | `false` | `WHEN_REQUIRED` |
| `s3compatible` | operator's | `us-east-1` | `true`* | SDK default |

(*) a **default**, not a rule — `forcePathStyle` is tri-state, and an
operator who explicitly stated `true` or `false` always wins, for every
provider; only `null` (the shipped default) or an absent value lets this row
apply.

**Why `forcePathStyle` is tri-state, and what a plain boolean broke.** Before
#374, path style was *inferred* from `!!endpoint` — true when an endpoint was
set. That inference is wrong for R2, which has an endpoint (the
account-scoped host) and wants virtual-host style, not path style. The fix
had to let an operator's explicit choice beat a per-vendor convention **for
every provider** — MinIO needs path style, R2 does not, and an S3-compatible
appliance behind a certificate that does not cover wildcard subdomains needs
it regardless of who runs it. A plain `z.boolean()` defaulting to `false`
cannot express "the operator has not said anything" — every saved
configuration would carry an explicit `false` into the driver, permanently
shadowing the per-vendor default below it. That was the actual, shipped
regression: selecting `s3compatible`, typing a MinIO endpoint, and saving
produced a deployment MinIO rejects, because MinIO requires path style and
the stored `false` said otherwise. `null` is a boolean's only spelling of
"unset," exactly as `''` is a string's.

**R2's checksum flags.** Since `@aws-sdk/client-s3` v3.729.0, the SDK
computes a CRC32 checksum for every request body by default and sends it as
an AWS-specific trailer (`x-amz-trailer`, chunked transfer encoding). R2
rejects that trailer — uploads fail with a signature-shaped error
(`header 'x-amz-content-sha256' does not match`, or a 400 naming the
trailer) that points nowhere near the actual cause, on a process nobody is
watching. `requestChecksumCalculation: 'WHEN_REQUIRED'` and
`responseChecksumValidation: 'WHEN_REQUIRED'` are set **only** for `r2`, and
that branch must stay exactly that narrow: AWS S3 wants the SDK default, and
an S3-compatible vendor is not R2 merely by not being AWS. If a second vendor
turns out to reject the trailer too, the fix is a modelled setting an
operator can turn on for that configuration — not widening this condition,
which would silently disable integrity checks for every vendor that *does*
support them.

**The `CopySource` encoding fix.** `setMetadata` implements a metadata
update as `CopyObjectCommand` with `MetadataDirective: 'REPLACE'`. `CopySource`
is the one field in the S3 API where a key travels inside a value that is
itself parsed as a path, and the SDK does **not** encode it (every other
command takes `Key` raw and the SDK encodes it). Sending it raw was a latent
bug: a key containing a space, a `+`, or a `%` addressed a *different
object* or failed outright (`+` reads as a space, `%xx` as an already-encoded
byte) — so `setMetadata` on such a key could silently overwrite the metadata
of whichever object the mangled name happened to hit. `encodeCopySource`
percent-encodes the key **segment by segment**, not with one
`encodeURIComponent` over the whole string, because the `/` separators are
structural (bucket from key, and the key's own prefixes) and encoding them
as `%2F` would make a prefixed key unaddressable on S3-compatible servers
that do not decode them back.

`buildS3ClientConfig` is **exported**, deliberately (`#375`): the admin
connection test and the bucket provisioner both build `S3Client`s for
operations that are not `StorageProvider` methods (`HeadBucket`,
`CreateBucket`, `PutPublicAccessBlock`, `PutBucketEncryption`,
`PutBucketCors`) and must build them **the same way** the real provider
does, or a test could pass against a client configured differently from the
one that will actually do the work — a `forcePathStyle` default that
disagrees between the two is exactly the discrepancy that makes a MinIO
connection test pass and every upload fail.

## 6. The admin API (#375): four routes, two of them always answer 200

`StorageConfigController` (`/api/admin/storage-config`):

| Route | Permission | What it does |
|---|---|---|
| `GET` | `storage_config:read` | The `storage` namespace plus a masked `secretStatus`, `configured`, `missing`, and the derived `effectiveEndpoint`. |
| `PUT` | `storage_config:write` | Full replace of the seven fields, plus an optional secret rotation. `secretAccessKey` blank preserves the stored one. `409` if the save relocates a deployment that still holds objects (§7). |
| `POST /test` | `storage_config:write` | Runs four checks against the **submitted, unsaved** body. |
| `POST /bucket` | `storage_config:write` | Creates and hardens the bucket the **submitted** body names. |

**Why the two probes are `:write`, not `:read`.** Both are side-effecting:
`POST /test` writes a throwaway object into the target bucket (and deletes
it), and `POST /bucket` creates real infrastructure. `:read` is held by
anyone who may *look at* the configuration, and looking is not writing — the
identical argument `EmailSettingsController` makes for its own test-send
endpoint.

**Why both probes test the request body, not the saved row.** An operator
moving to a new bucket must be able to prove a configuration *before*
committing the deployment to it. A test that could only exercise what was
already saved would mean the only way to try a new bucket is to break the
running one first, and then discover — with uploads already failing — that
the new key lacks `s3:PutObject`.

**⚠ Both probes answer HTTP 200 even when the diagnosis is bad, and this is
the single most important fact about this API.** A refused `HeadBucket` or a
credential without `s3:CreateBucket` is a *diagnosis*, not a transport
failure — and this application's error envelope
(`HttpExceptionFilter`) suppresses detail in production while the web client
funnels every 4xx/5xx into generic failure handling. Routing the answer
through an error status would discard exactly the detail these endpoints
exist to deliver: "the bucket exists but this key may not see it" would
arrive as "Request failed." So the outcome travels in the body —
`success: boolean` for the test, `outcome: 'created' | 'already_exists' |
'partial' | 'guided' | 'failed'` for the bucket action — and a caller that
reads the HTTP status instead of the field reports success for every
misconfiguration there is. A genuine transport failure (not authenticated,
not permitted, a malformed body, a bug in this API) is still a real 4xx/5xx;
only a *result about the object store* rides in the 200 body.

**`POST /test`'s four checks, always reported separately, never collapsed
into one boolean:** `credentials` → `bucket` → `roundTrip` → `presignedUrl`,
in that order, because each needs a different fix. The check that does the
most work is `bucket`: a `HeadBucket` failure is disambiguated into
`bucket_missing` (404 — no such bucket, create it) versus `bucket_forbidden`
(403 — it exists and this key may not see it, so widen the policy *or* check
for a typo that landed on somebody else's bucket) — **deliberately never
collapsed**, because `HeadBucket`'s HTTP `HEAD` response carries no body and
therefore no S3 error code, so a bare 403 is ambiguous between "wrong key
entirely" and "right key, wrong bucket." On exactly that 403 branch — and
only that branch, so a healthy configuration costs one round trip — a second
`ListBuckets` call (a `GET`, whose errors *do* carry a code) disambiguates
credential rejection from bucket-scoped denial. A check that could not be
attempted because an earlier one failed is `skipped`, never `failed` —
reporting four failures for one cause sends an operator looking for four
problems they do not have.

**`POST /bucket`'s four steps** (`create`, `publicAccessBlock`, `encryption`,
`cors`), each reported separately because partial success is the *common*
case, not the exception — creating and hardening a bucket is four API calls
against four different IAM actions, and a key permitted the first is
routinely not permitted the rest. `publicAccessBlock` and `encryption` are
**AWS-only** and reported `skipped` for `r2`/`s3compatible` — not laziness:
R2 buckets are private and encrypted at rest unconditionally, so the goal
those steps exist for is already met, and an S3-compatible server is free
not to implement either AWS-specific API. `cors` runs for **every**
provider, because it is the one step whose absence breaks the product rather
than loosening it: the browser multipart path reads `ETag` off each
`UploadPart` response and posts the list to
`POST /storage/objects/:id/upload/complete`, and a cross-origin `fetch`
cannot read a response header absent from `Access-Control-Expose-Headers`.
A bucket whose CORS rule omits `ExposeHeaders: ['ETag']` therefore transfers
every byte of a large upload successfully and then fails to complete it,
with a browser-side error naming neither CORS nor the bucket — which is the
whole reason this endpoint exists rather than a documentation page saying
"create a bucket by hand."

**⚠ `outcome: 'guided'` is a 200, and it is a designed-in path, not a
fallback or an error.** An application credential without
`s3:CreateBucket` is the *ordinary* least-privilege configuration — a
well-run deployment scopes its IAM policy to one bucket's objects, and
Cloudflare R2 API tokens are routinely minted object-read-write with no
bucket-admin scope at all. `guided` carries `guidance.reason`,
`guidance.commands` (a complete, paste-ready command block with this
deployment's *real* bucket, region, endpoint and CORS origin already
substituted — never a placeholder), and `guidance.runbook`
(`docs/runbooks/storage-configuration.md`, wired up by this same
documentation issue — §6.1). This mirrors the identical `guided` shape
`db-backup`'s `CREATEROLE`/`CREATEDB` gates already use, down to the field
names.

### 6.1 `guidance.runbook`

Before this document existed, `guidance.runbook` was hard-coded `null` —
`StorageBucketProvisionService.provision` said so explicitly, because a link
to a file that is not there is worse than no link, and nothing in the repo
checked a JSON response field the way `test/docs-links.spec.ts` checks a
Markdown link. `STORAGE_RUNBOOK_PATH` in `storage-bucket-provision.service.ts`
now names `docs/runbooks/storage-configuration.md` (this epic's operator
runbook — see the companion document), the same shape as
`RESTORE_RUNBOOK_PATH` (`db-backup/restore-preflight.service.ts`) and
`NODE_JOB_SECRETS_RUNBOOK_PATH` (`db-backup/pg-job-role.broker.ts`): one
exported constant, read at the one call site, so the string is never
retyped. The response field's Zod type (`z.string().nullable()`) is
unchanged — nullability is what let #375 ship this endpoint before the
runbook existed, and it costs nothing to keep now that it does.

## 7. The switch confirmation, and what it does *not* do

`PUT /admin/storage-config` answers `409 Conflict` when a save would
**relocate** an already-configured deployment — a different `provider`, a
different `bucket`, or a different *effective* endpoint (the derived R2 host,
not only the raw `endpoint` field, so "move to a different Cloudflare
account" counts even though `endpoint` itself stays `''`) — while rows still
name the old location. `region`, `accessKeyId` and `forcePathStyle` are
**not** a relocation: they change how the same bytes are reached, not where
they are. The 409 body names the exact counts —
`"1,284 object(s) and 30 database backup(s) still point at s3 bucket
\"old-bucket\""` — because "are you sure?" is not a question anyone can
answer; a number is. Re-sending with `{"confirmation":"SWITCH"}` proceeds
anyway. The gate is silent on a first configuration (`current.bucket === ''`,
so nothing can be stranded) and silent when the counts are genuinely zero.

**⚠ The confirmation acknowledges; it does not migrate.** Saving a new
location does **not** copy a single object. Every `storage_objects` row keeps
its `storage_key`, every avatar keeps its URL, every `database_backup_runs`
row keeps the archive it points at — and all of them now address a bucket
this deployment no longer talks to. Downloads 404; backups become
unrestorable; and nothing in the application logs an error, because nothing
is broken from the object store's own point of view — it simply does not
have those keys. `{"confirmation":"SWITCH"}` is the operator saying "I
understand that," not a request to fix it. §11 records why an automatic copy
was rejected.

## 8. Permissions: `storage_config:read` / `storage_config:write`

A pair of its own — **neither** `system_settings:*` **nor** `storage:*`,
which are the two pairs that look like they would already cover this:

- **Not `system_settings:*`.** A wrong bucket, a wrong endpoint, or a
  rotated-out secret does not degrade one feature; it breaks every upload,
  avatar, job artifact and database backup in the deployment **at once**,
  and immediately, because the configuration is resolved per call with no
  restart in between. That is the same "distinct blast radius" argument
  `nodes:*`, `db_backup:*`, `broadcasts:*` and `push:*` each made before it.
- **Not `storage:*`**, the closer-looking mistake — that pair gates *object
  access* and is seeded to Viewer and Contributor, so every ordinary user of
  this application already holds `storage:read`. Reusing it here would put
  the deployment's credential-bearing configuration screen in front of the
  entire user base.

Both are seeded Admin-only. The Settings UI Pattern (`CLAUDE.md` rule 3, and
`docs/specs/settings-ui.md`) requires the registry card's `permission` field
to be the exact string the controller enforces — the `Storage` card in
`adminSections.tsx` is gated on `storage_config:read`, so `PUT`/`POST /test`/
`POST /bucket` are gated **inside** the page by disabling controls, exactly
as every other `Operations`/`General` card with a single read permission
does.

## 9. The unconfigured-deployment posture: 503, never `''`

A running, healthy API with nowhere to put a file is a state that could not
exist when storage came from the environment — a deployment either had
`S3_BUCKET` set or it failed to start. Making storage runtime-configurable
creates that state deliberately: a fresh install is in it from first boot
until an administrator fills in the form, and any deployment returns to it
the moment somebody clears `bucket`. Every storage call's answer in that
state is `StorageNotConfiguredError` — a `503`, not a `500` and not an empty
string:

- **Not `500`**, because neither the request nor the server is broken — the
  work is genuinely unavailable *right now*, and the identical request
  succeeds the moment the form is filled in, with nothing about the caller
  having changed.
- **Not `''`**, because an empty bucket written onto a `storage_objects` or
  `database_backup_runs` row is a lie that is written to disk: it does not
  fail at the time, it fails months later when a cleanup sweep or a restore
  tries to address the object and cannot say where it is.

`StorageNotConfiguredError.missing(provider, missing)` is the ordinary case
— the settings row and/or the credential are incomplete, and the body names
every missing field (never a value — a field name carries nothing an
attacker did not already know from the public settings schema) plus the
remedy path (`/admin/settings/storage`). `.unresolved()` is the narrower case
raised only by `getBucket()` (§4) — a synchronous question with no
synchronous answer, because no settings read has succeeded in this process
yet, or the one that did named no bucket.

## 10. What #377 removed

`STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, and the
temporary env-to-settings bridge that #373–#376 shipped alongside the
settings namespace (so a deployment upgrading mid-epic was never left
without a working configuration) are all gone. What remains in
`configuration.ts`'s `storage.*` block is four **deployment limits**, never
a storage location: `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`,
`SIGNED_URL_EXPIRY`, `STORAGE_PART_SIZE`. None of them names a storage
account, none of them is a secret, and none of them changes where bytes go —
which bucket, region, endpoint, provider and credential is answered in
exactly one place (§2–§3), and adding any of the five removed variables back
would restore the two-sources-of-truth ambiguity this epic exists to end.

**⚠ `email.sesRegionFallback` now reads `SES_REGION`, not `S3_REGION` — a
breaking change for SES.** Before #377, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` were shared between email (SES) and storage (S3) —
the same two variables, read twice, on the theory that both talked to AWS.
`S3_REGION` doubled as SES's region fallback for the same reason. Epic #372
gives storage its own credential in the encrypted store, and `storage.s3.*`
no longer exists — so SES's region fallback needed a name of its own that
did not imply it was still borrowed from storage. A deployment that relied
on `S3_REGION` to region SES, and has not set `sesRegion` in the `email`
settings namespace, must now set `SES_REGION`. `AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY` remain, but now belong to email alone.

**`SECRETS_ENCRYPTION_KEY` is, in practice, now required for a working
deployment**, though it remains formally optional at boot (an API with no
key still starts — see `docs/runbooks/rotate-secrets-encryption-key.md`).
Before this epic, a deployment could run uploads entirely off environment
variables and never touch the encrypted credential store. Since the storage
secret access key now lives there unconditionally, any deployment that wants
uploads, avatars or database backups to work must have
`SECRETS_ENCRYPTION_KEY` set — the same key that was already needed the
moment any *other* runtime-configured credential (an SMTP password, a VAPID
key) was stored, but no longer optional-in-practice the way it was when
storage did not participate.

## 11. Rejected alternatives

- **Settings-first with an environment-variable fallback, kept permanently**
  (mirroring how Web Push's `VAPID_*` variables still work alongside its
  admin UI — see §1.1 of `docs/runbooks/vapid-keys.md`). This is genuinely
  **lower risk** than a hard cutover, and #373–#376 shipped exactly that
  bridge as a temporary migration aid. It was **rejected as the permanent
  shape by product decision**, not by a technical constraint: two sources of
  truth for which credential is live is the exact ambiguity this epic exists
  to remove, and a fallback that only some deployments ever exercise is a
  code path nobody tests in anger until the day a rotation depends on it.
  #377 deletes the bridge once every consumer was confirmed to read the
  settings/credential pair.
- **Three provider classes** (`S3Provider`, `R2Provider`,
  `S3CompatibleProvider`) instead of one driver function. Rejected: all
  three speak the same protocol through the same SDK, so three classes would
  triple every method body that is byte-for-byte identical work to express
  four lines (§5's table) that actually differ.
- **Per-object legacy-provider resolution**, so an object written under the
  old bucket stays readable by resolving *its own* recorded provider/bucket
  rather than the currently-configured one. Rejected: it would mean every
  one of the twelve `StorageProvider` methods takes a provider identity as
  an argument (or `ResolvingStorageProvider` holds a client *per historical
  configuration ever used*, unbounded), for a feature — reading old objects
  after a switch — that `storage_objects.bucket`/`.storage_provider` already
  record faithfully as "where this object actually is," which an operator
  can act on by hand. The switch gate (§7) exists precisely so this
  fragmentation is a deliberate, acknowledged choice rather than a silent
  default.
- **Blocking the switch entirely while objects exist.** Rejected: a
  deployment that genuinely needs to move providers (a compliance
  requirement, a vendor shutting down) would have no path forward at all
  except manually clearing every row first. The 409-with-counts-plus-typed-
  confirmation shape gives the operator the number that makes "are you
  sure?" answerable, without making a legitimate migration impossible.
- **Copying objects as part of the switch.** Named explicitly in
  `StorageConfigAdminService`'s own comments so it is not proposed as an
  "obvious" follow-up: a bucket-to-bucket copy of an unbounded amount of
  data is, by this repository's own MANDATORY job-queue rule, a queue job —
  not a clause an HTTP `PUT` executes inline. It would also need to be
  resumable, reconcile keys that exist in both places, and decide what
  happens to an upload that arrives mid-copy. That is a real feature with
  its own design, not a checkbox on a settings form.
- **Making `StorageProvider.getBucket(): string` asynchronous.** This is the
  *correct* long-term fix — §4 says so plainly — and is out of scope here
  because it touches nine consumers, two of which (the database-backup call
  sites) use the synchronous result inside a retry loop around an `INSERT`,
  so making it async is not free of judgement about where the await lands
  inside a transaction-shaped critical section. Worth doing deliberately, in
  its own change with its own tests, not as a side effect of making storage
  configurable.

## 12. Verification

| Claim | Where it is asserted |
|---|---|
| `resolveStorageConfig` requires bucket/accessKeyId/secretAccessKey for every provider, plus the correct per-provider field, and reports every missing field (not just the first) | `apps/api/src/storage/config/storage-config.spec.ts` |
| Region/endpoint fallbacks (R2 `auto`, s3compatible `us-east-1`, no fallback for `s3`) apply only when the operator typed nothing, and an explicit value always wins | `apps/api/src/storage/config/storage-config.spec.ts`, the `describe('forcePathStyle')` and endpoint-fallback blocks |
| `deriveR2Endpoint` builds the account-scoped host and never includes the bucket | `apps/api/src/storage/config/storage-config.spec.ts`, `describe('deriveR2Endpoint')` |
| `fingerprintStorageConfig` is stable for an unchanged configuration and changes when the secret changes | `apps/api/src/storage/config/storage-config.spec.ts`, `describe('fingerprintStorageConfig')` |
| The settings cache honours its TTL, is bypassed by `{ fresh: true }`, and is dropped by `invalidateCache()` | `apps/api/src/storage/config/storage-config.service.spec.ts`, `describe('the settings cache')` |
| The secret is re-read from the credential store on every `resolve()` call, never served from the settings cache | `apps/api/src/storage/config/storage-config.service.spec.ts`, `describe('the secret')` |
| `lastKnownBucket()` is populated only by a read that named a bucket, is never cleared by a later empty read, and updates on a successful change | `apps/api/src/storage/config/storage-config.service.spec.ts`, `describe('lastKnownBucket()')` |
| A failed settings read propagates rather than degrading to a stale or default value | `apps/api/src/storage/config/storage-config.service.spec.ts`, `describe('a failed settings read')` |
| `ResolvingStorageProvider` never throws at construction, even before anything is configured | `apps/api/src/storage/providers/resolving-storage.provider.spec.ts` |
| A method call resolves the configuration and hands the provider *kind* through to the built client | `apps/api/src/storage/providers/resolving-storage.provider.spec.ts`, `'hands the resolved provider KIND to the client it builds (#374)'` |
| The delegate cache reuses a client for an unchanged configuration, builds a new one when the secret changes, is bounded at 2 entries, and destroys the evicted one | `apps/api/src/storage/providers/resolving-storage.provider.spec.ts`, the reuse/rotation/eviction cases |
| An unconfigured deployment throws `StorageNotConfiguredError` as a 503 naming `/admin/settings/storage` as the remedy, without building a delegate | `apps/api/src/storage/providers/resolving-storage.provider.spec.ts`, `describe('when storage is not configured')` |
| `getBucket()` is synchronous, returns the last known bucket, and throws (never returns `''`) when nothing has been read yet | `apps/api/src/storage/providers/resolving-storage.provider.spec.ts`, `describe('getBucket()')` |
| `buildS3ClientConfig` produces the documented endpoint/region/forcePathStyle/checksum table for all three provider kinds, from a settings literal through to the actual `S3Client` constructor arguments | `apps/api/src/storage/providers/s3/s3-storage.provider.spec.ts` |
| An explicit `forcePathStyle` (`true` or `false`) always wins over the per-provider default | `apps/api/src/storage/providers/s3/s3-storage.provider.spec.ts`, the `'still honours a stored...'`/`'lets a stored...win'` cases |
| R2's checksum flags are set only for `r2` | `apps/api/src/storage/providers/s3/s3-storage.provider.spec.ts`, `'disables the CRC32 trailer the newer SDK sends by default'` |
| `setMetadata` percent-encodes `CopySource` segment by segment while leaving `Key` raw, and keeps `/` as a separator | `apps/api/src/storage/providers/s3/s3-storage.provider.spec.ts`, `describe('setMetadata')` |
| `GET /admin/storage-config` returns the masked secret status and never decrypts the secret; `configured`/`missing` come from the single `resolveStorageConfig` definition | `apps/api/src/storage/config/storage-config-admin.service.spec.ts`, `describe('describeForAdmin')` |
| `PUT` checks `If-Match` before touching the credential, and re-checks it against the same row inside the settings write | `apps/api/src/storage/config/storage-config-admin.service.spec.ts`, `describe('optimistic concurrency')` |
| A blank `secretAccessKey` never rotates the stored credential, and a non-blank one does, with the actor recorded and the value itself never audited | `apps/api/src/storage/config/storage-config-admin.service.spec.ts`, `describe('the secret access key')` |
| The switch gate fires on a provider/bucket/effective-endpoint change with rows still at the old location, is silent on a first configuration and when nothing would be stranded, and is bypassed by the typed confirmation | `apps/api/src/storage/config/storage-config-admin.service.spec.ts`, `describe('the switch gate')` |
| `invalidateCache()` runs synchronously after the write and before the audit row, and not at all when the save was refused | `apps/api/src/storage/config/storage-config-admin.service.spec.ts`, `describe('cache invalidation')` |
| An incomplete configuration reports all four test checks as `skipped`, not `failed` | `apps/api/src/storage/config/storage-connection-test.service.spec.ts`, `describe('an incomplete configuration')` |
| A working configuration passes all four checks; the probe object is deleted after the presigned check and written under the documented prefix | `apps/api/src/storage/config/storage-connection-test.service.spec.ts`, `describe('a working configuration')` |
| `HeadBucket` 404 vs. 403 are reported as different codes (`bucket_missing` vs. `bucket_forbidden`), and a 403 with an unrecognised key is disambiguated to `credentials_rejected` via the second `ListBuckets` call | `apps/api/src/storage/config/storage-connection-test.service.spec.ts`, `describe('the bucket check distinguishes 404 from 403')` |
| A blank submitted secret uses the stored one; every error string is redacted before it leaves the service; every attempt is audited, success or failure | `apps/api/src/storage/config/storage-connection-test.service.spec.ts`, `describe('the secret access key')` and `describe('auditing')` |
| `POST /bucket`'s CORS rule exposes `ETag`, allows exactly `PUT`/`GET`/`HEAD`, and uses `APP_URL`'s origin | `apps/api/src/storage/config/storage-bucket-provision.service.spec.ts`, `describe('the CORS rule')` |
| `LocationConstraint` is sent only for a non-default `s3` region, and omitted for `us-east-1`, `r2`, and `s3compatible` | `apps/api/src/storage/config/storage-bucket-provision.service.spec.ts`, `describe('CreateBucket')` |
| All five outcomes (`created`, `already_exists`, `failed`, `partial`, and the two AWS-only steps skipped for R2) are produced correctly | `apps/api/src/storage/config/storage-bucket-provision.service.spec.ts`, `describe('outcomes')` |
| The `guided` outcome carries real, non-placeholder values (bucket, region, endpoint, CORS origin) and preserves the `ETag` exposure, and fires only on a genuine permission/API-support denial, never on a rejected credential or an unreachable endpoint | `apps/api/src/storage/config/storage-bucket-provision.service.spec.ts`, `describe('the guided outcome')` |
| `guidance.runbook` names `docs/runbooks/storage-configuration.md` | `apps/api/src/storage/config/storage-bucket-provision.service.spec.ts`, `'names the storage-configuration runbook (issue #378)'` |
| The admin routes use neither `system_settings:*` nor `storage:*`, RBAC is enforced per route, the secret never appears in any response (including redaction inside an echoed provider error), `If-Match`/`SWITCH` behave as documented, and both probes answer 200 with the outcome in the body even when the diagnosis is bad | `apps/api/test/settings/storage-config.integration.spec.ts` |

**What is not covered by an automated test.** A connection test or a bucket
creation against a *real* AWS S3, Cloudflare R2, or MinIO instance —
`storage-connection-test.service.spec.ts` and
`storage-bucket-provision.service.spec.ts` mock the AWS SDK client, so they
prove the request shapes and the error-classification logic are correct
against documented S3 error codes and statuses, not that a live account
responds exactly as documented. The operator runbook
(`docs/runbooks/storage-configuration.md`) is the first-time, against-a-real-
provider verification for each of the three supported vendors.
