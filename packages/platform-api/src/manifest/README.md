# @marinoscar/platform-api/manifest

`@marinoscar/platform-api/manifest`: what every platform slice registers, in registration order (issue #866). The platform roles and every slice's permission sets in seed order, the inventory of platform models with a foreign key to `User`, the ownership kind of every platform model, and the functions that register them, plus an app's own, into the registries of `core`. Data and plain functions: no Nest module, no provider, no table. It depends on `core` and on every slice that declares permissions or user-owned models: `identity`, `settings`, `credentials`, `sharing`, `storage`, `jobs`, `nodes`, `notifications`, `ai`, `telemetry`, `db-backup`, `android-app` and `user-data` (`packages/platform-slices.json`); no slice depends on it.

## Purpose and scope

Every slice declares its permissions beside the routes that enforce them (`<slice>.permissions.ts`, typed with core's `PermissionDeclaration`, each with a `scope` of `system` or `org` and its default grants), and the identity slice declares the four roles. Before this slice, the **order** of those declarations, which is the seed's order and the committed catalog's, and the inventory of platform models with a `User` foreign key and the platform's model ownership classification lived in the reference app (`common/permissions/permission.manifest.ts`, `prisma/ownership/platform-user-owned-models.ts`, `prisma/ownership/platform-model-ownership.ts`), so every other app had to copy them. Now:

| Export | What it is |
|---|---|
| `PLATFORM_ROLES` | The identity slice's roles: `admin` (system); `contributor`, `viewer`, `org_admin` (org) |
| `PLATFORM_PERMISSION_SETS` | Every slice's permission map with its declaring slice, in seed order (17 sets, 51 permissions) |
| `PLATFORM_PERMISSIONS` | The same, flattened into one map keyed by constant name (`JOBS_READ`): `permissionIds(PLATFORM_PERMISSIONS)` is an app's `PERMISSIONS` |
| `PLATFORM_PERMISSION_SLICES`, `PlatformPermissionSlice` | The eleven slices that declare permissions |
| `registerPlatformPermissions(options?)` | Fill core's `roleRegistry` and `permissionRegistry`: platform roles, app roles, platform permissions, app permissions |
| `platformPermissionCatalog(options?)`, `platformPermissionDeclarations(options?)` | The same catalog composed without touching the registries, and the batches behind both |
| `PLATFORM_USER_OWNED_MODELS` | Every platform model with a foreign key to `User`, with its purge and export policy |
| `registerPlatformUserOwnedModels(appModels?)` | Register the inventory, then the app's models, in core's `userOwnedModelRegistry` |
| `PLATFORM_MODEL_OWNERSHIP` | Every platform model's ownership kind (`org`, `org-optional`, `user`, `system`) |
| `registerPlatformModelOwnership(appModels?)` | Register the classification, then the app's, in core's `modelOwnershipRegistry` |

Does not: register anything by being imported, own a table, seed (that is `seedPlatform` of `@marinoscar/platform-db/seed`, which takes the catalog), or write row-level security policies (those are migrations of `@marinoscar/platform-db`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { registerPlatformPermissions, registerPlatformUserOwnedModels } from '@marinoscar/platform-api/manifest';
```

No peer beyond the package's own. Importing the slice loads every slice it depends on (their indexes), which needs the package's Nest peers installed, as every app has; nothing is instantiated.

## Quick start

The reference app's two manifests, each imported for its side effect before bootstrap:

```ts
// apps/api/src/common/permissions/permission.manifest.ts
import { registerPlatformPermissions } from '@marinoscar/platform-api/manifest';
import { APP_PERMISSIONS, APP_ROLES } from '../../app-registrations/permissions';

registerPlatformPermissions({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } });
```

```ts
// apps/api/src/prisma/ownership/user-owned-model.manifest.ts
import { registerPlatformUserOwnedModels } from '@marinoscar/platform-api/manifest';
import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';

registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS);
```

```ts
// apps/api/src/prisma/ownership/model-ownership.manifest.ts
import { registerPlatformModelOwnership } from '@marinoscar/platform-api/manifest';
import { APP_MODEL_OWNERSHIP } from '../../app-registrations/model-ownership';

registerPlatformModelOwnership(APP_MODEL_OWNERSHIP);
```

A seed that can import its packages (an app whose production image carries `node_modules`) composes the catalog directly instead of reading a committed file:

```ts
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { composeDefaultSystemSettings } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform } from '@marinoscar/platform-db/seed';

