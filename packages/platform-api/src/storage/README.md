# @marinoscar/platform-api/storage

The platform's object storage: the provider (`STORAGE_PROVIDER`, the S3 driver configured per call from runtime settings), the objects API (`/api/storage/objects`), `GET /api/storage/status`, the storage configuration admin routes (`/api/admin/storage-config`: read, save, connection test, bucket provisioning), the two Doctor checks, the post-upload processor registry and its job, the stale-upload sweep, the object-key prefix registry with **org-aware keys**, the purge entry point behind `npm run storage:purge`, and the profile-image routes. Moved out of the reference app's `src/storage/`, `src/settings/profile-image/` and `src/common/profile-image/` by issue #736 (PP-8.3). It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `credentials`, `jobs`, `nodes` and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/storage` for the wire shapes. The conformance suite is the nested subpath `@marinoscar/platform-api/storage/testing`, catalogued here.

## Purpose and scope

One place that decides where a deployment's bytes go, moves them without passing them through the API, records them per organization, and can enumerate every key it ever wrote.

| Part | Source | What it is |
|---|---|---|
| Module | `storage.module.ts`, `storage.options.ts` | `StorageModule.forRoot(options)`: the objects API, the status route, the cleanup cron (enqueue only) and the two job handlers; registers the slice's key prefixes. |
| Provider | `providers/` | `STORAGE_PROVIDER`, `StorageProvider` (with `kind`, the id rows record), `ResolvingStorageProvider` (the default: resolves the configuration per call), `S3StorageProvider` (`s3`, `r2`, `s3compatible`), `StorageProvidersModule`, `StorageProviderBindingModule` (holds the app's `provider` binding). |
| Configuration | `config/` | `StorageConfigService` (the `storage` settings namespace plus the credential store, cached 5 s), `StorageNotConfiguredError` (503), `StorageConfigModule` (admin routes, connection test, bucket provisioning, the `storage.config` and `storage.bucket` Doctor checks, the egress contributor), `STORAGE_SYSTEM_SETTINGS`. |
| Objects | `objects/`, `status/` | `ObjectsService` and its controller: simple and resumable uploads (presigned part URLs), list, metadata, download URL, delete; `org.id` on the span of create, download and delete. |
| Processing | `processing/`, `handlers/storage-object-process.handler.ts` | `ObjectProcessorRegistry` (processors self-register), `ObjectProcessingService`, the server-only `storage.object.process` job. |
| Cleanup | `handlers/storage-cleanup.handler.ts`, `tasks/` | The server-only `storage.cleanup.stale-uploads` job and its daily cron, which only enqueues. |
| Key prefixes | `storage-key-prefix.registry.ts`, `storage-key-prefixes.ts` | The registry from #679, with scopes, `buildObjectKey`, `allKeyPrefixes`, `orgKeyPrefixes`; the slice's own four prefixes. |
| Purge | `purge/run-storage-purge.ts` | `runStoragePurge` / `runStoragePurgeCli`: what `npm run storage:purge` runs. |
| Profile images | `profile-image/` | `ProfileImageModule.forRoot()`: `GET`/`POST`/`DELETE /api/user-settings/profile-image` and the public `GET /api/users/:userId/avatar/:objectId`; the pure avatar helpers. |
| Nodes | `node-object-store.binding.ts` | `nodeObjectStoreBinding`: the nodes slice's `NODE_OBJECT_STORE` bound to `STORAGE_PROVIDER`. |
| Ports and data | `ports.ts`, `data/storage-db.ts` | `STORAGE_SYSTEM_DATA` (the bypass client) and the structural rows of the `storage` fragment. |
| Test seams | `testing/` (`/storage/testing`) | The `storage` conformance suite. |

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

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `StorageModule.forRoot` | option | `forRoot(options?: StorageModuleOptions): DynamicModule` | Mount the objects API, its jobs and the cleanup cron once, with deployment tuning | experimental | [example](../../../../apps/api/src/platform/storage/storage.config.ts) |
| `ProfileImageModule.forRoot` | option | `forRoot(): DynamicModule` | Mount the profile-image routes, after the user-settings namespaces are registered | experimental | [example](../../../../apps/api/src/platform/storage/storage.config.ts) |
| `StorageModuleOptions.provider` | option | `provider?: PortBinding<StorageProvider>` (`{ useClass }`, `{ useExisting }` or `{ useFactory, inject }`) | Rung 3: a non-S3 backend (Azure Blob, local disk) for every package consumer; there is deliberately no driver registry yet | experimental | [example](../../../../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts) |
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

Supporting exports (experimental unless noted): the module options, `STORAGE_OPTIONS`, `resolveStorageModuleOptions`, `simpleUploadFileSizeLimit` and the three defaults (stable); `StorageProvidersModule`, `StorageConfigModule`, `ObjectProcessingModule`; the provider types (stable), `ResolvingStorageProvider`, `S3StorageProvider`, `buildS3ClientConfig`, `DEFAULT_S3_PART_SIZE`; `StorageConfigService`, `resolveStorageConfig`, `fingerprintStorageConfig`, `describeStorageConfig`, `deriveR2Endpoint`, the R2 and S3-compatible constants, `MISSING_STORAGE_CONFIG_FIELDS`, `StorageNotConfiguredError`, `STORAGE_SETTINGS_PATH`, `STORAGE_SYSTEM_SETTINGS`, the credential address `STORAGE_CREDENTIAL_*` and `STORAGE_CREDENTIAL_PURPOSE_DEF` (stable), `STORAGE_SWITCH_CONFIRMATION`; the admin services, controllers, Doctor checks and egress contributor; `ObjectsService`, `ObjectProcessingService`, `buildProcessedMetadata`, the two handlers, their PERMANENT type strings `STORAGE_CLEANUP_TYPE` and `STORAGE_OBJECT_PROCESS_TYPE`, the cleanup task; `resolveStorageObjectInput`, `STORAGE_OBJECT_SUBJECT_TYPE`, `JobInputResolutionError`; `mimeTypeMatches`, `normaliseMimeType`; `KEY_PREFIX_SCOPES`, `STORAGE_KEY_PREFIX_PATTERN`, `storageKeyPrefixRegistry`, `isRegisteredStorageKey`, the four prefix constants and `STORAGE_SLICE_KEY_PREFIXES`; `runStoragePurgeCli` and the report types; the avatar helpers (`AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`, `detectImageType`, `normalizeProfileSettings`, `isAvatarObjectFor`, `resolveProfileImageUrl`, ...), `ProfileImageService`, `AvatarService`, `AvatarController`, `createProfileImageController`; the structural rows (`StorageObject`, `StorageObjectChunk`, `StorageObjectStatus`, `StoragePrisma`), `storageForOrg`, `storageRunInOrg`; `STORAGE_PERMISSIONS` and `STORAGE_CONFIG_PERMISSIONS` (stable).

### The three rungs, for storage

1. **Option.** `forRoot({ maxSimpleUploadBytes, partSizeBytes, staleUploadHours })`: deployment tuning, no code.
2. **Registry.** A post-upload processor registers itself with `ObjectProcessorRegistry` from `onModuleInit` (the pattern of `JobHandlerRegistry` and `DoctorCheckRegistry`): lower `priority` runs first, `canProcess` is a synchronous, I/O-free predicate over the row, and an upload that no processor wants is `ready` at once. A writer under a new key prefix declares it with `registerKeyPrefix({ id, prefix, owner, scope, description })` (a malformed, duplicate or overlapping prefix is refused at registration) and builds its keys with `buildObjectKey`.
3. **Binding.** A non-S3 backend is passed as `StorageModule.forRoot({ provider: { useClass: YourProvider } })`, and every package consumer (the objects API, profile images, exports, user-data, database backups, the AI output writer, the nodes data plane) is injected with it. Implement the whole `StorageProvider`, including `kind` (the id written to `storage_objects.storage_provider` and the backup rows) and the synchronous `getBucket()`. No driver registry exists (the full one, with per-driver settings and a form, is PP-14.7); file a seam request if you need more. A working in-memory provider and the test that boots the real consumers: [`apps/api/src/platform-extensions/storage/`](../../../../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts), [`apps/api/test/examples/storage/storage-provider-override.spec.ts`](../../../../apps/api/test/examples/storage/storage-provider-override.spec.ts).

   **Providing `STORAGE_PROVIDER` in an app module does not work**, and an earlier version of this recipe said it did. Every package module imports `StorageProvidersModule`, and Nest resolves a token from the consuming module's own providers and imports first, so an app-level (or even `@Global()`) provider of the token is never seen by them. How the option reaches them without editing the sixteen importers: `forRoot({ provider })` imports `StorageProviderBindingModule`, a `@Global()` module providing one private token (`STORAGE_PROVIDER_BINDING`); `StorageProvidersModule` provides `STORAGE_PROVIDER` as that binding when present and `ResolvingStorageProvider` otherwise. Rejected: making `StorageProvidersModule` itself dynamic, because a bare `StorageProvidersModule` and a configured one are two different modules to Nest, so each of the sixteen importers would have to take the same configured instance.

### Writing a processor

Implement `ObjectProcessor` (`name`, `priority`, `canProcess(object)`, `process(object, getStream)`), inject `ObjectProcessorRegistry`, call `register(this)` in `onModuleInit`, provide it in a module that imports `ObjectProcessingModule`. It runs on a worker slot as the server-only `storage.object.process` job; a failure (`{ success: false }` or a throw) is recorded on the row and marks it `failed` without stopping the others. The recipe: [`apps/api/src/examples/storage/README.md`](../../../../apps/api/src/examples/storage/README.md).

## Data

Owns the `storage` fragment of `@marinoscar/platform-db`: `StorageObject` (`storage_objects`), `StorageObjectChunk` (`storage_object_chunks`) and `StorageObjectStatus`. Both tables carry `org_id NOT NULL` with FORCEd row-level security (#725); a chunk references its object by the composite `(object_id, org_id)`. The slice reaches them through an organization's scope (`PLATFORM_PRISMA`'s `forOrg` / `runInOrg`, or core's helpers) and, for four reviewed paths, through `STORAGE_SYSTEM_DATA` with a named reason (`purge`: the stale-upload sweep and the previous avatar across an org switch; `admin-aggregate`: the stranded-object count and the public avatar route). It also reads `audit_events` (writes one row per storage and configuration write), `users`, `user_settings`, `system_settings` (the configuration view's provenance), `organizations` (a legacy job's default organization) and `database_backup_runs` (the switch gate). No migration in this release.

**Key layouts.** New objects of an org-scoped prefix get `<prefix><orgId>/…`: uploads are `uploads/<orgId>/<timestamp>/<uuid><ext>`. Objects written before #736 keep `uploads/<timestamp>/<uuid><ext>`: every read, download and delete uses the row's stored `storage_key`, never a rebuilt one. Avatars stay user scoped (`avatars/<userId>/…`), probes and node outputs deployment scoped. The registered prefixes and their scopes in the reference app: `uploads/` (org), `avatars/` (user), `database-backups/` (deployment, the app's until #740), `node-outputs/` (deployment), `ai-outputs/` (user, the app's until #739), `storage-config-test/` (deployment).

**Org offboarding recipe** (#743): delete under every `orgKeyPrefixes(orgId)` AND every stored key of `storage_objects WHERE org_id = $1` (on the system client), because legacy rows have no org segment and are under the root prefix only. Then delete the rows.

The configuration is the `storage` namespace of the `global` system-settings row (`provider`, `bucket`, `region`, `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`), written through `SystemSettingsService.patchSettings` (the shared version, `If-Match` on the admin page), and the secret access key the credential row `storage/default`.

## Permissions and settings

Declares `storage:read` and `storage:write` (org scope, held through the membership role: `org_admin`, `contributor`, and `viewer` for read), `storage:delete_any` (system, `admin`), `storage_config:read` and `storage_config:write` (system, `admin`), as data (`STORAGE_PERMISSIONS`, `STORAGE_CONFIG_PERMISSIONS`) for the app's permission registry. The objects routes need `storage:read|write`; deleting another user's object needs `storage:delete_any` (never another user's avatar); `/api/admin/storage-config` needs `storage_config:read` (GET) and `storage_config:write` (PUT, test, bucket); the profile-image routes need the settings slice's `user_settings:read|write`; `GET /api/users/:userId/avatar/:objectId` is public. The admin `Storage` card declares `storage_config:read`. Registers the `storage` system-settings namespace declaration (`STORAGE_SYSTEM_SETTINGS`, registered by the app's manifest); the profile picture is the settings slice's `profile` user-settings field, validated through its `SETTINGS_PROFILE_IMAGES` port (the reference app binds it with this slice's `normalizeProfileSettings` and `isAvatarObjectFor`).

## UI

None in this slice. The page (`/admin/settings/storage`), its hook and the objects client are `@marinoscar/platform-web/storage`.

## Infra

The only environment variables the slice reads are the app's deployment limits, through `ConfigService`: `storage.maxFileSize` (`MAX_FILE_SIZE`), `storage.allowedMimeTypes` (`ALLOWED_MIME_TYPES`), `storage.signedUrlExpiry` (`SIGNED_URL_EXPIRY`) and `storage.partSize` (`STORAGE_PART_SIZE`), plus `appUrl` for the bucket's CORS rule. They are deployment tuning, never provider configuration. `npm run storage:purge` (`node dist/storage-purge.main.js` in the api image) is what `appctl deploy uninstall --purge-storage` runs.

## Observability

Logs through Nest's `Logger` (uploads, deletes, processing, sweeps, configuration saves with which fields changed, never the secret). Spans: the HTTP and SDK auto-instrumentation; `ObjectsService` adds `org.id` as an attribute of the active span on object create, download and delete, never a metric label (cardinality). The bypass client records `db.access.reason` on the span of each system acquisition. No metrics of its own.

## Security notes

- **The secret access key lives in the credential store only** (`(purpose 'storage', name 'default')`): the settings namespace and the admin view carry compile-time proofs of no secret-named field (`StorageSettingsCarriesNoSecret` in the contract), `GET /api/system-settings` and `GET /api/admin/storage-config` never return it, and the write is blank-preserving.
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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 Object storage is not configured` | The `storage` namespace or the secret access key is incomplete | Fill in `/admin/settings/storage`; the message names the missing fields |
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
