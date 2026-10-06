# App registrations

The app-owned seam of every static registry (issue #675). This folder is
where **this application** adds its own entries (permissions, settings
namespaces, notification events, storage prefixes, metric groups, user-owned
models) to registries the platform defines.

The primitive and the full recipe: [common/registry/README.md](../common/registry/README.md).
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
import type { PermissionDeclaration, RoleDeclaration } from '../common/permissions/permission.types';

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
