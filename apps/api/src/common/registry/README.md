# Registries

The generic, typed registry primitive (issue #675). Every closed list the
platform opens up for apps (permissions, settings namespaces, notification
events, storage prefixes, metric groups, user-owned models, doctor checks)
is a `Registry<T>` from this folder, so they all share one duplicate rule,
one ordering rule and one set of error codes.

Spec: [platform-packages.md](../../../../../docs/specs/platform-packages.md),
"The Extension Contract" (rung 2) and "What an extension may and may not rely
on". The app-owned seam: [app-registrations/README.md](../../app-registrations/README.md).

## Files

| File | What it holds |
|---|---|
| `registry.ts` | `Registry<T>`, `RegistryError`, `defineRegistry`, `listDefinedRegistries`, `freezeDefinedRegistries`. Imports nothing (a test enforces it), so seeds, standalone scripts and import-time DTOs can use it. |
| `registry-freeze.service.ts` | Nest provider in `CommonModule`: freezes every defined registry in `onApplicationBootstrap`. Not re-exported by `index.ts`. |
| `testing.ts` | `withTemporaryEntries`, for tests only. |
| `index.ts` | The barrel: `import { Registry, defineRegistry } from '../common/registry'`. |

## The behaviour apps may rely on

These rules are pinned by `registry.spec.ts`. They are the "registry
behaviour: ordering, duplicate-id handling, error cases" the spec promises
stable.

| Rule | Detail |
|---|---|
| Ids | Strings, 1 to 128 characters, matching `DEFAULT_REGISTRY_ID_PATTERN` (`/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/`) unless the registry sets `idPattern`. Otherwise `INVALID_ID`. |
| Validation | A registry's `validate(entry, registry)` rejects an entry by throwing; the throw becomes `INVALID_ENTRY` with the original message (and the original error as `cause`). |
| Duplicates | `onDuplicate: 'throw'` (the default) raises `DUPLICATE_ID`. `'replace'` puts the new entry at the old entry's position and calls `onReplace(previous, next)`. |
| Batches | `registerAll` is all or nothing: one bad entry, or a duplicate inside the batch, rejects the whole batch and leaves the registry unchanged. |
| Order | `list()` and `ids()` follow `order`: registration order by default, `'id'` for code-unit order (`'B'` before `'a'`, independent of locale), or a comparator (ties keep registration order). |
| Copies | `list()` and `ids()` return fresh arrays. Entries themselves are stored as given, never cloned, so make them `as const` or `Object.freeze`d data. |
| Freeze | After `freeze()`, `register` and `registerAll` throw `FROZEN`; reads keep working. Idempotent. |
| Lookup | `get(id)` returns `undefined` for a missing id; `require(id)` throws `UNKNOWN_ID`. |
| Names | `defineRegistry` with a name already defined throws `DUPLICATE_REGISTRY`. |

Every error is a `RegistryError` with `code`, `registry` (the name) and,
where there is one, `id`. Switch on `code`, never on the message.

## Two kinds of registry

| Kind | Created with | Filled | Frozen | Examples |
|---|---|---|---|---|
| Static (module-level) | `defineRegistry(...)` at module scope | At import time, by the registry's **manifest** | `RegistryFreezeService` on application bootstrap | permissions, settings namespaces, notification events, storage prefixes, metric groups, user-owned models |
| Instance (DI-held) | `new Registry(...)` inside an `@Injectable()` | In each provider's `onModuleInit` (`register(this)`) | By its owner in `onApplicationBootstrap` (optional) | doctor checks (`doctor/doctor-check.registry.ts`), notification channel senders |

Use a **static** registry when the list must be readable outside Nest or at
import time: `prisma/seed.ts` runs under `ts-node --transpile-only` with no
container, `storage/purge/storage-purge.main.ts` is a standalone entry point,
and a `createZodDto(z.enum(...))` DTO is built while its module is evaluated
(`npm run openapi:dump` reads it in preview mode, where no provider is
instantiated and no hook runs).

Use an **instance** registry when the entries are providers themselves
(something with injected dependencies, like a doctor check).

⚠ Never fill a static registry from `onModuleInit`. Integration specs create
several Nest applications in one Jest worker, sharing one module graph: the
first application freezes the registry, and the second one's `onModuleInit`
would hit `FROZEN`.

## Recipe: a static registry

The convention every registry story follows. The example is a permissions
registry; names are illustrative.

### 1. Define the registry with its domain

```typescript
// apps/api/src/common/permissions/permission.registry.ts
import { defineRegistry } from '../registry';

export interface PermissionDefinition {
  readonly id: string;          // 'jobs:read'
  readonly description: string;
}

/** Apps add their permission ids here by module augmentation (step 6). */
export interface AppPermissionIds {}

export const permissionRegistry = defineRegistry<PermissionDefinition>({
  name: 'permissions',
  idOf: (p) => p.id,
  idPattern: /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/,
  validate: (p) => {
    if (!p.description) throw new Error('description is required');
  },
});
```

### 2. Declare entries next to the owning module

A declaration file is pure data. It imports nothing but types and has no side
effect on import (the codebase rejects "a channel added by an import side
effect", see `notifications/notifications.module.ts` and
`jobs/job-handler.registry.ts`).

```typescript
// apps/api/src/jobs/jobs.permissions.ts
import type { PermissionDefinition } from '../common/permissions/permission.registry';

export const JOBS_PERMISSIONS = [
  { id: 'jobs:read', description: 'View background jobs' },
  { id: 'jobs:write', description: 'Retry and cancel background jobs' },
] as const satisfies readonly PermissionDefinition[];
```

### 3. Write one manifest per registry

The manifest is the explicit, grep-able list. It imports every platform
declaration, then the app-owned file, and calls `registerAll` once for each,
platform first. Adding a platform entry is one appended import and one
appended line.

```typescript
// apps/api/src/common/permissions/permission.manifest.ts
import { APP_PERMISSIONS } from '../../app-registrations/permissions';
import { JOBS_PERMISSIONS } from '../../jobs/jobs.permissions';
import { NODES_PERMISSIONS } from '../../nodes/nodes.permissions';
import { permissionRegistry } from './permission.registry';

permissionRegistry.registerAll(JOBS_PERMISSIONS);
permissionRegistry.registerAll(NODES_PERMISSIONS);

// App-owned entries last, so a collision with a platform entry names the app.
permissionRegistry.registerAll(APP_PERMISSIONS);
```

### 4. Import the manifest from the registry's `index.ts`

Any consumer that can see the registry then sees it filled.

```typescript
// apps/api/src/common/permissions/index.ts
import './permission.manifest';

export { permissionRegistry } from './permission.registry';
export type { AppPermissionIds, PermissionDefinition } from './permission.registry';
```

Consumers import from the folder (`'../common/permissions'`), never from
`permission.registry.ts` directly.

### 5. Create the app-owned file

```typescript
// apps/api/src/app-registrations/permissions.ts
import type { PermissionDefinition } from '../common/permissions/permission.registry';

/** This app's own permissions. Upstream keeps this array empty forever. */
export const APP_PERMISSIONS: readonly PermissionDefinition[] = [];
```

A fork adds its entries to that array and never edits a platform declaration
or manifest. See [app-registrations/README.md](../../app-registrations/README.md).

### 6. Let apps extend the types by module augmentation

When a type must know the app's ids (a typed `PermissionId`, say), export an
empty interface next to the registry and let the app augment it, per the
spec's guardrail "Typed through generics or module augmentation":

```typescript
// apps/api/src/app-registrations/permissions.ts (in a fork)
declare module '../common/permissions/permission.registry' {
  interface AppPermissionIds {
    'workouts:read': true;
  }
}
```

## Recipe: an instance registry

Hold a private `Registry` inside the injectable that owns the list, and keep
the owner's own public methods. `doctor/doctor-check.registry.ts` is the
reference:

```typescript
@Injectable()
export class WidgetRegistry implements OnApplicationBootstrap {
  private readonly widgets = new Registry<Widget>({ name: 'widgets', idOf: (w) => w.id });

  register(widget: Widget): void {
    this.widgets.register(widget);
  }

  list(): Widget[] {
    return this.widgets.list();
  }

  /** Every contributor's onModuleInit has run; a later register() is a wiring mistake. */
  onApplicationBootstrap(): void {
    this.widgets.freeze();
  }
}
```

Each contributor injects the owner and calls `this.registry.register(this)`
from its own `onModuleInit`. Do not pass the instance to `defineRegistry`:
the catalogue is for module-level registries only, and one Jest worker builds
many instances.

## Testing with a registry

Static registries are frozen once any test application has bootstrapped, and
the module graph is shared by every test in a file. Add a temporary entry with
`withTemporaryEntries`, which unfreezes, registers, runs the callback and
restores the previous entries and frozen state even if the callback throws:

```typescript
import { withTemporaryEntries } from '../common/registry';

it('accepts an app permission', async () => {
  await withTemporaryEntries(permissionRegistry, [{ id: 'test:read', description: 'x' }], async () => {
    expect(permissionRegistry.has('test:read')).toBe(true);
  });
});
```

It throws unless `JEST_WORKER_ID` or `VITEST` is set, so no production path
can unfreeze a registry.

## Rejected alternatives

- **Nest `DiscoveryService` with a decorator.** Invisible registration and a
  third mechanism to learn (see the headers of `jobs/job-handler.registry.ts`
  and `notifications/notifications.module.ts`), and static registries must
  work outside Nest.
- **One hand-written `Map` wrapper per registry.** Six subtly different
  duplicate and ordering rules would break the spec's promise that registry
  behaviour is stable and documented.
- **Freezing from `main.ts`.** Integration specs bootstrap through
  `Test.createTestingModule({ imports: [AppModule] })` and would never
  exercise it.

`jobs/job-handler.registry.ts` keeps its own replace-with-warning semantics
for now; it moves onto the primitive with the jobs slice.
