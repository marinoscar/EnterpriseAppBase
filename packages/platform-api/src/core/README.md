# @marinoscar/platform-api/core

`@marinoscar/platform-api/core`: framework-free primitives every other slice of `@marinoscar/platform-api` builds on. So far it holds one thing, the typed **registry primitive** (issue #675, moved here by #694). Principal and scope, errors and crypto join in #698.

It also holds the **host ports** (issue #696): how any packaged slice reaches app-owned capabilities (authentication and authorization, audit, system settings, the Prisma client) without importing app code. The Doctor is the first slice to use them; every later slice reuses them unchanged. See [Host ports](#host-ports) below.

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

### Host ports

A packaged slice never imports the app. What it needs from the app comes through two kinds of port, both defined here and bound once by the app in `apps/api/src/platform/` (the single place the app is bound to the platform):

| Port | Kind | What it is for | How the reference app binds it |
|---|---|---|---|
| `PlatformHost.access` | decorator-time (`definePlatformHost`) | Authenticate the caller and require permissions on a packaged route. `requirePermissions(perms)` and `requireAuthenticated()` each return one decorator; never a no-op. | [`platform-host.ts`](../../../../apps/api/src/platform/platform-host.ts): both return the app's own `@Auth()` (guards, RBAC metadata, `x-rbac` OpenAPI extension) |
| `AUDIT_SINK` | DI token (`AuditSink`) | Record an audit event, after the triggering write commits, never with secret material | [`audit-sink.adapter.ts`](../../../../apps/api/src/platform/audit-sink.adapter.ts): `prisma.auditEvent.create` with the app's columns |
| `SYSTEM_SETTINGS_STORE` | DI token (`SystemSettingsStore`) | Read or patch one settings namespace with `If-Match` versioning | [`system-settings-store.adapter.ts`](../../../../apps/api/src/platform/system-settings-store.adapter.ts): `getSettings()` / `patchSettings()`, so validation, the 409 and the settings audit trail stay in the app |
| `PLATFORM_PRISMA` | DI token (`PrismaClientLike`) | Raw queries and transactions on the app's client; a slice with models narrows it with its own delegate types | [`platform-host.module.ts`](../../../../apps/api/src/platform/platform-host.module.ts): `useExisting: PrismaService` |

Access is a **static** port because Nest applies decorators when a class is defined, before any container exists; the other three are injection tokens (`Symbol.for` keys, so two bundles agree on identity). `PlatformHostModule.forRoot({ audit?, settings?, prisma?, imports? })` is global; every port is optional, and a slice that injects one the app did not bind fails at boot with Nest's missing-provider error naming the token. `definePlatformHost` validates and freezes the host: it throws when either access function is missing or returns a non-decorator, and `requirePermissions([])` throws, so a packaged route is never public by accident.

The app binds them once:

```ts
// apps/api/src/platform/platform-host.ts
export const platformHost = definePlatformHost({
  access: {
    requirePermissions: (permissions) => Auth({ permissions: [...permissions] as PermissionName[] }),
    requireAuthenticated: () => Auth(),
  },
});

// apps/api/src/platform/platform-host.module.ts (imported once in AppModule)
export const platformHostModule = PlatformHostModule.forRoot({
  audit: { useClass: PrismaAuditSink },
  settings: { useClass: SystemSettingsStoreAdapter },
  prisma: { useExisting: PrismaService },
  imports: [SettingsModule],
});
```

A slice's `forRoot` takes `{ host: PlatformHost, ... }` for decorator-time access and injects the DI ports by token. The Doctor (`@marinoscar/platform-api/doctor`) uses only `host.access`.

### The controller-factory recipe

Every packaged controller is created **inside its module's `forRoot()`**, with the host's access decorators, so the package owns the route, the OpenAPI text and the handler while the app owns the policy:

```ts
export function createWidgetController(options: ResolvedWidgetOptions): Type<unknown> {
  const requireAccess = options.host.access.requirePermissions([options.permission]);

  @ApiTags('Widgets')
  @Controller(options.path)
  class WidgetController {
    constructor(@Inject(WidgetService) private readonly widgets: WidgetService) {}

    @Get()
    @requireAccess
    list() { return this.widgets.list(); }
  }
  return WidgetController;
}
// forRoot(options) => ({ module: WidgetModule, controllers: [createWidgetController(resolved)], ... })
```

Rules: name the class as the app's controller was named and keep decorator order, so the app's OpenAPI `operationId` and document do not change; inject with an explicit `@Inject(Token)` (no reliance on the metadata of a class declared in a closure); throw from `forRoot` when `host` is missing. The Doctor's [`doctor.controller.factory.ts`](../doctor/doctor.controller.factory.ts) is the reference.

### Logging, metrics and spans

No port. Packaged code logs with `new Logger(Context)` from `@nestjs/common`, which the app routes to its pino logger through `app.useLogger` (`apps/api/src/common/logger/`). Metrics and spans use `@opentelemetry/api` (a peer) until `otel-core` (#700) ships.

### Test doubles

`@marinoscar/platform-api/testing` exports `createTestPlatformHost()` (access decorators that read an `x-test-permissions` header: no header is 401, a missing permission 403; **for package tests only, never for apps**), `InMemoryAuditSink` and `InMemorySystemSettingsStore` (one document version, 409 on a stale `ifMatchVersion`).

## Extension-point catalog

Seven symbols are extension points; the other exports are the types, errors and constants that go with them (listed below the table). The full recipe (declaring entries, writing a manifest, instance versus static registries) is [the app's registry README](../../../../apps/api/src/common/registry/README.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `defineRegistry` | registry | `defineRegistry<T>(options: RegistryOptions<T>): Registry<T>` | Declare a module-level registry that `RegistryFreezeService` freezes on bootstrap (permissions, settings namespaces, suites) | stable | [example](../../../../apps/api/src/common/permissions/permission.registry.ts) |
| `Registry` | registry | `new Registry<T>(options: RegistryOptions<T>)` | Hold an instance registry inside a provider, frozen by its owner (the packaged `DoctorCheckRegistry` is one; the reference app's own use is the storage key-prefix registry) | stable | [example](../../../../apps/api/src/storage/storage-key-prefix.registry.ts) |
| `definePlatformHost` | option | `definePlatformHost(host: PlatformHost): PlatformHost` | Bind the app's access decorators once, for every packaged controller | experimental | [example](../../../../apps/api/src/platform/platform-host.ts) |
| `PlatformHostModule.forRoot` | option | `forRoot(ports: { audit?; settings?; prisma?; imports? }): DynamicModule` | Bind the DI-time ports to the app's adapters, once, in the root module | experimental | [example](../../../../apps/api/src/platform/platform-host.module.ts) |
| `AUDIT_SINK` | token | `unique symbol` -> `AuditSink` | Record an audit event from a packaged slice | experimental | [example](../../../../apps/api/src/platform/audit-sink.adapter.ts) |
| `SYSTEM_SETTINGS_STORE` | token | `unique symbol` -> `SystemSettingsStore` | Read or patch a settings namespace from a packaged slice | experimental | [example](../../../../apps/api/src/platform/system-settings-store.adapter.ts) |
| `PLATFORM_PRISMA` | token | `unique symbol` -> `PrismaClientLike` | Reach the app's Prisma client from a packaged slice | experimental | [example](../../../../apps/api/src/platform/platform-host.module.ts) |

Supporting exports, all `@stability stable`:

| Export | Kind | Use it to |
|---|---|---|
| `listDefinedRegistries()`, `freezeDefinedRegistries()` | functions | Introspect every `defineRegistry` registry; freeze them all (idempotent). |
| `RegistryFreezeService` | Nest provider | Freeze on `onApplicationBootstrap`; provide it in a module of the app. |
| `RegistryError`, `RegistryErrorCode` | error | Switch on `code`: `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID`, `FROZEN`, `UNKNOWN_ID`, `DUPLICATE_REGISTRY`. |
| `RegistryOptions`, `RegistrySnapshot` | types | Configure and introspect. |
| `DEFAULT_REGISTRY_ID_PATTERN`, `REGISTRY_ID_MAX_LENGTH` | constants | Reuse the id rules in a schema or message. |
| `withTemporaryEntries(registry, entries, fn)` | function (tests only) | Add entries for one test and restore the registry exactly; refused outside Jest and Vitest. |

Host-port types, all `@stability experimental` (#696): `PlatformHost`, `PlatformAccessPort`, `AuditSink`, `AuditEventInput`, `SystemSettingsStore`, `SystemSettingsSnapshot`, `PrismaClientLike`, `PortBinding<T>`, `PlatformHostPorts`.

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

The host's access port fails closed: `definePlatformHost` refuses missing or non-decorator access functions and an empty permission list, and every packaged `forRoot` refuses a missing `host`, so a packaged route is never public. The audit port never receives secret material (`meta` is scalars only), and the settings port patches only through the app's own validated, versioned, audited path. `createTestPlatformHost` trusts a request header and is for package tests only.

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
| `Nest can't resolve dependencies ... Symbol(@marinoscar/platform/AUDIT_SINK)` (or another port) | A slice injects a port the app did not bind. Add it to `PlatformHostModule.forRoot({...})` in `apps/api/src/platform/platform-host.module.ts`. |
| `definePlatformHost: ... never public` at import | The host's `access` functions are missing or return something that is not a decorator. |
| A packaged route's `operationId` changed | The controller class or handler was renamed, or decorators were reordered; see the controller-factory recipe. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "The Extension Contract" (rung 2, registries).
- Recipe and behaviour rules: [common/registry/README.md](../../../../apps/api/src/common/registry/README.md).
- Package README: [platform-api](../../README.md).
