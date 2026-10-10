# @marinoscar/platform-api/storage

The platform's object storage: the provider (`STORAGE_PROVIDER`, the S3 driver configured per call from runtime settings), the objects API (`/api/storage/objects`), `GET /api/storage/status`, the storage configuration admin routes (`/api/admin/storage-config`: read, save, connection test, bucket provisioning), the two Doctor checks, the post-upload processor registry and its job, the stale-upload sweep, the object-key prefix registry with **org-aware keys**, the purge entry point behind `npm run storage:purge`, and the profile-image routes. Moved out of the reference app's `src/storage/`, `src/settings/profile-image/` and `src/common/profile-image/` by issue #736 (PP-8.3). It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `credentials`, `jobs`, `nodes` and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/storage` for the wire shapes. The conformance suite is the nested subpath `@marinoscar/platform-api/storage/testing`, catalogued here.

## Purpose and scope

One place that decides where a deployment's bytes go, moves them without passing them through the API, records them per organization, and can enumerate every key it ever wrote.

| Part | Source | What it is |
|---|---|---|
| Module | `storage.module.ts`, `storage.options.ts` | `StorageModule.forRoot(options)`: the objects API, the status route, the cleanup cron (enqueue only) and the two job handlers; registers the slice's key prefixes. |
| Provider | `providers/` | `STORAGE_PROVIDER`, `StorageProvider` (with `kind`, the id rows record), `ResolvingStorageProvider` (the default: resolves the configuration per call and builds the active driver), `S3StorageProvider` (the provider of the S3 drivers), `StorageProvidersModule`, `StorageProviderBindingModule` (holds the app's `provider` binding). |
| Drivers | `drivers/` | The `storage-driver` pluggable kind (PP-14.7): `registerStorageDriver`, `StorageDriver` / `StorageDriverDefinition`, and the built-in drivers `s3`, `r2` and `s3compatible` (`drivers/s3/`), which register through the same function an app uses and hold every line of S3-specific code: the connection test, bucket provisioning, the purge lister and the per-flavour requirements. |
| Configuration | `config/` | `StorageConfigService` (the `storage` settings namespace plus the active driver's credentials, cached 5 s), `StorageNotConfiguredError` (503), `StorageConfigModule` (admin routes, connection test, bucket provisioning, the `storage.config` and `storage.bucket` Doctor checks, the egress contributor; all delegate to the active driver), `STORAGE_SYSTEM_SETTINGS`. |
| Objects | `objects/`, `status/` | `ObjectsService` and its controller: simple and resumable uploads (presigned part URLs), list, metadata, download URL, delete; `org.id` on the span of create, download and delete. |
| Processing | `processing/`, `handlers/storage-object-process.handler.ts` | `ObjectProcessorRegistry` (processors self-register), `ObjectProcessingService`, the server-only `storage.object.process` job. |
| Cleanup | `handlers/storage-cleanup.handler.ts`, `tasks/` | The server-only `storage.cleanup.stale-uploads` job and its daily cron, which only enqueues. |
| Key prefixes | `storage-key-prefix.registry.ts`, `storage-key-prefixes.ts` | The registry from #679, with scopes, `buildObjectKey`, `allKeyPrefixes`, `orgKeyPrefixes`; the slice's own four prefixes. |
| Purge | `purge/run-storage-purge.ts` | `runStoragePurge` / `runStoragePurgeCli`: what `npm run storage:purge` runs. |
| Profile images | `profile-image/` | `ProfileImageModule.forRoot()`: `GET`/`POST`/`DELETE /api/user-settings/profile-image` and the public `GET /api/users/:userId/avatar/:objectId`; the pure avatar helpers. |
| Nodes | `node-object-store.binding.ts` | `nodeObjectStoreBinding`: the nodes slice's `NODE_OBJECT_STORE` bound to `STORAGE_PROVIDER`. |
| Ports and data | `ports.ts`, `data/storage-db.ts` | `STORAGE_SYSTEM_DATA` (the bypass client) and the structural rows of the `storage` fragment. |
| Test seams | `testing/` (`/storage/testing`) | The `storage` conformance suite and `describeStorageDriverConformance`, the kit every driver runs. |

Not here: a non-S3 driver (an Azure Blob provider is deferred; bind your own with `StorageModule.forRoot({ provider })`, and see the driver registry of PP-14.7), AI output keys (`ai-outputs/`, owned by the AI slice, #739), database backup keys (`database-backups/`, the db-backup slice, #740), deleting an organization's objects (org offboarding, #743; it uses `orgKeyPrefixes`), and moving existing objects to new keys (never: `storage_objects.storage_key` is stored per row).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { StorageModule, STORAGE_PROVIDER, ObjectProcessorRegistry, buildObjectKey } from '@marinoscar/platform-api/storage';
```

The S3 SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a dependency of the package. Beyond the package's peers, the slice needs, from the app: `JobsModule.forRoot()` and `SettingsModule.forRoot()` (both global), core's `PlatformHostModule` (`PLATFORM_PRISMA`), a `@Global()` module binding `STORAGE_SYSTEM_DATA`, `SECRETS_ENCRYPTION_KEY` for the credential store, the `storage` credential purpose registered (`STORAGE_CREDENTIAL_PURPOSE_DEF`), the `storage` settings namespace registered (`STORAGE_SYSTEM_SETTINGS`), and `@fastify/multipart` registered on the Fastify instance for the two upload routes.

## Quick start

The reference app's binding ([`storage.config.ts`](../../../../apps/api/src/platform/storage/storage.config.ts)) and host ports ([`storage-host.module.ts`](../../../../apps/api/src/platform/storage/storage-host.module.ts)):

```ts
import '../../settings/registry';           // the settings namespaces (the profile-image response embeds them)
import './storage-key-prefix.manifest';     // the platform six in purge order, then the app's

export const StorageModule = PlatformStorageModule.forRoot({ imports: [StorageHostModule] });
export const ProfileImageModule = PlatformProfileImageModule.forRoot();
export { StorageConfigModule } from '@marinoscar/platform-api/storage';
```

```ts
// StorageHostModule (@Global): the bypass client
{ provide: STORAGE_SYSTEM_DATA, useExisting: PrismaSystemService }
```

`main.ts` caps the simple upload with the slice's ceiling: `simpleUploadFileSizeLimit(config.get('storage.maxFileSize'), app.get(STORAGE_OPTIONS).maxSimpleUploadBytes)`. A feature that moves bytes imports `StorageProvidersModule` and injects `STORAGE_PROVIDER`; a feature that records the provider of a row writes `provider.kind` of the injected `STORAGE_PROVIDER` (the configured `s3`/`r2`/`s3compatible` for the default provider, the app backend's id for a bound one). `StorageConfigService.activeProvider()` stays for code that needs the configured kind itself.

## Configuration

`StorageModule.forRoot(options)`. **None of these is storage configuration**: the provider, bucket, region, endpoint, account id and access key id are the `storage` system-settings namespace, and the secret access key the credential store, edited at `/admin/settings/storage` and resolved per call. Never add `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION` or `S3_ENDPOINT` environment variables.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxSimpleUploadBytes` | `number` | `104857600` (100 MiB, `DEFAULT_MAX_SIMPLE_UPLOAD_BYTES`) | Ceiling of `POST /api/storage/objects`; the app's multipart plugin caps the route at `min(this, storage.maxFileSize)`. |
| `partSizeBytes` | `number` (at least 5 MiB) | the deployment's `storage.partSize` (`STORAGE_PART_SIZE`), else 10 MiB | The resumable upload's part size. |
| `staleUploadHours` | `number` | `24` (`DEFAULT_STALE_UPLOAD_HOURS`) | How long an unfinished upload is left before the cleanup job reclaims it. |
| `imports` | `ModuleMetadata['imports']` | `[]` | Modules imported next to the slice: the app's host module binding `STORAGE_SYSTEM_DATA`. |
| `provider` | `PortBinding<StorageProvider>` | absent: `ResolvingStorageProvider` | Replaces the object store for **every** package consumer (rung 3, below). Exactly one of `useExisting`, `useClass`, `useFactory`; its dependencies come from `imports` and global modules. Code, not configuration: the one option that is not a value. |

`ProfileImageModule.forRoot()` takes no option. The deployment limits stay the app's configuration keys (`storage.maxFileSize`, `storage.allowedMimeTypes`, `storage.signedUrlExpiry`, `storage.partSize`; see Infra).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `StorageModule.forRoot` | option | `forRoot(options?: StorageModuleOptions): DynamicModule` | Mount the objects API, its jobs and the cleanup cron once, with deployment tuning | experimental | [example](../../../../apps/api/src/platform/storage/storage.config.ts) |
| `ProfileImageModule.forRoot` | option | `forRoot(): DynamicModule` | Mount the profile-image routes, after the user-settings namespaces are registered | experimental | [example](../../../../apps/api/src/platform/storage/storage.config.ts) |
| `registerStorageDriver` | registry | `registerStorageDriver<S>(def: StorageDriverDefinition<S>): void` | Add a storage driver (Azure Blob, GCS, local disk) with its own settings schema, declared secrets, `build`, `testConnection` and optional `provision`, `listKeys`, `purge`; it gets a generated admin form, a credential purpose and every storage consumer once selected. Call it at import time | experimental | [example](../../../../apps/api/src/app-registrations/storage.ts) |
| `storageDriverKind` | registry | `PluggableKind<StorageDriverDefinition>` (`.ids()`, `.get(id)`, `.describeAll(presence)`, `.mergeSettingsRecord`) | Read the registry the drivers live in (their ids, settings records, descriptors); the helpers below cover the common reads | experimental | [example](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts) |
| `getStorageDriver` / `requireStorageDriver` / `storageDriverDefinitions` | registry | `getStorageDriver(id): StorageDriverDefinition \| undefined` | Look a registered driver up by id (`require...` throws naming the registered ids) or list them in registration order | experimental | [example](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts) |
| `StorageDriver` / `StorageDriverDefinition` | registry | `interface StorageDriver<S> { build; testConnection; provision?; listKeys?; purge?; defaultRegion?; location?; missing? }` | Type a driver: the operations the slice calls, each receiving `{ settings, secret(name), logger, partSize, appOrigin }` | experimental | [example](../../../../apps/api/src/platform-extensions/storage/local-fs.driver.ts) |
| `describeStorageDriverConformance` | registry | `describeStorageDriverConformance(driver, { describe, it, expect, settings, secrets, supportsSignedUrls?, readSignedUrl? }): void` | Run the kit on a driver: put, head, read, delete, a 6 MiB streamed upload, the signed URL, key listing, and that `testConnection` never throws or returns a secret | experimental | [example](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts) |
| `StorageModuleOptions.provider` | option | `provider?: PortBinding<StorageProvider>` (`{ useClass }`, `{ useExisting }` or `{ useFactory, inject }` ) | Rung 3: replace the object store outright for every package consumer with a provider of your own (no settings, no admin form); it overrides the selected driver. Prefer a driver unless the backend is not configurable at runtime | experimental | [example](../../../../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts) |
| `STORAGE_PROVIDER` | token | `@Inject(STORAGE_PROVIDER) storage: StorageProvider` | Inject the object store (the app's `provider`, else the resolving provider). Read it; do **not** provide it in an app module (invisible to package modules) | stable | [example](../../../../apps/api/test/examples/storage/storage-provider-override.spec.ts) |
| `STORAGE_SYSTEM_DATA` | token | `{ provide: STORAGE_SYSTEM_DATA, useExisting: PrismaSystemService }` | Bind the bypass client the four cross-organization paths use | experimental | [example](../../../../apps/api/src/platform/storage/storage-host.module.ts) |
| `nodeObjectStoreBinding` | token | `ExistingProvider` (`NODE_OBJECT_STORE` to `STORAGE_PROVIDER`) | Let the nodes slice sign its GET and PUT through the app's storage provider | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `ObjectProcessorRegistry` | registry | `registry.register(processor: ObjectProcessor): void` | Add a post-upload processor (`registerObjectProcessor`): call it from the processor's `onModuleInit` | experimental | [example](../../../../apps/api/src/examples/storage/example-metadata.processor.ts) |
| `registerStorageKeyPrefixes` | registry | `registerStorageKeyPrefixes(defs: readonly StorageKeyPrefixDef[]): void` | Register several prefixes, all or nothing, in purge order | experimental | [example](../../../../apps/api/src/platform/storage/storage-key-prefix.manifest.ts) |
| `registerKeyPrefix` | registry | `registerKeyPrefix(def: StorageKeyPrefixDef): void` | Declare the prefix an app writer uses, with its scope, so the purge reaches it | experimental | [example](../../../../apps/api/test/storage/storage-extension-points.spec.ts) |
| `buildObjectKey` | registry | `buildObjectKey(id: string, ctx: ObjectKeyContext, ...parts: string[]): string` | Build a new key: `<prefix><orgId>/…` (org), `<prefix><userId>/…` (user), `<prefix>…` (deployment) | experimental | [example](../../../../apps/api/test/storage/storage-extension-points.spec.ts) |
| `allKeyPrefixes` | registry | `allKeyPrefixes(): readonly string[]` | Enumerate every root prefix (a full purge) | experimental | [example](../../../../apps/api/src/platform/storage/storage-key-prefix.view.ts) |
| `orgKeyPrefixes` | registry | `orgKeyPrefixes(orgId: string): readonly string[]` | Enumerate one organization's prefixes (org offboarding) | experimental | [example](../../../../apps/api/test/storage/storage-extension-points.spec.ts) |
| `runStoragePurge` | hook | `runStoragePurge(app: INestApplicationContext, opts?: StoragePurgeOptions): Promise<StoragePurgeOutcome>` | Count (dry run) or delete everything under the booted app's prefixes | experimental | [example](../../../../apps/api/src/storage-purge.main.ts) |
| `storageConformanceSuite` | registry | `ConformanceSuite<StorageConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { storage } })` | experimental | [example](../../../../apps/api/test/storage/storage-conformance.spec.ts) |

Supporting exports (experimental unless noted): the module options, `STORAGE_OPTIONS`, `resolveStorageModuleOptions`, `simpleUploadFileSizeLimit` and the three defaults (stable); `StorageProvidersModule`, `StorageConfigModule`, `ObjectProcessingModule`; the provider types (stable), `ResolvingStorageProvider`, `S3StorageProvider`, `buildS3ClientConfig`, `DEFAULT_S3_PART_SIZE`; `StorageConfigService`, `ResolvedStorageConfig`, `StorageConfigResolution`, `fingerprintStorageConfig`, `describeStorageConfig`, the S3 family's `resolveStorageConfig` (deprecated), `resolveS3Config`, `S3_FLAVOURS`, `deriveR2Endpoint`, the R2 and S3-compatible constants, `MISSING_STORAGE_CONFIG_FIELDS`, the driver helpers (`describeStorageDrivers`, `storageSecretAddress`, `storageLocationOf`, `missingStorageFields`, `storageDriverCredentialPurpose`, `STORAGE_BUCKET_STEP_LABELS`), the built-ins (`BUILTIN_STORAGE_DRIVERS`, `s3StorageDriver`, `r2StorageDriver`, `s3CompatibleStorageDriver` and their settings schemas), `StorageSubmissionService`, `StorageNotConfiguredError`, `STORAGE_SETTINGS_PATH`, `STORAGE_SYSTEM_SETTINGS`, the credential address `STORAGE_CREDENTIAL_*` and `STORAGE_CREDENTIAL_PURPOSE_DEF` (stable), `STORAGE_SWITCH_CONFIRMATION`; the admin services, controllers, Doctor checks and egress contributor; `ObjectsService`, `ObjectProcessingService`, `buildProcessedMetadata`, the two handlers, their PERMANENT type strings `STORAGE_CLEANUP_TYPE` and `STORAGE_OBJECT_PROCESS_TYPE`, the cleanup task; `resolveStorageObjectInput`, `STORAGE_OBJECT_SUBJECT_TYPE`, `JobInputResolutionError`; `mimeTypeMatches`, `normaliseMimeType`; `KEY_PREFIX_SCOPES`, `STORAGE_KEY_PREFIX_PATTERN`, `storageKeyPrefixRegistry`, `isRegisteredStorageKey`, the four prefix constants and `STORAGE_SLICE_KEY_PREFIXES`; `runStoragePurgeCli` and the report types; the avatar helpers (`AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`, `detectImageType`, `normalizeProfileSettings`, `isAvatarObjectFor`, `resolveProfileImageUrl`, ...), `ProfileImageService`, `AvatarService`, `AvatarController`, `createProfileImageController`; the structural rows (`StorageObject`, `StorageObjectChunk`, `StorageObjectStatus`, `StoragePrisma`), `storageForOrg`, `storageRunInOrg`; `STORAGE_PERMISSIONS` and `STORAGE_CONFIG_PERMISSIONS` (stable).

### The three rungs, for storage

1. **Option.** `forRoot({ maxSimpleUploadBytes, partSizeBytes, staleUploadHours })`: deployment tuning, no code.
2. **Registry.** A storage driver registers with `registerStorageDriver` at import time (below). A post-upload processor registers itself with `ObjectProcessorRegistry` from `onModuleInit` (the pattern of `JobHandlerRegistry` and `DoctorCheckRegistry`): lower `priority` runs first, `canProcess` is a synchronous, I/O-free predicate over the row, and an upload that no processor wants is `ready` at once. A writer under a new key prefix declares it with `registerKeyPrefix({ id, prefix, owner, scope, description })` (a malformed, duplicate or overlapping prefix is refused at registration) and builds its keys with `buildObjectKey`.
3. **Binding.** `StorageModule.forRoot({ provider: { useClass: YourProvider } })` replaces the object store for every package consumer (the objects API, profile images, exports, user-data, database backups, the AI output writer, the nodes data plane) and overrides whatever driver the settings select. It is for a backend that is not configured at runtime; a backend an administrator configures is a driver. Implement the whole `StorageProvider`, including `kind` (the id written to `storage_objects.storage_provider` and the backup rows) and the synchronous `getBucket()`. A working in-memory provider and the test that boots the real consumers: [`apps/api/src/platform-extensions/storage/`](../../../../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts), [`apps/api/test/examples/storage/storage-provider-override.spec.ts`](../../../../apps/api/test/examples/storage/storage-provider-override.spec.ts).

   **Providing `STORAGE_PROVIDER` in an app module does not work**, and an earlier version of this recipe said it did. Every package module imports `StorageProvidersModule`, and Nest resolves a token from the consuming module's own providers and imports first, so an app-level (or even `@Global()`) provider of the token is never seen by them. How the option reaches them without editing the sixteen importers: `forRoot({ provider })` imports `StorageProviderBindingModule`, a `@Global()` module providing one private token (`STORAGE_PROVIDER_BINDING`); `StorageProvidersModule` provides `STORAGE_PROVIDER` as that binding when present and `ResolvingStorageProvider` otherwise. Rejected: making `StorageProvidersModule` itself dynamic, because a bare `StorageProvidersModule` and a configured one are two different modules to Nest, so each of the sixteen importers would have to take the same configured instance.

### Adding a storage driver from an app or package

A storage driver is the part of the slice that knows one kind of object store. The three S3 flavours the platform ships are drivers; an app adds Azure Blob, Google Cloud Storage or a local disk the same way, with no edit under `packages/`:

1. **Define it** (`StorageDriverDefinition`): an `id` (`^[a-z][a-z0-9-]{1,47}$`, permanent: it is the key of `storage.drivers`, the value of `storage.provider`, `StorageProvider.kind` and `storage_objects.storage_provider`), a `label`, a `settingsSchema` (a `z.object` of the NON-SECRET settings; `.describe()` is a field's help, `.meta({ label })` its label), `defaults`, `secrets` (`[{ name, label, required }]`: an account key, a connection string, a service account), and the operations. `build(ctx)` returns the `StorageProvider` every consumer shares (it is built when the configuration changes, and `destroy()` is called on it when superseded); `testConnection(ctx)` backs the admin "Test connection" and NEVER throws or returns secret material; `provision(ctx)` (optional) creates the bucket or container; `listKeys(ctx, prefix)` (optional) lets `npm run storage:purge` empty it; `location`, `missing` and `egressHosts` (optional) tell the slice where the objects live, what is still unset and which hosts the Doctor should list. Each operation receives `{ settings, secret(name), logger, partSize, appOrigin }`; `await ctx.secret('name')` returns `null` when none is stored.
2. **Register it at import time**, before the application bootstraps (`app-registrations/storage.ts`, imported by `platform/storage/storage.config.ts`): `registerStorageDriver(def)`. The registry freezes at bootstrap, a duplicate id throws, and a settings field named like a secret (`secretAccessKey`, `apiKey`, `token`, `password`, ...) is refused.
3. **That is all.** The `storage` namespace gains a `drivers.<id>` record validated by your schema; `GET /api/admin/storage-config` lists it in `descriptors` (a generated form, the secrets as write-only fields carrying only `hasValue`); `PUT`, `POST /test` and `POST /bucket` accept it (`drivers`, and `secrets: { <id>: { <name>: value } }`); its secrets are stored encrypted at the credential purpose `storage_<id>` (registered for you, name = the secret's name; never an environment variable); and once an administrator selects it every consumer writes through it. Moving to a new driver strands existing objects exactly like moving to a new bucket, so the same `SWITCH` confirmation applies.
4. **Run the kit** on it: `describeStorageDriverConformance(driver, { describe, it, expect, settings, secrets })` from `@marinoscar/platform-api/storage/testing`. It puts, heads, reads, lists and deletes real bytes, round-trips a 6 MiB generated stream, checks the signed URL (declare `supportsSignedUrls: false` for a backend that cannot sign), and proves `testConnection` never throws and never echoes a secret. Point your driver at a fake (an in-memory SDK, a temp directory, a local emulator): the kit needs no network.

The worked example is `local-fs` ([driver](../../../../apps/api/src/platform-extensions/storage/local-fs.driver.ts), [registration](../../../../apps/api/src/app-registrations/storage.ts), [spec](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts)): objects as files under one directory, streamed in through a temp file, signed URLs with `deriveSigningKey`, no secret. The spec selects it through the admin routes and proves a profile image, an export and a database backup write through it. The built-ins show the other end: [`drivers/s3/s3-family.ts`](./drivers/s3/s3-family.ts).

A package ships a driver the way it ships any extension: a module-scope `registerStorageDriver(...)` behind an entry the app imports.

**Stored shape and compatibility.** `provider` is the id of the active driver and `drivers.<id>` its settings. A row written before drivers existed (six flat fields, no `drivers`) reads unchanged: the flat fields become `drivers.<provider>`, field by field, and the first PATCH rewrites the row in the new shape. The flat fields (`bucket`, `region`, `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`) stay accepted on PUT, PATCH and the admin routes as aliases of the active built-in driver, and published as a deprecated read view; a flat field and `drivers.<provider>` that disagree are a `400`. `databaseBackup.storageProvider` was never an enum: a driver id pins a backup exactly like `r2` does.

### Writing a processor

Implement `ObjectProcessor` (`name`, `priority`, `canProcess(object)`, `process(object, getStream)`), inject `ObjectProcessorRegistry`, call `register(this)` in `onModuleInit`, provide it in a module that imports `ObjectProcessingModule`. It runs on a worker slot as the server-only `storage.object.process` job; a failure (`{ success: false }` or a throw) is recorded on the row and marks it `failed` without stopping the others. The recipe: [`apps/api/src/examples/storage/README.md`](../../../../apps/api/src/examples/storage/README.md).

## Data

Owns the `storage` fragment of `@marinoscar/platform-db`: `StorageObject` (`storage_objects`), `StorageObjectChunk` (`storage_object_chunks`) and `StorageObjectStatus`. Both tables carry `org_id NOT NULL` with FORCEd row-level security (#725); a chunk references its object by the composite `(object_id, org_id)`. The slice reaches them through an organization's scope (`PLATFORM_PRISMA`'s `forOrg` / `runInOrg`, or core's helpers) and, for four reviewed paths, through `STORAGE_SYSTEM_DATA` with a named reason (`purge`: the stale-upload sweep and the previous avatar across an org switch; `admin-aggregate`: the stranded-object count and the public avatar route). It also reads `audit_events` (writes one row per storage and configuration write), `users`, `user_settings`, `system_settings` (the configuration view's provenance), `organizations` (a legacy job's default organization) and `database_backup_runs` (the switch gate). No migration in this release.

**Key layouts.** New objects of an org-scoped prefix get `<prefix><orgId>/…`: uploads are `uploads/<orgId>/<timestamp>/<uuid><ext>`. Objects written before #736 keep `uploads/<timestamp>/<uuid><ext>`: every read, download and delete uses the row's stored `storage_key`, never a rebuilt one. Avatars stay user scoped (`avatars/<userId>/…`), probes and node outputs deployment scoped. The registered prefixes and their scopes in the reference app: `uploads/` (org), `avatars/` (user), `database-backups/` (deployment, the app's until #740), `node-outputs/` (deployment), `ai-outputs/` (user, the app's until #739), `storage-config-test/` (deployment).

**Org offboarding recipe** (#743): delete under every `orgKeyPrefixes(orgId)` AND every stored key of `storage_objects WHERE org_id = $1` (on the system client), because legacy rows have no org segment and are under the root prefix only. Then delete the rows.

The configuration is the `storage` namespace of the `global` system-settings row (`provider` and the `drivers` record: each driver's own non-secret settings), written through `SystemSettingsService.patchSettings` (the shared version, `If-Match` on the admin page), and each driver's secrets the credential rows of its purpose (the built-ins' secret access key `storage/default`; another driver's `storage_<id>`).

## Permissions and settings

Declares `storage:read` and `storage:write` (org scope, held through the membership role: `org_admin`, `contributor`, and `viewer` for read), `storage:delete_any` (system, `admin`), `storage_config:read` and `storage_config:write` (system, `admin`), as data (`STORAGE_PERMISSIONS`, `STORAGE_CONFIG_PERMISSIONS`) for the app's permission registry. The objects routes need `storage:read|write`; deleting another user's object needs `storage:delete_any` (never another user's avatar); `/api/admin/storage-config` needs `storage_config:read` (GET) and `storage_config:write` (PUT, test, bucket); the profile-image routes need the settings slice's `user_settings:read|write`; `GET /api/users/:userId/avatar/:objectId` is public. The admin `Storage` card declares `storage_config:read`. Registers the `storage` system-settings namespace declaration (`STORAGE_SYSTEM_SETTINGS`, registered by the app's manifest); the profile picture is the settings slice's `profile` user-settings field, validated through its `SETTINGS_PROFILE_IMAGES` port (the reference app binds it with this slice's `normalizeProfileSettings` and `isAvatarObjectFor`).

## UI

None in this slice. The page (`/admin/settings/storage`), its hook and the objects client are `@marinoscar/platform-web/storage`.

## Infra

The only environment variables the slice reads are the app's deployment limits, through `ConfigService`: `storage.maxFileSize` (`MAX_FILE_SIZE`), `storage.allowedMimeTypes` (`ALLOWED_MIME_TYPES`), `storage.signedUrlExpiry` (`SIGNED_URL_EXPIRY`) and `storage.partSize` (`STORAGE_PART_SIZE`), plus `appUrl` for the bucket's CORS rule. They are deployment tuning, never provider configuration. `npm run storage:purge` (`node dist/storage-purge.main.js` in the api image) is what `appctl deploy uninstall --purge-storage` runs.

## Observability

Logs through Nest's `Logger` (uploads, deletes, processing, sweeps, configuration saves with which fields changed, never the secret). Spans: the HTTP and SDK auto-instrumentation; `ObjectsService` adds `org.id` as an attribute of the active span on object create, download and delete, never a metric label (cardinality). The bypass client records `db.access.reason` on the span of each system acquisition. No metrics of its own.

## Security notes

- **A driver's secrets live in the credential store only** (the built-ins' at `(purpose 'storage', name 'default')`, another driver's at `(purpose 'storage_<id>', name <secret>)`; `registerStorageDriver` refuses a secret-named settings field and `describeStorageDriverConformance` proves `testConnection` never returns one): the settings namespace and the admin view carry compile-time proofs of no secret-named field (`StorageSettingsCarriesNoSecret` in the contract), `GET /api/system-settings` and `GET /api/admin/storage-config` never return it, and the write is blank-preserving.
- **Bytes bypass the API**: the resumable upload hands out presigned part URLs, downloads are short-lived signed URLs (bearer credentials for their lifetime: never logged). Only the simple upload streams through the API, capped by `maxSimpleUploadBytes`.
- **Profile images are images only**: magic-byte detection (`detectImageType`), `AVATAR_MAX_BYTES` (5 MiB), and the avatar route serves only an object that is the user's own avatar.
- **Tenancy**: row-level security isolates `storage_objects` per organization; the four bypass paths are on the reviewed allowlist of `apps/api/test/tenancy/system-injection-boundary.spec.ts` through the host module that binds `STORAGE_SYSTEM_DATA`.
- **Purge targets come only from the registry**, never from a filtered bucket listing; an unreadable versioning status counts as versioned.

## Conformance suite

Importing `@marinoscar/platform-api/storage/testing` registers the `storage` suite with `runPlatformConformance()`. Run it after the app's key-prefix manifest:

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/storage/testing';
import '../../src/platform/storage/storage-key-prefix.manifest';

runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { storage: { requiredPrefixIds: ['database-backups'] } } });
```

| Case | Fails when |
|---|---|
| `prefixes` | A registered prefix does not end with exactly one `/`, two overlap, or the slice's own (or a `requiredPrefixIds`) prefix is not registered |
| `keys` | An org-scoped prefix does not build `<prefix><orgId>/…`, or `orgKeyPrefixes` lists anything else |
| `no-secret` | The `storage` namespace, its response branch or the admin view declares a secret-named field |

The cron rule (`cron-enqueue-only`) scans this slice's root too; the reference app adds it to `apps/api/test/jobs/cron-source-roots.ts`.

## Upgrade notes

#743 adds the optional `survivesFactoryReset` to `StorageKeyPrefixDef` and `survivingKeyPrefixes()`: a prefix marked `true` is kept by the admin factory reset of `@marinoscar/platform-api/user-data` (the db-backup slice marks `database-backups/` in `DB_BACKUP_KEY_PREFIX`). Unmarked prefixes behave as before.

New subpath in this version. From the reference app's local `src/storage/` (#736):

- Import from `@marinoscar/platform-api/storage`; mount `StorageModule.forRoot({ imports: [YourStorageHostModule] })` and `ProfileImageModule.forRoot()` once, and bind `STORAGE_SYSTEM_DATA`.
- `OBJECT_PROCESSOR` is removed: register processors with `ObjectProcessorRegistry` from `onModuleInit`.
- `STORAGE_KEY_PREFIXES` (the frozen view) is the app's now (`platform/storage/storage-key-prefix.view.ts`); the purge reads `allKeyPrefixes()` of the booted app. `StorageKeyPrefixDef` gains an optional `scope` (absent means `deployment`, the pre-#736 behaviour).
- New uploads are `uploads/<orgId>/…`. Existing objects keep their keys; nothing to migrate.
- `STORAGE_PROVIDER` is a `Symbol.for(...)` key now; inject it by the exported constant as before.
- PP-14.1 (#919): `StorageModule.forRoot({ provider })` replaces the object store for every package consumer; the earlier "provide `STORAGE_PROVIDER` in your app module" recipe never reached them and is removed. `StorageProvider` gains the required `kind: string` (a custom provider must add it; `S3StorageProvider.providerId` stays as a deprecated alias of `kind`). Rows record `provider.kind`. `ObjectsService`, `ProfileImageService` and `ExportRunHandler` no longer take `StorageConfigService` (constructor change only for code that builds them by hand). Without `provider`, behaviour and the API are unchanged.
- `npm run storage:purge` runs `node dist/storage-purge.main.js`; its flags and JSON output are unchanged.
- Job type strings (`storage.cleanup.stale-uploads`, `storage.object.process`), routes, permissions, the settings namespace, the credential address and audit actions are unchanged.

PP-14.7 (#925) makes the storage provider pluggable. Additive for a deployment that does nothing: the three built-ins keep their ids, settings, credential address, routes and behaviour; an old stored row loads unchanged.

- **New:** `registerStorageDriver`, `storageDriverKind`, `StorageDriver`, `StorageDriverDefinition`, the driver helpers, `describeStorageDriverConformance`, the `drivers` record and the `provider` string in the `storage` namespace, `descriptors` and `drivers` on the admin view, optional `drivers` and `secrets` on the admin PUT, `POST /test` and `POST /bucket` bodies (`message` and `details` on the test result, `message` on the provisioning result), and exit code `3` of `npm run storage:purge` for a driver that can neither purge nor list.
- **Moved:** the S3-specific code of `StorageConnectionTestService`, `StorageBucketProvisionService`, `runStoragePurge` and `config/storage-config.ts` now lives in `drivers/s3/`. `ResolvedStorageConfig` is the generic active configuration (`provider`, `bucket`, `region`, `endpoint?`, `settings`, `secrets`); the S3 family's type is `ResolvedS3Config`, and `resolveStorageConfig` (S3 only, deprecated) keeps its signature. `StorageConfigResolution.missing` and `StorageNotConfiguredError`'s `missing` are `string[]`. `StorageConnectionTestService` and `StorageBucketProvisionService` take a `StorageSubmissionService` instead of `CredentialsService` (constructor change only for code that builds them by hand).
- **Changed on the wire:** `provider` is a driver id (a pattern, not an enum) everywhere it appears; `missing` is a list of strings; `STORAGE_PROVIDER_KINDS` is `BUILTIN_STORAGE_PROVIDER_KINDS` (the old name stays as a deprecated alias) and `StorageProviderKind` is `string`.
- **Settings row:** new installs seed `provider` plus `drivers` (the three built-ins, empty). `DEFAULT_SYSTEM_SETTINGS.storage` changed accordingly (the flat fields are a deprecated alias, not a default).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 Object storage is not configured` | The active driver's settings or secrets are incomplete (or the selected driver is no longer registered: missing `driver`) | Fill in `/admin/settings/storage`; the message names the missing fields |
| `Unknown storage driver "x"` (400) | The id was never registered, or its package was removed | `registerStorageDriver` it at import time; reads ignore a removed driver's stored settings with one warning |
| `buildObjectKey("uploads"): an org-scoped key needs ctx.orgId` | A writer built an org key without the request's organization | Pass `principal.activeOrgId` (or the job payload's `orgId`); only single-organization mode may fall back to `defaultOrgId` |
| `buildObjectKey(): no key prefix "x" is registered` | The writer's prefix was never registered | `registerKeyPrefix({ id: 'x', ... })` in the app's manifest |
| `RegistryError ... overlaps "uploads/"` at boot | An app prefix under or above a registered one | Choose a disjoint root prefix |
| Nest cannot resolve `STORAGE_SYSTEM_DATA` | The host module binding it is not imported | Pass it as `forRoot({ imports })` (it must be `@Global()`) |
| Uploads stay `processing` | A processor applies and no worker runs the `storage.object.process` job | Run a worker (`JOBS_WORKER_MODE`), or narrow the processor's `canProcess` |
| The purge leaves objects behind | Their writer's prefix is not registered | Register it; the conformance suite and the key-prefix tripwire catch this in CI |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Storage providers spec](../../../../docs/specs/storage-providers.md)
- [Storage configuration runbook](../../../../docs/runbooks/storage-configuration.md)
- [Contract](../../../platform-contract/src/storage/README.md)
- [Web counterpart](../../../platform-web/src/storage/README.md)
- [Jobs slice (the two job types)](../jobs/README.md)
- [Nodes slice (`NODE_OBJECT_STORE`)](../nodes/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
