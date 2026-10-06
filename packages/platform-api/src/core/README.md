# @marinoscar/platform-api/core

`@marinoscar/platform-api/core`: framework-free primitives every other slice of `@marinoscar/platform-api` builds on. So far it holds one thing, the typed **registry primitive** (issue #675, moved here by #694). Principal and scope, errors and crypto join in #698.

## Purpose and scope

Closed lists (permissions, settings namespaces, doctor checks, conformance suites) become **registries with string ids**: additive, typed, ordered, validated and frozen once the application has bootstrapped. One primitive gives all of them the same rules, so an app extends the platform by registering an entry, never by editing a platform file.

Does: id validation, a duplicate policy (`throw` or `replace` in place), atomic `registerAll`, deterministic order, freeze, introspection, typed `RegistryError` codes, a test helper (`withTemporaryEntries`).
Does not: know any domain (permissions, jobs, settings), touch Nest at import time, or discover entries by itself (the app imports its manifest).

## Install and peer dependencies

```bash
npm install @marinoscar/platform-api
```

Peers are those of the package ([README](../../README.md#peer-dependencies)). Only `RegistryFreezeService` needs `@nestjs/common`; the rest of the slice imports nothing at all (a test enforces it).

## Quick start

```ts
import { defineRegistry } from '@marinoscar/platform-api/core';

export const colours = defineRegistry<{ id: string; hex: string }>({
  name: 'colours',
  idOf: (c) => c.id,
});

colours.register({ id: 'brand', hex: '#3366ff' });
colours.require('brand').hex; // '#3366ff'
```

Provide `RegistryFreezeService` in a module of the app (the base does it in `CommonModule`) so every `defineRegistry` registry freezes on application bootstrap.

## Configuration

There is no `forRoot()`. A registry is configured by `RegistryOptions<T>`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Unique among `defineRegistry` registries; appears in errors and logs. |
| `idOf` | `(entry: T) => string` | required | The entry's id. |
| `idPattern` | `RegExp` | `DEFAULT_REGISTRY_ID_PATTERN` | What a valid id looks like. |
| `onDuplicate` | `'throw' \| 'replace'` | `'throw'` | What a repeated id does; `'replace'` keeps the old position. |
| `validate` | `(entry: T) => void` | none | Throw to refuse an entry (`INVALID_ENTRY`). |
| `describeDuplicate` | `(existing, incoming) => string` | none | Extra text for the `DUPLICATE_ID` message. |
| `order` | `'registration' \| 'id' \| comparator` | `'registration'` | The order of `list()` and `ids()`. |

The full option reference, with TSDoc, is on `RegistryOptions`.

## Extension-point catalog

Two symbols are extension points; the other exports are the types, errors and constants that go with them (listed below the table). The full recipe (declaring entries, writing a manifest, instance versus static registries) is [the app's registry README](../../../../apps/api/src/common/registry/README.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `defineRegistry` | registry | `defineRegistry<T>(options: RegistryOptions<T>): Registry<T>` | Declare a module-level registry that `RegistryFreezeService` freezes on bootstrap (permissions, settings namespaces, suites) | stable | [example](../../../../apps/api/src/common/permissions/permission.registry.ts) |
| `Registry` | registry | `new Registry<T>(options: RegistryOptions<T>)` | Hold an instance registry inside a provider, frozen by its owner | stable | [example](../../../../apps/api/src/doctor/doctor-check.registry.ts) |

Supporting exports, all `@stability stable`:

| Export | Kind | Use it to |
|---|---|---|
| `listDefinedRegistries()`, `freezeDefinedRegistries()` | functions | Introspect every `defineRegistry` registry; freeze them all (idempotent). |
| `RegistryFreezeService` | Nest provider | Freeze on `onApplicationBootstrap`; provide it in a module of the app. |
| `RegistryError`, `RegistryErrorCode` | error | Switch on `code`: `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID`, `FROZEN`, `UNKNOWN_ID`, `DUPLICATE_REGISTRY`. |
| `RegistryOptions`, `RegistrySnapshot` | types | Configure and introspect. |
| `DEFAULT_REGISTRY_ID_PATTERN`, `REGISTRY_ID_MAX_LENGTH` | constants | Reuse the id rules in a schema or message. |
| `withTemporaryEntries(registry, entries, fn)` | function (tests only) | Add entries for one test and restore the registry exactly; refused outside Jest and Vitest. |

## Data

None. No models, migrations or seeds.

## Permissions and settings

None declared. The permission and settings registries are built on this primitive by the app (and by later slices).

## UI

None.

## Infra

None. No environment variables.

## Observability

`RegistryFreezeService` logs one `debug` line on bootstrap: how many static registries it froze, with each name and size. Nothing else logs.

## Security notes

A frozen registry refuses writes with `FROZEN`, which is what stops a late registration from changing a permission or settings list after something has read it. `withTemporaryEntries` throws unless `JEST_WORKER_ID` or `VITEST` is set, so no production path can unfreeze a registry.

## Conformance suite

None of its own: the primitive is pinned by `test/core/registry.spec.ts` in the package. Apps run the platform conformance suites from the [`testing` slice](../testing/README.md).

## Upgrade notes

None (first release).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `FROZEN` on `register()` | The application already bootstrapped. Register from a module-scope manifest imported before bootstrap, not from a request or a later hook. |
| `DUPLICATE_REGISTRY` at import | Two `defineRegistry` calls share a `name`, or a module was loaded twice (two copies of the package). |
| `DUPLICATE_ID` | The id is already registered. Use `onDuplicate: 'replace'` only where replacing is the documented behaviour. |
| A registry that never freezes | `RegistryFreezeService` is not provided in any module of the app. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "The Extension Contract" (rung 2, registries).
- Recipe and behaviour rules: [common/registry/README.md](../../../../apps/api/src/common/registry/README.md).
- Package README: [platform-api](../../README.md).