const permissions = platformPermissionCatalog({ slices: ['identity', 'settings', 'jobs', 'nodes'], app: { permissions: [NOTES_PERMISSIONS] } });
await seedPlatform(prisma, platformSeedInputFrom({ permissions, settings: composeDefaultSystemSettings() }, process.env), log);
```

The `userOwnedData` conformance suite then covers platform and app models together: pass the whole composed schema and the whole registry.

```ts
userOwnedData: {
  schemaPath: join(__dirname, '..', 'prisma', 'schema'), // platform.*.prisma and app.*.prisma
  policies: userOwnedModelRegistry.list(),               // after registerPlatformUserOwnedModels(APP_MODELS)
  rawSqlAllowlist: [],
}
```

## Configuration

`PlatformPermissionOptions`, taken by `registerPlatformPermissions`, `platformPermissionCatalog` and `platformPermissionDeclarations`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `slices` | `PlatformPermissionSlice[]` | every slice | The slices whose permission sets to include. The sets keep their seed order whatever the list order. Must include `identity`; an unknown name throws. List each slice whose permissions the app's mounted slices enforce: credentials, email, onboarding and android-app declare none and enforce the `settings` slice's |
| `app.roles` | `Declarations<RoleDeclaration>[]` | `[]` | Batches of the app's roles, registered after the platform roles |
| `app.permissions` | `Declarations<PermissionDeclaration>[]` | `[]` | Batches of the app's permissions, registered after every platform permission |

`registerPlatformUserOwnedModels(appModels)` takes the app's `UserOwnedModelDef[]` and `registerPlatformModelOwnership(appModels)` its `ModelOwnershipDef[]` (both default `[]`).

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerPlatformPermissions` | registry | `registerPlatformPermissions(options?: PlatformPermissionOptions): void` | Fill the role and permission registries once, from the app's permission manifest, with the platform's declarations and the app's | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `PlatformPermissionOptions` | option | `{ slices?: PlatformPermissionSlice[]; app?: { roles?; permissions? } }` | Add the app's roles and permissions, or seed only the slices the app mounts | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `registerPlatformModelOwnership` | registry | `registerPlatformModelOwnership(appModels?: ModelOwnershipDef[]): void` | Fill the model ownership registry once, from the app's manifest, with every platform model's kind and the app's | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `registerPlatformUserOwnedModels` | registry | `registerPlatformUserOwnedModels(appModels?: UserOwnedModelDef[]): void` | Fill the user-owned data registry once, from the app's manifest, with every platform model and the app's | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |

## Data

None owned. `PLATFORM_USER_OWNED_MODELS` describes the `User` foreign keys of the platform's fragments (`@marinoscar/platform-db`, `schema/*.prisma`): 24 base entries (identity, settings' `UserSettings` and `SystemSettings`, notifications, jobs and nodes, AI, storage, db-backup), then the sharing, settings (`OrgSettings`), credentials and android-app slices' own lists, in the order the reference app always registered them. That order is the order the user-data export lists its datasets, so it is append-only. `PLATFORM_MODEL_OWNERSHIP` classifies every model of those fragments (41: 32 base, then the sharing, settings, credentials and android-app slices'), in the reference app's registration order. Every app composes every platform fragment, so every app registers every entry of both; there is no filter.

## Permissions and settings

Declares no permission of its own: it orders the ones the slices declare. The seed order, which the reference app's committed `prisma/catalog/permissions.json` follows byte for byte:

| # | Set | Slice |
|---|---|---|
| 1 | `SETTINGS_PERMISSIONS` | settings |
| 2 | `USERS_PERMISSIONS` | identity |
| 3 | `ALLOWLIST_PERMISSIONS` | identity |
| 4 | `STORAGE_PERMISSIONS` | storage |
| 5 | `JOBS_PERMISSIONS` | jobs |
| 6 | `NODES_PERMISSIONS` | nodes |
| 7 | `DB_BACKUP_PERMISSIONS` | db-backup |
| 8 | `BROADCASTS_PERMISSIONS` | notifications |
| 9 | `PUSH_PERMISSIONS` | notifications |
| 10 | `STORAGE_CONFIG_PERMISSIONS` | storage |
| 11 | `AI_PERMISSIONS` | ai |
| 12 | `TELEMETRY_PERMISSION_DECLARATIONS` | telemetry |
| 13 | `ORGANIZATIONS_PERMISSIONS` | identity |
| 14 | `SHARING_PERMISSION_DECLARATIONS` | sharing |
| 15 | `ORG_SETTINGS_PERMISSIONS` | settings |
| 16 | `ORG_BROADCASTS_PERMISSIONS` | notifications |
| 17 | `USER_DATA_PERMISSIONS` | user-data |

A new platform set is **appended**, never inserted, so no deployment's catalog reorders. Reads no setting.

## UI

None. The slice is API-side data.

## Infra

None. No environment variable, port or service.

## Observability

