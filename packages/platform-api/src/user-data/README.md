# @marinoscar/platform-api/user-data

The user-data slice of the API package (issue #743, PP-9.1): the per-user deletion with scopes (`user.data.purge`, `/api/user-data/*`), the admin factory reset (`admin.factory_reset`, `/api/admin/factory-reset/*`) and organization offboarding (`org.offboard`, `/api/admin/orgs/:orgId/offboarding/*`). Harvested from EvoPath's user data reset and factory reset and kvox's scoped deletion, which shared no file. It depends on `core` (the user-owned and model-ownership registries, the audit sink), `doctor` (the registries check), `otel-core` (the metrics), `identity` (the route decorators), `jobs` (the queue), `storage` (the provider, the key-prefix registry), `sharing` (the group membership removal hook), `exports` (the recent-export offboarding precondition), `host` (the deployment mode) and `testing` (the schema reader and the conformance harness) (`packages/platform-slices.json`).

## Purpose and scope

Both source apps kept the keep-or-delete decision for every model in a hand-written list (EvoPath's `user-data-purge.ts`, about 25 tables, whose own spec says "no test discovers a new model"). Here the decision is data:

- the user-owned data registry of `core` says which models hold a user's rows (`ownerField`);
- a **model hint** (`registerUserDataModels`) says what a reset does with each: `keep` (with the reason) or the `category` it is deleted in, plus `storageObjectColumns` (files to collect before the row goes), `keepWhenReferenced` (EvoPath's "deleted unless in use"), `delegate` (kvox's fan-out to another purge job), `storageObjects` (the storage-object model itself) and `factoryReset` (`keep` for an org model that is configuration);
- **categories** (`registerUserDataCategory`) and **scopes** (`registerUserDataScope`) say what one request deletes. Built-in scopes: `everything` (`DELETE MY DATA`) and `content` (`DELETE MY CONTENT`, categories marked `content: true`). Overriding a built-in needs `overrideBuiltIn: true`;
- the **delete order** is derived by the purge planner from the schema's relations (children before parents along `Cascade`, `Restrict` and `NoAction`; ties by name; a cycle fails at bootstrap, naming its models).

The platform declares its own categories (`files`, `notifications`, `ai`, `credentials`, `settings`, `other`), a hint for every platform owner model, and the factory reset's deployment leftovers (`registerPlatformUserData()`).

Three server-only jobs, each with a permanent type string:

| Type | Subject | Profile | What it does |
|---|---|---|---|
| `user.data.purge` | `user:<userId>` | 15 min, 3 attempts | Collect object ids into the payload, delete the rows in one transaction with their counts, enqueue delegates, delete the objects (bytes, then row) |
| `admin.factory_reset` | none (one per deployment) | 30 min, 3 attempts | Jobs, every user's data, `before-users` steps, nodes to the actor, org data and other users, leftovers and `deployment` steps, storage outside the surviving prefixes, organizations but the default |
| `org.offboard` | `organization:<orgId>` | 60 min, 3 attempts | Pending jobs, org-owned rows (DMMF order), the org's objects, invites and memberships, the users left without an organization (`keep` or `purge`), the organization |

Not here: account deletion (no app ships it), the data export itself (`@marinoscar/platform-api/exports`; this slice ships `RECENT_ORG_EXPORT_PRECONDITION` for an app that mounts it), the pages (`@marinoscar/platform-web/user-data`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { UserDataModule, registerUserDataModels } from '@marinoscar/platform-api/user-data';
```

Peers beyond the package's own: `nestjs-zod` and `zod` (the DTOs), `@opentelemetry/api` (span attributes). The wire shapes come from `@marinoscar/platform-contract/user-data`. The app binds one host port (the bypass client, `USER_DATA_DB`) and points the slice at its composed Prisma schema folder.

## Quick start

The reference app fills the registries in a manifest ([`user-data.manifest.ts`](../../../../apps/api/src/platform/user-data/user-data.manifest.ts)) and calls `forRoot` once ([`user-data.config.ts`](../../../../apps/api/src/platform/user-data/user-data.config.ts)):

```ts
import './user-data.manifest'; // registerPlatformUserData(), then the app's entries
export const userDataModule = UserDataModule.forRoot({
  imports: [UserDataHostModule], // binds USER_DATA_DB, the bypass client: the one port an app supplies
  datamodel: composedSchemaDatamodel(__dirname), // finds and parses prisma/schema once
  userRemovalHooks: [groupMembershipRemovalHook],
  factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
});
```

An app with its own models adds one hint per owner model ([`app-registrations/user-data.ts`](../../../../apps/api/src/app-registrations/user-data.ts); worked examples in [`user-data.examples.ts`](../../../../apps/api/src/examples/user-data/user-data.examples.ts)):

```ts
registerUserDataCategory({ id: 'transcripts', label: 'Transcripts', description: 'Your transcripts and their audio.', content: true });
registerUserDataModels([{ model: 'Transcript', category: 'transcripts', storageObjectColumns: ['audioObjectId'] }]);
registerUserDataScope({ id: 'transcripts', label: 'Delete my transcripts', description: '...', categories: ['transcripts'], confirmation: 'TRANSCRIPTS', layer: 'specific' });
```

## Configuration

`UserDataModule.forRoot(options)`:

| Option | Default | Meaning |
|---|---|---|
| `datamodel` | required | The parsed schema: `composedSchemaDatamodel(__dirname)` (walks up to `prisma/schema`), or any `PurgeDatamodel` or function returning one, read once at bootstrap. Prisma 7's generated DMMF has no `onDelete`, so the schema file is the source |
| `imports` | `[]` | Modules binding `USER_DATA_DB` |
| `environment` | `DefaultUserDataEnvironment` | The class bound as `USER_DATA_ENVIRONMENT`. The default reads `DEPLOYMENT_MODE` from the host slice's `DeploymentModeService` and `TENANCY_MODE` from identity's `TenancyService`, so an app passes nothing |
| `legacyJobTypes` | `[]` | `{ type, toPayload(old) }`: an alias handler per pre-platform job type (EvoPath's `user.data_reset`), so queued jobs still run after adoption |
| `userRemovalHooks` | `[]` | Work run before a user ROW is deleted (factory reset, offboarding `purge`); `groupMembershipRemovalHook` is the sharing slice's last-admin rule |
| `factoryReset.keepJobsReferencedBy` | `[]` | `{ model, field }`: jobs these rows link to survive step 1 (the backups') |
| `txTimeoutMs` | 5 minutes | The row transaction's timeout |

No environment variable and no settings namespace. `DEPLOYMENT_MODE=saas` disables the factory reset; offboarding needs `TENANCY_MODE=multi` (both read through `USER_DATA_ENVIRONMENT`, bound by default).

The slice registers the `user-data.registries` Doctor check (`UserDataRegistriesDoctorCheck`, category `user-data`): the three conformance checks below, run against the live registries and schema, so a deployment that shipped an owner model without a decision shows a `fail` with the model named. It needs the Doctor module and the host core (`PlatformHostCoreModule`) in the app.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `UserDataModule.forRoot` | option | `(options: UserDataModuleOptions) => DynamicModule` | Mount the slice once | experimental | [user-data.config.ts](../../../../apps/api/src/platform/user-data/user-data.config.ts) |
| `composedSchemaDatamodel` | option | `(fromDir: string) => () => PurgeDatamodel` | Point `datamodel` at the app's composed `prisma/schema` folder | experimental | [user-data.config.ts](../../../../apps/api/src/platform/user-data/user-data.config.ts) |
| `UserDataModuleOptions` | option | `{ datamodel, imports?, legacyJobTypes?, userRemovalHooks?, factoryReset?, txTimeoutMs? }` | Configure the slice | experimental | [user-data.config.ts](../../../../apps/api/src/platform/user-data/user-data.config.ts) |
| `registerUserDataCategory` | registry | `(def: UserDataCategoryDef) => void` | Add a category the Danger Zone counts | experimental | [user-data.examples.ts](../../../../apps/api/src/examples/user-data/user-data.examples.ts) |
| `registerUserDataScope` | registry | `(def: UserDataScopeDef) => void` | Add a narrow scope, or override a built-in explicitly | experimental | [user-data.examples.ts](../../../../apps/api/src/examples/user-data/user-data.examples.ts) |
| `userDataModelRegistry` | registry | `Registry<UserDataModelHint>` | Read the keep-or-delete decisions (the kept list) | experimental | [user-data-purge.db.spec.ts](../../../../apps/api/test/user-data/user-data-purge.db.spec.ts) |
| `registerUserDataModels` | registry | `(defs: readonly UserDataModelHint[]) => void` | Decide every owner model of the app | experimental | [user-data.manifest.ts](../../../../apps/api/src/platform/user-data/user-data.manifest.ts) |
| `registerFactoryResetStep` | registry | `(def: FactoryResetStepDef) => void` | App deployment-level work of the reset (EvoPath's custom catalog) | experimental | [user-data.examples.ts](../../../../apps/api/src/examples/user-data/user-data.examples.ts) |
| `registerOffboardingPrecondition` | registry | `(def: OffboardingPreconditionDef) => void` | Block an offboarding until a check passes (#744: a recent export) | experimental | [user-data.examples.ts](../../../../apps/api/src/examples/user-data/user-data.examples.ts) |
| `USER_DATA_DB` | token | `UserDataDbPort` | Bind the bypass client | experimental | [user-data-host.module.ts](../../../../apps/api/src/platform/user-data/user-data-host.module.ts) |
| `USER_DATA_ENVIRONMENT` | token | `UserDataEnvironment` | Replace the default deployment and tenancy modes (pass `environment` to `forRoot`) | experimental | [user-data.integration.spec.ts](../../../../apps/api/test/user-data/user-data.integration.spec.ts) |
| `groupMembershipRemovalHook` | hook | `UserRemovalHook<GroupMembershipPurge>` | Keep groups administrable when a user row goes | experimental | [user-data.config.ts](../../../../apps/api/src/platform/user-data/user-data.config.ts) |
| `userDataConformanceSuite` | registry | `ConformanceSuite<UserDataConformanceOptions>` | Prove every owner model is decided | experimental | [user-data-conformance.spec.ts](../../../../apps/api/test/user-data/user-data-conformance.spec.ts) |

The purge hints (`category`, `storageObjectColumns`, `keepWhenReferenced`, `delegate`, `storageObjects`, `factoryReset`) are fields of `UserDataModelHint`; `legacyJobTypes` is a field of `UserDataModuleOptions`; both are shown in [user-data.examples.ts](../../../../apps/api/src/examples/user-data/user-data.examples.ts).

Supporting exports (experimental): `RECENT_ORG_EXPORT_PRECONDITION`, `recentOrgExportPrecondition(windowDays)` and `RECENT_ORG_EXPORT_PRECONDITION_ID` (an `org-data` export of the organization succeeded in the last 7 days; the reference app registers it in its user-data manifest), the read side of the registries (`userDataCategoryRegistry`, `userDataScopeRegistry`, `factoryResetStepRegistry`, `offboardingPreconditionRegistry`), the platform declarations (`PLATFORM_USER_DATA_CATEGORIES`, `PLATFORM_USER_DATA_MODELS`, `PLATFORM_FACTORY_RESET_STEPS`, `registerPlatformUserData`), the scope helpers (`BUILT_IN_USER_DATA_SCOPES`, `resolvedUserDataScopes`, `findUserDataScope`, `categoriesOfScope`), the planner (`orderForDeletion`, `relationsOf`, `selfUnlinkFields`, `backRelationFields`, `planUserPurge`, `UserDataPlanError`), the stateless purge functions (`collectUserObjectIds`, `deleteUserRows`, `deleteStorageObjects`, `countUserData`), the services, handlers, DTOs, permissions (`USER_DATA_PERMISSIONS`), metrics (`USER_DATA_APP_METRICS`) and audit actions (`USER_DATA_AUDIT_ACTIONS`).

## Data

No table of its own and no migration. A job's progress and result live on its own `jobs.payload` (`objectIds`, `deleted`, `result`): counts commit in the same transaction as the rows they count, so a retry adds to them. Deletes go through the app's Prisma delegates by model name, always `deleteMany` by condition. The raw-SQL partial unique indexes (`jobs_active_dedup_uniq_idx` gives one active purge per user and one factory reset per deployment) are relieved by these deletes and never touched.

Kept by every data reset: `User`, `UserIdentity`, `UserRole`, `RefreshToken`, `AllowedEmail`, `AuditEvent`, `Membership`, `GroupMember`, `Grant`, the deployment's `WorkerNode` and `NodeCredential` (all `keep` hints or no owner column).

## Permissions and settings

| Route | Permission |
|---|---|
| `GET /api/user-data/summary`, `POST /api/user-data/deletions`, `GET /api/user-data/deletions/:jobId` | `user_settings:write` (every role) |
| `GET /api/admin/factory-reset/summary`, `POST /api/admin/factory-reset`, `GET /api/admin/factory-reset/:jobId` | `system:factory_reset` (system, Admin only) |
| `GET /api/admin/orgs/:orgId/offboarding/summary`, `POST /api/admin/orgs/:orgId/offboarding`, `GET /api/admin/orgs/:orgId/offboarding/:jobId` | `orgs:offboard` (system, Admin only) |

`USER_DATA_PERMISSIONS` declares the two system permissions; the app registers them with its permission registry and the seed derives the grants. Never grant `system:factory_reset` for holding `system_settings:write`. No settings namespace.

## UI

None in this package. `@marinoscar/platform-web/user-data` ships the Danger Zone page, the factory reset page and the offboarding dialog.

## Infra

None. The storage key-prefix registry's `survivesFactoryReset: true` marks prefixes the factory reset keeps (the db-backup slice marks `database-backups/` in `DB_BACKUP_KEY_PREFIX`).

## Observability

- Metrics: `app.user_data.purges` (`scope`, `outcome`), `app.factory_reset.runs` (`outcome`), `app.org.offboardings` (`outcome`, `user_disposition`), counted per attempt. A user or organization id is never a label.
- Spans: the job span carries `user_data.scope`, `user_data.rows_deleted`, `user_data.storage_objects_deleted`, `user_data.storage_objects_failed`, `factory_reset.users_deleted`, and `org.id` for an offboarding.
- Audit: `user_data.purge.requested` / `.completed`, `admin.factory_reset.requested` / `.completed`, `org.offboard.requested` / `.completed` (with `orgId` in `meta`, and the skipped preconditions with their reason). Never row contents.
- Logs: a kept storage object is a warning with its id, never its key's contents.

## Security notes

- Every phrase is re-checked server-side as a zod literal (the scope's `confirmation`, `FACTORY RESET`, the organization's slug); the page only collects it.
- `everything` revokes personal access tokens: a CLI using a `pat_` token gets `401` afterwards. The browser session survives so the user can read the result.
- Every statement runs on the bypass connection (`USER_DATA_DB`, reasons `purge` and `admin-aggregate`), with an explicit owner or organization filter: row-level security must not hide a row from a purge, and a tenant client would.
- `DEPLOYMENT_MODE=saas` disables the factory reset (`403 FACTORY_RESET_DISABLED_IN_SAAS`); a SaaS operator offboards organizations instead. The default organization can never be offboarded.
- The jobs are server-only, permanently: no node is trusted with a deployment-wide delete.

## Conformance suite

`@marinoscar/platform-api/user-data/testing` registers `user-data` with `runPlatformConformance` (`suites: { userData: { datamodel } }`): every owner model has an explicit decision that `everything` reaches, every hint and scope names a model, column and category that exist, and a delete order exists. The reference app runs it in [user-data-conformance.spec.ts](../../../../apps/api/test/user-data/user-data-conformance.spec.ts). The web counterpart (both Danger Zone groups last) is `dangerZoneLastViolations` of `@marinoscar/platform-web/user-data/headless`.

## Upgrade notes

The slice now depends on the `doctor` and `host` slices (#880): it provides `USER_DATA_ENVIRONMENT` itself and registers `user-data.registries`. An app that bound `USER_DATA_ENVIRONMENT` in its host module deletes that binding (or passes it as `environment`). First release (#743). The three job types and the built-in scope ids are permanent. An app adopting the slice with its own pre-platform job type passes it in `legacyJobTypes` (EvoPath: `user.data_reset` → `everything`); kvox's `user.data.purge` and `POST /api/user-data/deletions` already match. `StorageKeyPrefixDef` gains the optional `survivesFactoryReset`.

## Troubleshooting

- **Startup fails with `UserDataPlanError`**: the delete order has a cycle (the message names the models), a hint names an unregistered category, or a `storageObjectColumns` entry is not a column. Break the cycle with a `SetNull` relation or delete one side in a factory reset step.
- **The conformance suite reports an undecided model**: add a hint for it (`{ model, category }` or `{ model, keep: '<why>' }`).
- **A purge left files behind**: the result's `storageObjectsFailed` counts objects the provider refused; their rows are kept, and running the deletion again retries them.
- **Offboarding fails with "storage object(s) could not be deleted"**: the organization is kept on purpose (its objects reference it); fix the provider and let the queue retry.

## Links

- [docs/specs/user-data-reset.md](../../../../docs/specs/user-data-reset.md): the design. [docs/runbooks/factory-reset.md](../../../../docs/runbooks/factory-reset.md): backup first, run, verify, recover, offboard.
- [`@marinoscar/platform-contract/user-data`](../../../platform-contract/src/user-data/README.md) and [`@marinoscar/platform-web/user-data`](../../../platform-web/src/user-data/README.md).
