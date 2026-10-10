# Roles and permissions

The role and permission registries (issue #676; packaged by #866). Every role
and permission is declared **once**, beside the slice that enforces it, with
its description and its default role grants. The registries themselves are
`roleRegistry` and `permissionRegistry` of `@marinoscar/platform-api/core`
([core README](../../../../../packages/platform-api/src/core/README.md#roles-and-permissions)),
and the platform's declarations, in seed order, are
`@marinoscar/platform-api/manifest`
([manifest README](../../../../../packages/platform-api/src/manifest/README.md)).
This folder is the app's half: the one manifest call, the committed catalog,
and the augmentable id interfaces. Everything else is derived:

| Derived | From | Read by |
|---|---|---|
| `ROLES`, `PERMISSIONS`, `RoleName`, `PermissionName`, `DEFAULT_ORG_ROLE` (alias `DEFAULT_ROLE`), `ORG_ADMIN_ROLE` (`common/constants/roles.constants.ts`) | `PLATFORM_ROLES` and `PLATFORM_PERMISSIONS` of the manifest slice, through `roleIds` / `permissionIds` | `@Auth()`, `@Permissions()`, `@Roles()`, guards, services |
| The filled `roleRegistry`, `permissionRegistry` (re-exported by this folder) | The manifest, at import time | `buildPermissionCatalog()`, the conformance suites, tests |
| `apps/api/prisma/catalog/permissions.json` (generated, committed) | `buildPermissionCatalog()` | `prisma/seed-data.ts`, so `npm run prisma:seed` |

The permission matrix (which role holds what, and what each permission
gates) is [docs/ARCHITECTURE.md §7](../../../../../docs/ARCHITECTURE.md#7-authorization).
Spec: [platform-packages.md](../../../../../docs/specs/platform-packages.md),
"The Extension Contract" (rung 2: `registerPermissions()`).

## Files

| File | What it holds |
|---|---|
| `permission.manifest.ts` | One call: `registerPlatformPermissions({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } })`. |
| `permission-catalog.ts` | `renderPermissionCatalog()`, `checkPermissionCatalog()` and the catalog's path and regenerate command. |
| `permission.types.ts` | The augmentable `AppPermissionIds` / `AppRoleIds`. Types only. |
| `index.ts` | The barrel. Importing it runs the manifest, then re-exports core's (now full) registries and `buildPermissionCatalog`. |

The platform declarations, one per owning slice (`packages/platform-api/src/`),
in seed order (`PLATFORM_PERMISSION_SETS`):

| Declaration | Ids |
|---|---|
| `settings/settings.permissions.ts` (`SETTINGS_PERMISSIONS`) | `system_settings:read`, `system_settings:write`, `user_settings:read`, `user_settings:write` |
| `identity/users/users.permissions.ts` | `users:read`, `users:write`, `rbac:manage` |
| `identity/allowlist/allowlist.permissions.ts` | `allowlist:read`, `allowlist:write` |
| `storage/storage.permissions.ts` | `storage:read`, `storage:write`, `storage:delete_any` |
| `jobs/jobs.permissions.ts` | `jobs:read`, `jobs:write` |
| `nodes/nodes.permissions.ts` | `nodes:read`, `nodes:write` |
| `db-backup/db-backup.permissions.ts` | `db_backup:read`, `db_backup:write`, `db_backup:restore` |
| `notifications/notifications.permissions.ts` (`BROADCASTS_PERMISSIONS`, `PUSH_PERMISSIONS`) | `broadcasts:read`, `broadcasts:write`; `push:read`, `push:write` |
| `storage/config/storage-config.permissions.ts` | `storage_config:read`, `storage_config:write` |
| `ai/ai.permissions.ts` | `ai_config:read`, `ai_config:write`, `ai:use`, `org_ai_config:read`, `org_ai_config:write` |
| `telemetry/telemetry.permissions.ts` | `telemetry:read`, `telemetry:write`, `telemetry:query` |
| `identity/organizations/organizations.permissions.ts` | `org_members:read`, `org_members:write`, `org_invites:read`, `org_invites:write` (org); `organizations:read`, `organizations:write` (system) |
| `sharing/permissions.ts` | `groups:read`, `groups:write`, `groups:admin`, `sharing:read`, `sharing:write`, `sharing:admin` |
| `settings/settings.permissions.ts` (`ORG_SETTINGS_PERMISSIONS`) | `org_settings:read`, `org_settings:write` |
| `notifications/notifications.permissions.ts` (`ORG_BROADCASTS_PERMISSIONS`) | `org_broadcasts:read`, `org_broadcasts:write` |
| `user-data/user-data.permissions.ts` | `system:factory_reset`, `orgs:offboard` |
| `app-registrations/permissions.ts` (app-owned) | `APP_ROLES`, `APP_PERMISSIONS`: empty upstream |

The four roles are the identity slice's `IDENTITY_ROLES` (`PLATFORM_ROLES`).

## Rules

| Rule | Detail |
|---|---|
| Ids | A permission id is `<resource>:<action>`, lower case, digits and `_` (`/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/`). A role id is `/^[a-z][a-z0-9_-]*$/`. Otherwise `INVALID_ID`. |
| Description | Required and non-blank, for roles and permissions. Otherwise `INVALID_ENTRY`. |
| Grants | Every id in `defaultGrants` must be a role registered **earlier**, and appear once. Otherwise `INVALID_ENTRY`. `[]` is allowed: a permission no role holds by default. |
| Duplicates | An id registered twice, including an app id equal to a platform id, is `DUPLICATE_ID`. Nothing is replaced. |
| Order | Platform roles, app roles, platform permissions (manifest order), app permissions. The catalog, and so the seed, follows it. |
| When | A bad declaration fails **at import time**, as a `RegistryError` naming the registry (`roles` or `permissions`) and the id, so the API, the generator and the tests all refuse to start. |
| Scope | Every role and every permission declares `scope: 'system' \| 'org'` (issue #723); there is no default. A `defaultGrants` entry naming a role of the other scope is `INVALID_ENTRY`. System roles are held in `user_roles`; org roles on a membership. |
| Admin | The system `admin` role holds every **system** permission and `org_admin` every **org** permission (`permission.registry.spec.ts` here and `test/manifest/manifest.spec.ts` in the package assert both). Give a new system permission `'admin'` in `defaultGrants`, a new org permission `'org_admin'`. |
| Strings are permanent | A permission id is stored in `permissions.name` and mirrored by the web app's settings cards ([settings-ui spec](../../../../../docs/specs/settings-ui.md), rule 3). Do not rename one; add a new one. |

### Choosing default grants

Start narrow. A grant is a row, so widening it later is a re-seed or an
administrator's click; narrowing it later means finding every deployment that
already handed it out.

- **Operational surfaces are Admin-only, including their read halves**: the
  queue, the fleet, backups, broadcasts, push keys, storage configuration, AI
  configuration, telemetry. A read there exposes job payloads, host names, the
  deployment's schedule or its configuration. The reasoning for each lives in a
  comment on its declaration.
- **Split by blast radius, not by screen.** A permission that can break every
  user at once (`storage_config:*`, `push:*`, `ai_config:*`, `db_backup:restore`)
  is its own permission, never folded into `system_settings:*` or into an
  everyday permission like `storage:*`.
- **Choose the scope by what it operates.** A permission over the deployment
  (configuration, other users, the queue, backups) is `system`. A permission a
  member uses inside their organization (their own settings and objects, AI
  use, the org's members) is `org`. Granting a system permission to an org
  role would let a customer's org admin operate the deployment, which is what
  the split prevents; the registry refuses it.
- **Mind the default role.** Viewer is what every new membership gets
  (`DEFAULT_ORG_ROLE`). `ai:use` is withheld from it so a fresh signup cannot spend
  the deployment's org AI key; anything with a cost or a privacy edge should be
  withheld the same way.

## Recipe: a platform slice adds a permission

1. Add an entry to the slice's declaration file in
   `packages/platform-api/src/<slice>/` (create `<slice>.permissions.ts` if it
   has none, exporting a map typed with core's `PermissionDeclaration`):

   ```typescript
   // packages/platform-api/src/jobs/jobs.permissions.ts
   import type { PermissionDeclaration } from '../core/index';

   export const JOBS_PERMISSIONS: {
     readonly JOBS_READ: PermissionDeclaration<'jobs:read'>;
     readonly JOBS_WRITE: PermissionDeclaration<'jobs:write'>;
   } = {
     JOBS_READ: { id: 'jobs:read', description: 'View queued, running and completed jobs', scope: 'system', defaultGrants: ['admin'] },
     JOBS_WRITE: { id: 'jobs:write', description: 'Enqueue, retry and cancel jobs', scope: 'system', defaultGrants: ['admin'] },
   };
   ```

   The key (`JOBS_READ`) becomes the `PERMISSIONS` key. Keep the file pure
   data: `import type` only, no side effects. Export it from the slice's
   `index.ts`.

2. For a **new** map only: append one entry to `PLATFORM_PERMISSION_SETS` and
   one spread to `PLATFORM_PERMISSIONS` in
   `packages/platform-api/src/manifest/platform-permissions.ts`, both at the
   end (appending keeps every deployment's seed order). A new declaring slice
   also joins `PLATFORM_PERMISSION_SLICES` and the manifest's entry in
   `packages/platform-slices.json`.
3. Enforce it: `@Auth({ permissions: [PERMISSIONS.JOBS_READ] })`.
4. Rebuild the package, regenerate and commit the catalog, then re-seed:

   ```bash
   npm run build -w @marinoscar/platform-api
   npm run catalog:permissions --workspace=api
   npm run prisma:seed --workspace=api
   ```

5. Add the row to the matrix in `docs/ARCHITECTURE.md` §7.2 (a test checks
   every id has a row with the right ticks), and update the literal baseline in
   `test/prisma/permission-catalog.spec.ts`.

## Recipe: an app adds a permission or a role

An app (a fork) never edits a platform declaration, the manifest or
`roles.constants.ts`. It fills the app-owned file, which upstream keeps empty
(the manifest passes it to `registerPlatformPermissions` as `app`):

```typescript
// apps/api/src/app-registrations/permissions.ts
import type { PermissionDeclaration, RoleDeclaration } from '@marinoscar/platform-api/core';

export const APP_ROLES: readonly RoleDeclaration[] = [
  { id: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org' },
];

export const APP_PERMISSIONS: readonly PermissionDeclaration[] = [
  { id: 'workouts:read', description: 'Read own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'viewer', 'coach'] },
  { id: 'workouts:write', description: 'Log and edit own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'coach'] },
];

// Typed ids: without this, `@Auth({ permissions: ['workouts:read'] })` does not type-check.
declare module '../common/permissions/permission.types' {
  interface AppPermissionIds {
    'workouts:read': true;
    'workouts:write': true;
  }
  interface AppRoleIds {
    coach: true;
  }
}
```

Then:

```bash
npm run catalog:permissions --workspace=api   # rewrites prisma/catalog/permissions.json
git add apps/api/prisma/catalog/permissions.json
npm run prisma:seed --workspace=api           # or let `appctl deploy update` run its seed step
```

App roles and permissions land after the platform's in the catalog, so the
seed upserts the platform rows first. An app id that collides with a platform
id fails at import time with `DUPLICATE_ID`; a grant to a role nobody declared
fails with `INVALID_ENTRY`. The compile-time test
`test/auth/app-permission-ids.spec.ts` shows the augmentation working in
`@Auth()`, `@Permissions()` and `@Roles()`.

## Why the seed reads a generated file

`prisma/seed.ts` runs inside the production image (`appctl deploy update`,
step `seed`), and that image carries `dist/` and `prisma/` but no `src/`
(`apps/api/Dockerfile`, guarded by `test/production-image.spec.ts`). So the
seed cannot import these registries. Instead the generator writes them to
`prisma/catalog/permissions.json`, which the image already copies, and
`seed-data.ts` reads it.

- `npm run catalog:permissions --workspace=api -- --check` exits 1, printing
  the regenerate command, when the committed file differs from what the
  declarations produce.
- `test/prisma/permission-catalog.spec.ts` makes the same check in `npm test`,
  and pins the file to a literal baseline.
- Never edit the JSON by hand.

An app whose seed can import its packages and its own declarations may skip
the file and compose the catalog in the seed instead:
`platformPermissionCatalog({ app })` of `@marinoscar/platform-api/manifest`
returns the same catalog `buildPermissionCatalog()` does after the manifest
runs (the starter template does this). This app keeps the file because its own
declarations live in `src/`. `test/prisma/seed-data.spec.ts` and
`test/prisma/seed-platform.db.spec.ts` prove the composed and the committed
inputs write exactly the same rows.

The seed only **adds**: it upserts roles, permissions and grants by natural
key, so re-seeding is idempotent and never removes a grant an administrator
revoked or a permission a declaration dropped.

### Rejected alternatives

- **The seed imports `src/`.** The production image has no `src/`, and
  copying it in for one script widens the image.
- **The seed reads `dist/`.** `dist/` does not exist in the development loop,
  where the seed also runs.
- **The API syncs permissions on boot.** The API would write RBAC rows on
  startup, contradicting "the API does not migrate on startup" and the explicit
  deploy `seed` step.
- **Keep `roles.constants.ts` hand-written and register from it.** A fork would
  still edit it to add a permission, which is the conflict this removes.
