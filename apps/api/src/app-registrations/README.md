# App registrations

The app-owned seam of every static registry (issue #675). This folder is
where **this application** adds its own entries (permissions, settings
namespaces, notification events, storage prefixes, metric groups, user-owned
models) to registries the platform defines.

The primitive and the full recipe: [packages/platform-api/src/core/registry/README.md](../../../../packages/platform-api/src/core/registry/README.md).
Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md),
"The Extension Contract".

## Why this folder exists

A fork that adds a permission by editing a platform file (the platform's
declaration list, or the registry's manifest) conflicts with upstream on every
merge that touches the same list. Instead, each registry's manifest imports
one file from here **after** every platform declaration:

```text
platform declarations ──► manifest ──► registry
                             ▲
app-registrations/<registry>.ts (this folder, owned by the app)
```

- Upstream ships one file per registry here, each exporting an **empty** array
  (or a no-op function), and keeps it empty forever.
- A fork adds its entries to those files and **never edits** a platform
  declaration file or a manifest.
- Because upstream never changes these files, a fork's edits here never
  conflict on merge.

Each registry story adds its own file to this folder when it creates the
registry.

| File | Registry | Recipe |
|---|---|---|
| `permissions.ts` | Roles and permissions (`APP_ROLES`, `APP_PERMISSIONS`) | [common/permissions/README.md](../common/permissions/README.md) |
registry:

| File | Registry | Recipe |
|---|---|---|
| `settings.ts` | System and user settings namespaces, and extensions of platform namespaces | [settings/registry/README.md](../settings/registry/README.md) |
registry:

| File | Registries it feeds | Read |
|---|---|---|
| `notifications.ts` | notification channels (`APP_NOTIFICATION_CHANNELS`), email templates (`APP_EMAIL_TEMPLATES`), notifications: event plus email template and browser renderer (`APP_NOTIFICATIONS`) | [notifications/registry/README.md](../notifications/registry/README.md) |

A notification channel's transport is a Nest provider, so it cannot live
here: it goes in the app's own module and registers itself into
`NotificationChannelSenderRegistry` (see
[notifications/README.md](../notifications/README.md#adding-a-channel)).
registry:

| File | Registry | Recipe |
|---|---|---|
| `user-owned-models.ts` | `userOwnedModelRegistry` (`@marinoscar/platform-api/core`): every model with a foreign key to `User` | [prisma/ownership/README.md](../prisma/ownership/README.md) |
| `model-ownership.ts` | `modelOwnershipRegistry` (`@marinoscar/platform-api/core`): the ownership kind of every model (`org`, `org-optional`, `user`, `system`); an `org` model also needs `org_id`, a policy and a migration (#725) | [prisma/ownership/README.md](../prisma/ownership/README.md), [SECURITY-ARCHITECTURE.md §18](../../../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls) |
| `user-data.ts` | The user-data slice's registries (`@marinoscar/platform-api/user-data`, #743): a keep-or-delete hint per owner model, categories, scopes, factory reset steps, offboarding preconditions | [docs/specs/user-data-reset.md §4](../../../../docs/specs/user-data-reset.md#4-extending-it-in-an-app) |

| File | Registries it feeds | Recipe |
|---|---|---|
| `telemetry.ts` | Telemetry Dashboard metric groups (`APP_METRIC_GROUPS`) and `app.*` metrics (`APP_METRICS`); one file for both, because a group usually charts the app's own metrics | [runbooks/telemetry.md §8.4](../../../../docs/runbooks/telemetry.md#84-adding-an-app-metric-group) |

registry:

| File | Registry | Recipe |
|---|---|---|
| `host.ts` | `eventBusAdapterRegistry` (`@marinoscar/platform-api/host`, PP-14.2): event bus adapters, registered at import time with `registerEventBusAdapter(...)` and selected by `EVENT_BUS_ADAPTER` or `forRoot({ eventBusAdapter })`. Unlike the pure-data files it makes the `register` call itself, because `platform/host-core.config.ts` imports it before the bus is built. Upstream registers the worked example (`recording`) | [host/README.md, "Adding an event bus adapter"](../../../../packages/platform-api/src/host/README.md#adding-an-event-bus-adapter) |

registry:

| File | Registry | Recipe |
|---|---|---|
| `core.ts` | The implementations of a pluggable kind (`definePluggableKind` of `@marinoscar/platform-api/core`, PP-14.5): one registry per kind, `pluggable.<kind>`. Makes the `register` call itself, at import time. Upstream registers the worked example, the toy `greeter` kind; nothing in the running app imports it | [core/README.md, "Pluggable kinds"](../../../../packages/platform-api/src/core/README.md#pluggable-kinds) |

registry:

| File | Registry | Recipe |
|---|---|---|
| `ai.ts` | `aiProviderKind` (`@marinoscar/platform-api/ai`, PP-14.6): AI providers, registered at import time with `registerAiProvider(...)`. `platform/ai/ai.config.ts` imports it before `AiModule.forRoot()`, which loads the module of every registered provider. Upstream registers the worked example (`example-transcribe`, an AssemblyAI stand-in that only transcribes over a fake transport); it is off until an administrator switches it on | [ai/README.md, "Adding a provider from an app or package"](../../../../packages/platform-api/src/ai/README.md) |

registry:

| File | Registry | Recipe |
|---|---|---|
| `storage.ts` | `storageDriverKind` (`@marinoscar/platform-api/storage`, PP-14.7): storage drivers, registered at import time with `registerStorageDriver(...)`. `platform/storage/storage.config.ts` imports it before the storage module is built. Upstream registers the worked example (`local-fs`, objects as files in a folder on the API host); it is off until an administrator selects it | [storage/README.md, "Adding a storage driver from an app or package"](../../../../packages/platform-api/src/storage/README.md) |

## What goes here, and what does not

| Goes here | Does not |
|---|---|
| Pure data: entry arrays typed with the registry's entry type | Side effects on import (no `register()` calls: the manifest registers) |
| `declare module` augmentations of the registry's `App...` interfaces | Imports of Nest, Prisma or any service: these files are read by seeds and standalone scripts with no Nest container |
| One file per registry, named after it (`permissions.ts`) | Platform entries: those live next to the owning platform module |

## Minimal example

The permissions file (issue #676) is the first one. The base ships both arrays
empty; a fork fills them in and widens the typed ids by module augmentation:

```typescript
// apps/api/src/app-registrations/permissions.ts (in the fork)
import type { PermissionDeclaration, RoleDeclaration } from '@marinoscar/platform-api/core';

export const APP_ROLES: readonly RoleDeclaration[] = [];

export const APP_PERMISSIONS: readonly PermissionDeclaration[] = [
  { id: 'workouts:read', description: 'Read own workouts', defaultGrants: ['admin', 'contributor', 'viewer'] },
  { id: 'workouts:write', description: 'Log and edit own workouts', defaultGrants: ['admin', 'contributor'] },
];

declare module '../common/permissions/permission.types' {
  interface AppPermissionIds {
    'workouts:read': true;
    'workouts:write': true;
  }
}
```

Then `npm run catalog:permissions --workspace=api`, commit the regenerated
`prisma/catalog/permissions.json`, and re-seed. Full recipe:
[common/permissions/README.md](../common/permissions/README.md).

The manifest registers app entries after platform entries, so an id that
collides with a platform entry fails at import time with `DUPLICATE_ID`,
naming the registry and the id (unless that registry is documented as
`onDuplicate: 'replace'`, in which case the app entry deliberately shadows the
platform one in its original position).

Each registry's own README names its file and entry type.