None. The functions log nothing and emit no span or metric; a refused declaration throws at import time, which stops the process with a `RegistryError` naming the registry and the id.

## Security notes

The default grants it registers are the deployment's access model: the matrix in `docs/ARCHITECTURE.md` §7.2 must agree with them (the reference app's `test/prisma/permission-catalog.spec.ts` checks every row). The system `admin` role holds every system permission and `org_admin` every org permission; core's registry refuses a grant across scopes, so an app cannot hand a system permission to an org role through `app.permissions`. An app id equal to a platform id is refused (`DUPLICATE_ID`), never silently merged. The user-owned inventory decides what the scoped client confines and what the user's export carries; `exportOmit` keeps hashes and ciphertexts (`PersonalAccessToken.tokenHash`, `UserAiKey.secret`) out of every export.

## Conformance suite

None of its own. Two suites read what it registers: the identity suite (`@marinoscar/platform-api/identity/testing`; pass `permissionRegistry.list()`, `roleRegistry.list()` and `catalogGrants(buildPermissionCatalog())`) and `userOwnedData` (`@marinoscar/platform-api/testing`; pass `userOwnedModelRegistry.list()` and the composed schema). `test/manifest/manifest.spec.ts` checks both inventories against the platform's own fragments; the reference app's `test/tenancy/model-ownership.spec.ts` and `rls-coverage.db.spec.ts` check the classification against its schema and database.

## Upgrade notes

New in this release. For an app that kept its own copies:

- Replace a hand-written permission manifest with `registerPlatformPermissions({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } })`; the registries, ids, order and catalog are unchanged, so a committed catalog regenerates byte-identical. Derive `PERMISSIONS` with `permissionIds(PLATFORM_PERMISSIONS)` and `ROLES` with `roleIds(PLATFORM_ROLES)` (both from `core`).
- Replace a local platform user-owned list with `registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS)`, and a local platform model ownership list with `registerPlatformModelOwnership(APP_MODEL_OWNERSHIP)`.

### Starter follow-up

The starter template (#741) hand-wrote both. Once #741 merges, it should:

1. Delete `apps/api/src/platform/permissions.ts` (`ROLES`, `PERMISSIONS`, `defaultGrants()`).
2. Seed from the registry: in `prisma/seed.ts`, build `permissions` with `platformPermissionCatalog({ slices: ['identity', 'settings', 'jobs', 'nodes'], app: { permissions: [NOTES_PERMISSIONS] } })` and pass it, with `composeDefaultSystemSettings()`, through `platformSeedInputFrom({ permissions, settings }, process.env)` to `seedPlatform`. Widen `slices` as it mounts more slices.
3. Add a permission manifest imported by `main.ts` and the conformance spec (`registerPlatformPermissions({ slices, app: { permissions: [NOTES_PERMISSIONS] } })`), and give the identity suite `permissionRegistry.list()`, `roleRegistry.list()` and `catalogGrants(buildPermissionCatalog())`.
4. Replace `registerUserOwnedModels(APP_USER_OWNED_MODELS)` in `notes.ownership.ts` with `registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS)` (in one manifest, so it runs once). Without it a `forUser()` client refuses every platform model.
5. Point the `userOwnedData` suite at the whole composed schema (`prisma/schema`, not `prisma/fragments`) with `policies: userOwnedModelRegistry.list()`, so platform and app models are checked together.
6. Drop the "packaged role and permission registry and the platform's user-owned model inventory" bullet from the README's "Known gaps".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RegistryError: DUPLICATE_ID` naming a permission at startup | An app permission reuses a platform id, or `registerPlatformPermissions` ran twice | Rename the app's id; call it from one manifest only |
| `RegistryError: INVALID_ENTRY ... unknown role` | An app permission grants a role nobody registered | Declare the role in `app.roles` |
| `RegistryError: FROZEN` | Registered after bootstrap (from `onModuleInit`) | Register at import time, from a manifest imported before `NestFactory.create` |
| `` `slices` must include 'identity' `` | The filter left identity out | Add `'identity'` |
| The identity suite reports a route permission "not registered" | A mounted slice enforces a permission whose slice is not in `slices` | Add that slice (often `settings`) |
| `userOwnedData` reports a platform model "with no registry entry" | The app registered only its own models, or checked only its fragments | Call `registerPlatformUserOwnedModels` and point `schemaPath` at the composed schema |

## Links

- [Package README](../../README.md)
- [core: Roles and permissions](../core/README.md#roles-and-permissions)
- [Platform packages spec: the extension contract](../../../../docs/specs/platform-packages.md#the-extension-contract)
- [Reference app permissions README](../../../../apps/api/src/common/permissions/README.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
