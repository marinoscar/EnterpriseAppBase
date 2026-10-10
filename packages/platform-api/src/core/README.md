# @marinoscar/platform-api/core

`@marinoscar/platform-api/core`: the bottom of the slice graph. Code only, no tables: the typed **registry primitive**, the org-aware **principal and scope contract**, the application-wide **exception filter** with its exceptions and error DTO, the **secret cipher** under every runtime-configured credential with its bootstrap check, the **OpenAPI tag registry**, the **role and permission registries** (issue #866), **scoped data access** (the user-owned data registry, `forUser()` and `asSystem()`, issue #699), the **pluggable-kind primitive** (PP-14.5, issue #923: one registry of implementations per kind, each with its own settings, secrets and generated-form descriptor), and the **host ports** (issue #696) through which a packaged slice reaches app-owned capabilities without importing app code. Every other slice imports it; it imports no other slice (`packages/platform-slices.json`: `"core": []`).

## Purpose and scope

Each primitive used to live in the app (`apps/api/src/common/`) and every fork carried its own copy. Moved here by issue #698 (the registry by #694) with no behaviour change; the reference app imports them from this subpath and has no local copies (`apps/api/test/platform/no-local-core-copies.spec.ts` fails if one comes back).

| Part | Source | What it is |
|---|---|---|
| Registry | `registry/` | Closed lists (permissions, settings namespaces, doctor checks, conformance suites, OpenAPI tags) become registries with string ids: additive, typed, ordered, validated and frozen once the application has bootstrapped. Recipe: [registry/README.md](./registry/README.md). |
| Roles and permissions | `permissions/` | The static `roleRegistry` and `permissionRegistry` every slice declares into (`RoleDeclaration`, `PermissionDeclaration`, each with a `scope` of `system` or `org` and default grants), `registerRoles` / `registerPermissions`, `permissionIds` / `roleIds`, and the seed catalog built from them (`buildPermissionCatalog`, the detached `composePermissionCatalog`, `catalogGrants`). Framework-free. Moved from the reference app's `common/permissions/` by #866 (origin #676). The platform's own declarations, in seed order, are [`@marinoscar/platform-api/manifest`](../manifest/README.md). See [Roles and permissions](#roles-and-permissions). |
| Principal and scope | `principal/` | Types only (ADR 0001): who is calling (`Principal`), the data boundary one operation runs in (`Scope`), and the named escape from scoping (`SystemActor`). No runtime code. |
| Errors | `errors/` | `HttpExceptionFilter`, which turns every thrown value into the one error envelope, the `ErrorDto` that documents that envelope in OpenAPI, the verbatim-body opt-out for externally specified bodies, and `DatabaseSeedException`. |
| Crypto | `crypto/` | AES-256-GCM with a per-purpose sub-key (HMAC-SHA256 over a fixed, versioned label), the owner-bound domain builder for per-user secrets, and `verifyEncryptionKeyAtStartup`. |
| Pluggable kinds | `pluggable/`, `testing/` | `definePluggableKind`: one registry of implementations per kind (AI providers, storage drivers, email transports...), each with its own zod settings schema, defaults and declared secrets; the write/read rules for a settings record keyed by implementation id; `describeConfigFields` and the `PluggableDescriptor` a generated form renders; and `describePluggableKindConformance`, the kit every kind runs. Framework-free. See [Pluggable kinds](#pluggable-kinds). |
| Host ports | `host/` | `definePlatformHost` (decorator-time access), the `AUDIT_SINK`, `SYSTEM_SETTINGS_STORE` and `PLATFORM_PRISMA` tokens and `PlatformHostModule`, which binds them once in the app (`apps/api/src/platform/`). See [Host ports](#host-ports). |
| Scoped data access | `data-access/` | The user-owned data registry (every model with a foreign key to `User`, with its role, purge and export policy), the user-scoped Prisma client extension (`forUser`, `userScopeExtension`) and the explicit unscoped escape (`asSystem`). Schema-independent: model names are strings and the app passes its own client in. See [Scoped data access](#scoped-data-access). Moved from the app by #699 (origin #688). |
| OpenAPI tags | `openapi/` | `openApiTags`: every `@ApiTags` name with its description and sidebar group, registered by the app and by slices; the app's document builder publishes `tags` and `x-tagGroups` from it. Also `@ApiDataResponse`, which documents a response inside the `{ data: … }` envelope (flat or nested pagination, arrays, `oneOf` unions); moved from the app by #727 so packaged controllers document it the same way. |
| Maintenance exemption | `maintenance/` | `@AllowDuringMaintenance()` and its metadata key `ALLOW_DURING_MAINTENANCE_KEY`: the routes the app's `MaintenanceGuard` still serves during a maintenance window (sign-in, refresh, device activation). Moved from the app by #727 so the identity slice's sign-in routes can carry it; the key string is unchanged. |

Does: hold primitives with no domain and no tables. Does not: own tables, import a generated Prisma client or model types (scoped data access imports only the schema-independent `@prisma/client/extension` and receives the app's client at call time), read settings, or register anything with Nest by itself (there is no `CoreModule`: the app provides `RegistryFreezeService` and registers `HttpExceptionFilter` itself). Organisation scoping and row-level security (`forOrg`, `runInOrg`, the bypass shapes and the model ownership registry, #725) are part of scoped data access; the HTTP response envelope (`TransformInterceptor`), request-id middleware and the OpenAPI document passes stay in the app until their own slice.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { HttpExceptionFilter, defineRegistry, encryptSecret } from '@marinoscar/platform-api/core';
```

Peers are those of the package ([README](../../README.md#install-and-peer-dependencies)). Within the slice: `registry/`, `permissions/`, `principal/`, `openapi/` and `crypto/secret-cipher.ts` import nothing outside Node built-ins; `RegistryFreezeService`, the host ports, the errors and the startup check need `@nestjs/common`, `ErrorDto` needs `@nestjs/swagger`, `HttpExceptionFilter` needs `nestjs-zod` (it names the failing fields of a `ZodValidationException`), and `data-access/` needs `@prisma/client` (its `@prisma/client/extension` entry only, which does not depend on a generated client) and `@opentelemetry/api` (the `asSystem` span attributes). `pluggable/` and `testing/` import `zod` and `@marinoscar/platform-contract/settings` (the descriptor and id-pattern wire shapes), and nothing else. `test/core/core-imports.spec.ts` pins that set (no `from '@prisma/client'`, `@prisma/client/extension` only from `data-access/`, no other slice).

## Quick start

The reference app wires the slice in three places.

```ts
// apps/api/src/app.module.ts: the one exception filter
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from '@marinoscar/platform-api/core';

@Module({ providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }] })
export class AppModule {}
```

```ts
// apps/api/src/common/common.module.ts: freeze every registry on bootstrap
import { RegistryFreezeService } from '@marinoscar/platform-api/core';

@Module({ providers: [RegistryFreezeService] })
export class CommonModule {}
```

```ts
// apps/api/src/main.ts: validate SECRETS_ENCRYPTION_KEY before the port is bound
import { verifyEncryptionKeyAtStartup } from '@marinoscar/platform-api/core';

await verifyEncryptionKeyAtStartup(() => app.get(PrismaService).credential.count(), logger);
```

A packaged slice's routes and ports are bound through the host (see [Host ports](#host-ports)). A credential store then encrypts with a purpose of its own:

```ts
import { decryptSecret, encryptSecret } from '@marinoscar/platform-api/core';

const stored = encryptSecret(password, 'smtp'); // apps/api/src/credentials/credentials.service.ts
const password = decryptSecret(stored, 'smtp');
```

Scoped data access: the app fills the registry once, then scopes a client per call (see [Scoped data access](#scoped-data-access)):

```ts
// apps/api/src/prisma/ownership/user-owned-model.manifest.ts
registerUserOwnedModels(PLATFORM_USER_OWNED_MODELS);
registerUserOwnedModels(APP_USER_OWNED_MODELS);

// apps/api/src/prisma/prisma.service.ts: a typed helper, so call sites keep the generated model types
forUser(scope: Scope) {
  return this.$extends(userScopeExtension(scope));
}
```

## Configuration

There is no `forRoot()`. Two things are configured:

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `SECRETS_ENCRYPTION_KEY` (environment) | base64 of 32 bytes | unset | The cipher's master key. A deployment secret, not a runtime setting: read from `process.env` by the cipher only (never through `ConfigService`), once, then cached. Generate with `openssl rand -base64 32`. Unset: the startup check warns and boots while nothing is stored, and refuses to boot once encrypted secrets exist. |
| `RegistryOptions<T>` | object | see below | How one registry behaves. |

`RegistryOptions<T>`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Unique among `defineRegistry` registries; appears in errors and logs. |
| `idOf` | `(entry: T) => string` | required | The entry's id. |
| `idPattern` | `RegExp` | `DEFAULT_REGISTRY_ID_PATTERN` | What a valid id looks like. |
| `onDuplicate` | `'throw' \| 'replace'` | `'throw'` | What a repeated id does; `'replace'` keeps the old position. |
| `validate` | `(entry: T) => void` | none | Throw to refuse an entry (`INVALID_ENTRY`). |
| `describeDuplicate` | `(existing, incoming) => string` | none | Extra text for the `DUPLICATE_ID` message. |
| `order` | `'registration' \| 'id' \| comparator` | `'registration'` | The order of `list()` and `ids()`. |

`HttpExceptionFilter` reads `NODE_ENV` only to leave a non-HTTP error's stack out of the response body in `production`.

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

### Roles and permissions

A slice or an app declares each role and permission once, as data typed with `RoleDeclaration` / `PermissionDeclaration` (a map keyed by the constant name, so `permissionIds(map)` keeps literal ids), beside the module that enforces it. Nothing registers at import: one manifest per app fills the two static registries, in this order, which is the catalog's and the seed's order:

1. platform roles, 2. app roles, 3. platform permissions, 4. app permissions.

`registerPlatformPermissions({ appRoles, appPermissions })` of [`@marinoscar/platform-api/manifest`](../manifest/README.md) does all four. The rules every entry must satisfy (a refusal is a `RegistryError` naming the registry, `roles` or `permissions`, and the id):

| Rule | Detail |
|---|---|
| Ids | A permission id is `<resource>:<action>` (`/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/`); a role id `/^[a-z][a-z0-9_-]*$/`. Otherwise `INVALID_ID`. |
| Description | Required and non-blank. Otherwise `INVALID_ENTRY`. |
| Scope | `'system'` or `'org'`, no default. Otherwise `INVALID_ENTRY`. |
| Grants | Every `defaultGrants` id is a role registered **earlier**, of the permission's own scope, at most once. Otherwise `INVALID_ENTRY`. `[]` is allowed. |
| Duplicates | An id registered twice (an app id equal to a platform id included) is `DUPLICATE_ID`. |

`buildPermissionCatalog()` reads the registries into `{ roles, permissions, rolePermissions }`, the shape `platformSeedInputFrom()` of `@marinoscar/platform-db/seed` takes. `composePermissionCatalog({ roles, permissions })` builds the same catalog from batches of declarations on detached registries (same validation, static registries untouched), for a seed that imports its packages directly. `catalogGrants(catalog)` turns the grants into the `{ role, permission }` pairs the identity conformance suite takes.

### Scoped data access

Five parts, all `@stability experimental`: the user-owned registry, `forUser`, `asSystem`, and (since #725) organisation scoping with row-level security and the model ownership registry.

**The registry.** `userOwnedModelRegistry` is a static `defineRegistry` registry (frozen on bootstrap with the others) holding one `UserOwnedModelDef` per model with a foreign key to `User`. An app registers its models once, from a manifest imported before bootstrap, with `registerUserOwnedModels(defs)`; a packaged slice registers its own models when it is extracted. The `userOwnedData` conformance suite ([testing](../testing/README.md#conformance-suite)) fails when a `User` relation has no entry or an entry contradicts the schema.

| Field | Required | Meaning |
|---|---|---|
| `model` | yes | The Prisma model name. `UserOwnedModelDef<Prisma.ModelName>` narrows it to the app's generated names, so a typo fails to compile. One entry per model. |
| `ownerField` | one of the two | The scalar foreign key naming the row's owner (`userId`, `uploadedById`). A scoped client may read and write the model. |
| `actorFields` | one of the two | Scalar foreign keys that record who acted (`actorUserId`). A scoped client refuses an actor-only model. |
| `ownerRelation` | no | The relation behind `ownerField`, for `{ connect: { id } }` creates; defaults to the owner field without `Id`. |
| `purge` | yes | `'delete'` (the row goes with the user; `onDelete: Cascade`), `'detach'` (the row stays, the reference is nulled; `SetNull`), `'retain'` (actor-only rows another owner controls; `Restrict`/`NoAction`). Applies to the owner field, or to every actor field when there is none. |
| `export` | yes | `'include'` or `'exclude'`: whether the user's data export carries the row. `exportOmit` lists columns never exported (ciphertexts, hashes). |
| `rationale` | yes | One or two sentences, for reviewers. |

Purge and export are declarations today; the user-data reset and the export framework (#743, #744) will read them instead of a hand-written table list.

**`forUser` / `userScopeExtension`.** Use for every query made on behalf of one user. `userScopeExtension(scope)` is a `Prisma.defineExtension` extension; `forUser(client, scope)` applies it to any client with `$extends` (the app's `PrismaClient`, or the `PLATFORM_PRISMA` port's `PrismaClientLike`). An app that wants its generated model types back calls `this.$extends(userScopeExtension(scope))` on its own client (the reference app's `PrismaService.forUser`). For owner field `O` and user `U`:

| Operation | What the client does |
|---|---|
| `findFirst(OrThrow)`, `findMany`, `count`, `aggregate`, `groupBy`, `updateMany(AndReturn)`, `deleteMany` | `where` becomes `{ AND: [where, { O: U }] }` |
| `findUnique(OrThrow)`, `update`, `delete`, `upsert` | `{ O: U }` joins the unique `where`'s `AND`; another user's row is "not found" (`null` or `P2025`), never a 403 |
| `create`, `createMany(AndReturn)`, `upsert`'s `create` | `O` is set to `U` when absent; another value, or a relation connect to another user, throws `ScopedAccessError` |
| `update`, `updateMany(AndReturn)`, `upsert`'s `update` | Moving the row to another owner throws |

Everything else throws `ScopedAccessError` before reaching the database: an actor-only or unregistered model (including `User`), raw SQL (`$queryRaw`, `$executeRaw` and the `Unsafe` variants, also inside `$transaction`), and an operation it cannot scope. Interactive transactions stay scoped. Only `scope.userId` is applied here; the organisation is applied by `forOrg` below, and `groupIds` is accepted and ignored until #729. Nested writes and relation `include`/`select` are not rewritten: a nested write into another user-owned model goes through that model's own scoped call.

**`asSystem(client, actor)`.** The explicit, greppable marker for work that is not on behalf of one user: backups, purges, the Doctor, cross-user admin reads, actor-only tables, migrations. It refuses an actor without `{ kind: 'system', reason }` and a non-empty reason, sets `db.access.scope = 'system'` and `db.access.reason` on the active span, and returns the client unchanged. Never derive the reason from request input.

**Organisation scope and row-level security (#725, [ADR 0002 D5](../../../../docs/adr/0002-database-packaging-and-rls.md)).** The database enforces organisation isolation: every `org` table has a policy on `org_id` keyed on three settings that exist only inside one transaction. `RLS_SETTINGS` names them (`app.org_id`, `app.user_id`, `app.rls_bypass`). Four shapes set them, none with a session-level `SET` (a session value leaks to the next request on a pooled connection, and across a transaction-mode pooler):

| Shape | Use it for |
|---|---|
| `forOrg(client, orgId, { userId? })` / `orgScopeExtension(base, scope)` / `forScope(client, scope)` | One operation. Every operation, raw SQL included, runs as `$transaction([ set_config(…, true), operation ])` on one connection. Fails closed: another organisation's rows are invisible, an insert naming another organisation is refused by the policy's `WITH CHECK`. |
| `runInOrg(client, { orgId, userId? }, fn, options?)` / `runInScope` | A unit of work of more than one statement: one interactive transaction, `set_config` first, `fn` receives the plain transaction client. Nested use reuses the outer transaction; nesting another organisation throws. Pass `maxWait` and `timeout` when many transactions queue behind a small pool. |
| `forSystem(systemClient, reason)` / `systemScopeExtension` | One operation with `app.rls_bypass = 'on'`, on a **separate** `PrismaClient` with its own pool (the app's `PrismaSystemService`), so the tenant pool never carries the flag. |
| `runAsSystem(systemClient, reason, fn, options?)` | The interactive form of the above. |

`orgId` and `userId` must be UUIDs (`ScopedAccessError` otherwise). `SystemAccessReason` is a closed list (`backup`, `restore`, `purge`, `doctor`, `retention`, `admin-aggregate`, `migration-tooling`); each system acquisition sets `db.access.scope = 'system'` and `db.access.reason` on the active span and adds a `db.rls_bypass` event. An extended client used inside `$transaction(async tx => …)` would escape that transaction, so the extension refuses to run there: use `runInOrg` and the plain `tx` it hands out. The threat model is the ADR's: this defends against a missing or wrong scope in application code; it does not defend against SQL injection or arbitrary raw SQL (any statement on a connection may set any setting), so raw SQL stays behind the lint rule and review.

**The model ownership registry.** `modelOwnershipRegistry` (a `defineRegistry` registry, `registerModelOwnership(defs)`) classifies every Prisma model as `org` (NOT NULL `org_id`, row-level security forced), `org-optional` (nullable `org_id`, no row-level security), `user` (personal) or `system` (deployment-wide). `modelsOfKind(kind)` and `orgFieldOf(model)` read it. The reference app's `rls-coverage` database spec checks it against the catalogue: every `org` model has `relrowsecurity`, `relforcerowsecurity` and a policy named in `RLS_POLICIES`, and no unregistered table has an `org_id` column.

### Pluggable kinds

A **pluggable kind** is the one shape every slice with a swappable part shares (AI providers, storage drivers, email transports, sign-in providers, notification channels, the telemetry store, the backup target), so an extension author learns it once. `definePluggableKind<TInstance, TBuildContext>({ kind, label })` creates the kind; each **implementation** brings:

| Member | Meaning |
|---|---|
| `id`, `label`, `description?` | `id` matches `^[a-z][a-z0-9-]{1,47}$` and is permanent once settings are stored under it. |
| `settingsSchema` | A `z.object` of the **non-secret** settings. `.describe('help')` becomes the field's help text and `.meta({ label })` its label (else the field name, humanised). |
| `defaults` | The settings of a fresh install; must parse with `settingsSchema`. |
| `secrets?` | `{ name, label, required, help? }[]`: the secrets it needs. Declared, never stored in settings and never read from an environment variable. |
| `build(input)` | Makes the instance from the consuming slice's context plus `settings` (parsed) and `secret(name)` (resolves a declared secret from the credential store, `null` when none is stored). |
| `egressHosts?(settings)` | The hosts an instance calls, for the Doctor's egress contributors. |

The kind is a registry named `pluggable.<kind>` on `defineRegistry`: a duplicate id throws (`DUPLICATE_ID`), and it freezes with the others once the application has bootstrapped, so register **at import time** from `apps/api/src/app-registrations/`. A kind owns no storage: the slice that consumes it keeps the settings and the secrets.

**Settings are a record keyed by implementation id**, `{ <id>: <that implementation's settings> }`, and the kind owns the rules for it:

| Operation | Behaviour |
|---|---|
| `parseSettings(id, raw)` | Fills the implementation's defaults, validates with its schema. `undefined` and `null` count as `{}`. Throws `PluggableSettingsError` (zod `issues`) or, for an unregistered id, `PluggableUnknownError`. |
| `mergeSettingsRecord(stored, patch)` (WRITE) | Each patched id must be registered (else `PluggableUnknownError`; map it to the slice's `*_UNKNOWN_*` 400); the entry is shallow-merged over the stored one and parsed; `null` removes it. Entries the patch does not name, including ones stored for implementations that are no longer registered, are kept untouched. |
| `readSettingsRecord(stored, warn)` (READ) | An id that is no longer registered is dropped with **one** `warn` call naming all of them, so removing a plugin never bricks the settings row. An entry that no longer parses falls back to its defaults with a warning. Reading never throws on stored data. |

**Descriptors.** `describe(id, { secrets })` and `describeAll(id => ({ secrets }))` return the `PluggableDescriptor` of `@marinoscar/platform-contract/settings`: `{ kind, id, label, description?, fields }`, where `fields` is the settings in declaration order (`describeConfigFields`: `boolean`, `enum`, `number`, `string`, or `other` for what a form cannot render) followed by one write-only `secret` field per declared secret, carrying `hasValue` and `required` and **never** a value. The consuming slice computes `secrets: { apiKey: true }` from its credential store (`CredentialsService`, `OrgCredentialsService`...) and serves the descriptors on its admin route; the web form (`PluggableConfigForm` of `@marinoscar/platform-web/settings/ui`) renders them. `describeConfigFields` is the generalisation of the organization settings page's field description: `describeOrgFields` is now a thin wrapper that drops `label` and `help`, so the org settings wire shape is unchanged.

```ts
// apps/api/src/platform-extensions/core/greeter.kind.ts
export const greeterKind = definePluggableKind<Greeter>({ kind: 'greeter', label: 'Greeter' });

// apps/api/src/app-registrations/core.ts: at import time
greeterKind.register({
  id: 'signed',
  label: 'Signed greeter',
  settingsSchema: z.object({ greeting: z.string().min(1).max(40), style: z.enum(['formal', 'casual']) }),
  defaults: { greeting: 'Greetings', style: 'formal' },
  secrets: [{ name: 'apiKey', label: 'Signing key', required: true }],
  async build({ settings, secret }) {
    const apiKey = await secret('apiKey'); // never from settings or env
    if (apiKey === null) throw new Error('needs its apiKey');
    return { greet: async (name) => `${settings.greeting}, ${name}. ${sign(apiKey, name)}` };
  },
});

// in the consuming slice: write, read, describe, build
record = greeterKind.mergeSettingsRecord(record, patch);          // rejects unknown ids
const settings = greeterKind.readSettingsRecord(record, logger.warn);
const descriptors = greeterKind.describeAll((id) => ({ secrets: presenceOf(id) }));
const impl = greeterKind.get(id);                                  // throws PluggableUnknownError
const greeter = await impl.build({ settings: greeterKind.parseSettings(id, settings[id]), secret });
```

**The kit.** `describePluggableKindConformance(kind, { describe, it, expect })` of `@marinoscar/platform-api/core/testing` is runner-agnostic (Jest and Vitest both work) and runs once per registered implementation: a valid id and a label; `defaults` parse with the implementation's own `settingsSchema`; `describe()` validates against `pluggableDescriptorSchema` and lists exactly the declared secrets with presence flags only; no `settingsSchema` field matches `/key|secret|token|password/i` (declare it in `secrets`; a field that is genuinely not a secret, such as an S3 `keyPrefix`, is vouched for with `{ allowSecretLikeFields: ['keyPrefix'] }`); a secret name never repeats or collides with a settings field; `build` is a function. Import the file that registers the implementations first, so they exist when the cases are declared.

Worked example, without any consumer slice: [`greeter.kind.ts`](../../../../apps/api/src/platform-extensions/core/greeter.kind.ts), registered by [`app-registrations/core.ts`](../../../../apps/api/src/app-registrations/core.ts) and exercised by [`pluggable-kind.spec.ts`](../../../../apps/api/test/examples/core/pluggable-kind.spec.ts).

### Logging, metrics and spans

No port. Packaged code logs with `new Logger(Context)` from `@nestjs/common`, which the app may route to its own logger through `app.useLogger`. Metrics and spans use `@opentelemetry/api` (a peer) until `otel-core` (#700) ships.

### Test doubles

`@marinoscar/platform-api/testing` exports `createTestPlatformHost()` (access decorators that read an `x-test-permissions` header: no header is 401, a missing permission 403; **for package tests only, never for apps**), `InMemoryAuditSink` and `InMemorySystemSettingsStore` (one document version, 409 on a stale `ifMatchVersion`).


## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Sixteen symbols are extension points; the other exports are the contracts, functions, types and constants that go with them (listed below the table).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `defineRegistry` | registry | `defineRegistry<T>(options: RegistryOptions<T>): Registry<T>` | Declare a module-level registry that `RegistryFreezeService` freezes on bootstrap (permissions, settings namespaces, suites) | stable | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `Registry` | registry | `new Registry<T>(options: RegistryOptions<T>)` | Hold an instance registry inside a provider, frozen by its owner (the packaged `DoctorCheckRegistry` is one; the storage slice's key-prefix registry is another) | stable | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `HttpExceptionFilter` | component | `@Catch() class HttpExceptionFilter implements ExceptionFilter` | Register once as the app's `APP_FILTER`, so every error leaves as the one envelope | stable | [example](../../../../apps/api/src/app.module.ts) |
| `openApiTags` | registry | `Registry<OpenApiTag>` (`{ name, description, group }`) | Register the `@ApiTags` names a slice's or the app's controllers use, with a description and a sidebar group | experimental | [example](../../../../apps/api/src/openapi/tags.ts) |
| `definePlatformHost` | option | `definePlatformHost(host: PlatformHost): PlatformHost` | Bind the app's access decorators once, for every packaged controller | experimental | [example](../../../../apps/api/src/platform/platform-host.ts) |
| `PlatformHostModule.forRoot` | option | `forRoot(ports: { audit?; settings?; prisma?; imports? }): DynamicModule` | Bind the DI-time ports to the app's adapters, once, in the root module | experimental | [example](../../../../apps/api/src/platform/platform-host.module.ts) |
| `AUDIT_SINK` | token | `unique symbol` -> `AuditSink` | Record an audit event from a packaged slice | experimental | [example](../../../../apps/api/src/platform/audit-sink.adapter.ts) |
| `SYSTEM_SETTINGS_STORE` | token | `unique symbol` -> `SystemSettingsStore` | Read or patch a settings namespace from a packaged slice | experimental | [example](../../../../apps/api/src/platform/system-settings-store.adapter.ts) |
| `PLATFORM_PRISMA` | token | `unique symbol` -> `PrismaClientLike` | Reach the app's Prisma client from a packaged slice | experimental | [example](../../../../apps/api/src/platform/platform-host.module.ts) |
| `roleRegistry` | registry | `Registry<RoleDeclaration>` | Register the deployment's roles (`registerRoles(declarations)`), platform roles first, before any permission | stable | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `permissionRegistry` | registry | `Registry<PermissionDeclaration>` | Register permissions with their scope and default grants (`registerPermissions(declarations)`), after every role; the seed catalog is built from it | stable | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `userOwnedModelRegistry` | registry | `Registry<UserOwnedModelDef>` | Register every model with a foreign key to `User`, with its role, purge and export policy (`registerUserOwnedModels(defs)`) | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |
| `modelOwnershipRegistry` | registry | `Registry<ModelOwnershipDef>` | Classify every model as `org`, `org-optional`, `user` or `system` (`registerModelOwnership(defs)`); the `org` ones get `org_id` and forced row-level security | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `definePluggableKind` | registry | `definePluggableKind<TInstance, TBuildContext = object>(options: { kind: string; label: string }): PluggableKind<TInstance, TBuildContext>`; `kind.register(impl: PluggableImplementation)` with `{ id, label, settingsSchema, defaults, secrets?, build, egressHosts? }` | Make a slice's swappable part (AI provider, storage driver, email transport...) pluggable: one registry of implementations, each with its own settings schema, defaults and declared secrets; register at import time | experimental | [example](../../../../apps/api/src/platform-extensions/core/greeter.kind.ts) |
| `describeConfigFields` | option | `describeConfigFields(schema: z.ZodObject): ConfigField[]` | Describe a zod object as form fields (`boolean`, `enum`, `number`, `string`, `other`, each with `label` and `help`) for a generated form | experimental | [example](../../../../apps/api/test/examples/core/pluggable-kind.spec.ts) |
| `describePluggableKindConformance` | hook | `describePluggableKindConformance(kind, { describe, it, expect }, options?): void` (`@marinoscar/platform-api/core/testing`) | Prove every implementation of a kind is well formed: valid id, defaults that parse, a descriptor that validates, no secret-looking setting, a build function | experimental | [example](../../../../apps/api/test/examples/core/pluggable-kind.spec.ts) |

Registry, all `@stability stable`:

| Export | Kind | Use it to |
|---|---|---|
| `listDefinedRegistries()`, `freezeDefinedRegistries()` | functions | Introspect every `defineRegistry` registry; freeze them all (idempotent). |
| `RegistryFreezeService` | Nest provider | Freeze on `onApplicationBootstrap`; provide it in a module of the app. |
| `RegistryError`, `RegistryErrorCode` | error | Switch on `code`: `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID`, `FROZEN`, `UNKNOWN_ID`, `DUPLICATE_REGISTRY`. |
| `RegistryOptions`, `RegistrySnapshot` | types | Configure and introspect. |
| `DEFAULT_REGISTRY_ID_PATTERN`, `REGISTRY_ID_MAX_LENGTH` | constants | Reuse the id rules in a schema or message. |
| `withTemporaryEntries(registry, entries, fn)` | function (tests only) | Add entries for one test and restore the registry exactly; refused outside Jest and Vitest. |

Principal and scope contract (ADR 0001), all types, all `@stability experimental` (the org fields narrow when organisations land):

| Export | Use it to |
|---|---|
| `Principal` (`UserPrincipal` \| `NodePrincipal`), `PrincipalKind` | Type who is calling; narrow on `kind`. A readonly snapshot per request; no `isActive`. |
| `CredentialKind` | `'session' \| 'device' \| 'pat' \| 'node'`: how the request authenticated. |
| `OrgMembership`, `GroupMembership` | An organisation or group the principal belongs to. |
| `Scope` | `{ userId, orgId?, groupIds? }`: the data boundary of one operation, derived from the principal, never from request input. |
| `SystemActor` | `{ kind: 'system', reason }`: the only way to run unscoped. |
| `TenancyMode` | `'single' \| 'multi'`. |

Errors, all `@stability stable`:

| Export | Kind | Use it to |
|---|---|---|
| `ErrorDto` | OpenAPI DTO | Declare the error response of an operation (`@ApiResponse({ type: ErrorDto })`). The schema name `ErrorDto` is published. |
| `withVerbatimErrorBody(exception)` | function | Send a body an external standard dictates (RFC 8628's `{ error, error_description }`) exactly as thrown, outside the envelope. |
| `hasVerbatimErrorBody(exception)` | function | Ask whether an exception carries that brand (the filter's check). |
| `DatabaseSeedException` | exception | Fail with a 500 whose `details` tells the operator to run the seed. |

Roles and permissions, all `@stability stable` (#866):

| Export | Kind | Use it to |
|---|---|---|
| `registerRoles(declarations)`, `registerPermissions(declarations)` | functions | Fill the two registries, all or nothing; an array or a map (key order). |
| `permissionIds(map)`, `roleIds(map)` | functions | A declaration map to a frozen map of its ids, keeping literal types (`PERMISSIONS`, `ROLES`). |
| `buildPermissionCatalog(source?)`, `PermissionCatalog`, `PermissionCatalogSource` | function, types | The seed catalog of the registries (or of any two lists). |
| `composePermissionCatalog(declarations)`, `PermissionCatalogDeclarations` | function, type | The seed catalog of batches of declarations, on detached registries. |
| `catalogGrants(catalog)` | function | The default grants as `{ role, permission }` pairs. |
| `RoleDeclaration`, `PermissionDeclaration`, `RoleDeclarationMap`, `PermissionDeclarationMap`, `PermissionScope`, `Declarations` | types | Type a declaration file. |

Crypto, all `@stability stable`:

| Export | Use it to |
|---|---|
| `encryptSecret(plaintext, purpose)`, `decryptSecret(payload, purpose)` | Encrypt or decrypt one secret under the sub-key for `purpose`. The payload is base64 of `[iv 12][tag 16][ciphertext]`, safe for one `text` column. |
| `userCredentialPurpose(userId, purpose)`, `USER_CREDENTIAL_DOMAIN_PREFIX` | Build the owner-bound domain `user:<userId>:<purpose>` for a per-user secret. |
| `orgCredentialPurpose(orgId, purpose)`, `ORG_CREDENTIAL_DOMAIN_PREFIX` | Build the organization-bound domain `org:<orgId>:<purpose>` for an organization's secret (#735; used by `OrgCredentialsService` in `@marinoscar/platform-api/credentials`). |
| `isCanonicalUuid(value)` | Check the lowercase hyphenated UUID spelling the owner-bound domain requires. |
| `deriveSigningKey(purpose)` | Get a 32-byte HMAC key for a signing domain (short-lived server-signed tokens such as download links), derived from the same master key under a separate label, so it can never decrypt a stored secret (#822). |
| `assertEncryptionKeyConfigured()` | Throw unless the key is present and well formed (warms the cache). |
| `verifyEncryptionKeyAtStartup(countStoredSecrets, logger)` | Run the bootstrap check (see Quick start). |

Host-port types, all `@stability experimental` (#696): `PlatformHost`, `PlatformAccessPort`, `AuditSink`, `AuditEventInput`, `SystemSettingsStore`, `SystemSettingsSnapshot`, `PrismaClientLike`, `PortBinding<T>`, `PlatformHostPorts`.

Scoped data access, all `@stability experimental` (#699; organisation scope and row-level security #725):

| Export | Kind | Use it to |
|---|---|---|
| `registerUserOwnedModels(defs)` | function | Register a batch in `userOwnedModelRegistry`, all or nothing (`INVALID_ENTRY`, `DUPLICATE_ID`, `FROZEN`). |
| `ownerFieldOf(model)`, `ownerRelationOf(def)` | functions | Look up a registered model's owner field; derive the relation behind an owner field. |
| `UserOwnedModelDef<TModel>`, `PurgePolicy`, `ExportPolicy`, `UserOwnedModelLookup` | types | Type a registration (narrow `TModel` to the app's model names); pass a fixture lookup in tests. |
| `forUser(client, scope, registry?)` | function | A client confined to `scope.userId` on registered owner models. Returns whatever the client's `$extends` returns. |
| `userScopeExtension(scope, registry?)`, `UserScopeExtension` | function, type | The extension behind `forUser`, for `this.$extends(...)` on an app's own typed client. |
| `ExtendableClient` | type | What `forUser` needs from a client: `$extends`. |
| `asSystem(client, actor)` | function | Mark deliberately unscoped work; checks the actor and tags the active span. |
| `ScopedAccessError` | error | Thrown when a scoped call would leave its scope; carries `model` and `operation`. A programming error (a 500), not an `HttpException`. |
| `forOrg(client, orgId, opts?)`, `forScope(client, scope)`, `orgScopeExtension(base, scope)` | functions | An organisation-scoped client (per operation, transaction-local `set_config`). |
| `runInOrg(client, scope, fn, options?)`, `runInScope(client, scope, fn, options?)` | functions | One interactive transaction in an organisation's scope. |
| `forSystem(client, reason)`, `systemScopeExtension(base, reason)`, `runAsSystem(client, reason, fn, options?)` | functions | The bypass shapes, for the separate system client. |
| `RLS_SETTINGS`, `SYSTEM_ACCESS_REASONS`, `SystemAccessReason` | constant, constant, type | The three transaction-local setting names; the closed list of bypass reasons. |
| `OrgScope`, `OrgScopedClient<C>`, `RlsBaseClient`, `RlsRunnableClient`, `RlsTransactionClient<C>`, `RlsTransactionOptions` | types | Type scopes, scoped clients and transaction callbacks. |
| `registerModelOwnership(defs)`, `modelsOfKind(kind)`, `orgFieldOf(model)`, `orgColumnOf(model)` | functions | Fill and read `modelOwnershipRegistry`. |
| `ModelOwnershipDef<TModel>`, `OwnershipKind` | types | Type a classification. |

Pluggable kinds, all `@stability experimental` (PP-14.5, #923):

| Export | Kind | Use it to |
|---|---|---|
| `PluggableKind<TInstance, TBuildContext>` | type | The kind `definePluggableKind` returns: `register`, `get`, `has`, `ids`, `list`, `parseSettings`, `mergeSettingsRecord`, `readSettingsRecord`, `describe`, `describeAll`. |
| `PluggableImplementation<TInstance, TBuildContext, TSettings>`, `PluggableSecretSpec`, `PluggableBuildInput`, `PluggableSecretPresence`, `DefinePluggableKindOptions` | types | Type an implementation, its declared secrets, what `build` receives and the presence flags `describe` takes. |
| `PluggableUnknownError` | error | No implementation under that id. Carries `kind`, `id` and `registeredIds`; the message names all three and says how to register one. Map it to the slice's own 400. |
| `PluggableSettingsError` | error | Settings that do not parse with the implementation's schema. Carries `kind`, `id` and the zod `issues`. |
| `describeConfigField(name, schema)` | function | Describe one field (never a `secret`). `label` comes from `.meta({ label })` or the humanised name, `help` from `.describe()`. |
| `SECRET_LIKE_FIELD_PATTERN`, `PluggableConformanceHarness`, `PluggableConformanceOptions` (`core/testing`) | constant, types | The names the kit refuses in a `settingsSchema`; type the harness and the `allowSecretLikeFields` option. |

The wire shapes (`configFieldSchema`, `pluggableDescriptorSchema`, `PLUGGABLE_ID_PATTERN`) are in [`@marinoscar/platform-contract/settings`](../../../platform-contract/src/settings/README.md).

OpenAPI tags, all `@stability experimental`:

| Export | Use it to |
|---|---|
| `openApiTagGroups(tags?)` | Group tags into `x-tagGroups` sections, in first-appearance order. |
| `OpenApiTag`, `OpenApiTagGroup` | Types of a registered tag and of an emitted group. |
| `OPENAPI_TAG_NAME_PATTERN` | What a tag or group name looks like (words, spaces, `&`). |

## Data

None. The slice owns no models, migrations or seeds; the startup check counts stored secrets through a callback the app supplies. Scoped data access reads only what the app registers in `userOwnedModelRegistry` and queries through the client the app passes in; it never imports a generated model type.

## Permissions and settings

None declared. The role and permission registries live here (see [Roles and permissions](#roles-and-permissions)) but hold nothing until an app's manifest fills them; the settings registries are built on the registry primitive by the settings slice; `SECRETS_ENCRYPTION_KEY` is an environment variable (see Configuration), not a setting.

## UI

None. The slice is API-side code only.

## Infra

`SECRETS_ENCRYPTION_KEY` must be set in the API container's environment once the deployment stores credentials (`infra/compose/.env.example` declares it). No other variable, port or service.

## Observability

- `RegistryFreezeService` logs one `debug` line on bootstrap: how many static registries it froze, with each name and size.
- `HttpExceptionFilter` logs one line per handled failure: `warn` with `METHOD url - status: message` below 500, `error` with the stack from 500 up; a verbatim body logs its `error` field, never the body.
- `verifyEncryptionKeyAtStartup` logs exactly one of: `SECRETS_ENCRYPTION_KEY is configured; encrypted credential storage is available.` (`log`), the key-absent warning, or the could-not-count warning, and otherwise throws. The texts are unchanged from the app; operators and the CI smoke job read them.
- The cipher never logs.
- `asSystem` sets `db.access.scope = 'system'` and `db.access.reason` on the active span (nothing when no span is active). The reason is never a metric label (cardinality). The reference app's `ScopedPrismaService.asSystem` also logs it at `debug`.
- A `ScopedAccessError` reaches the exception filter as a 500, logged at `error` with the model and operation in its message.

## Security notes

- **Key handling.** The cipher reads `SECRETS_ENCRYPTION_KEY` from `process.env` on first use, validates it (strict base64, exactly 32 bytes after trimming whitespace) and caches it for the life of the process. A later change to the environment has no effect until restart; the rotation runbook reloads the module on purpose (`docs/runbooks/rotate-secrets-encryption-key.md`).
- **One instance per process.** The master key and the derived sub-keys are cached at module scope. Two copies of `@marinoscar/platform-api` in one process would mean two caches (and two registry sets, and two verbatim brands that only agree because the brand uses `Symbol.for`): install exactly one copy (the platform single-instance check, issue #695, guards the package name).
- **Purposes.** Every secret is encrypted under a sub-key derived from its purpose, so a ciphertext copied into another column or another user's row fails authentication instead of decrypting. Per-user secrets use `userCredentialPurpose`, which binds the owner, and per-organization secrets `orgCredentialPurpose`, which binds the organization. Owner-bound sub-keys (user and org) are not cached.
- **Signing keys.** `deriveSigningKey(purpose)` is `HMAC-SHA256(masterKey, 'enterpriseappbase:signing-key:v1:' + purpose)`. The label differs from the encryption label, so the signing and encryption key spaces never meet. `purpose` is a code constant (signing keys are cached per purpose); never log or return the key. Rotating `SECRETS_ENCRYPTION_KEY` invalidates every outstanding signed token.
- **No key material leaves the module.** Errors carry the variable name, a byte count and the generation command; decryption failures are one flat message. Nothing in the slice logs a key, a derived key or a plaintext.
- **Byte compatibility.** The env var name, the sub-key label prefixes (encryption and signing), the IV and tag lengths, the payload layout and the error texts are fixed: changing the label makes every stored credential undecryptable. `apps/api/test/platform/secret-cipher-compat.spec.ts` decrypts ciphertexts written before the move.
- **Error bodies.** The filter rebuilds every body from a fixed key set, so a thrown exception cannot leak extra fields; a validation failure names the failing fields (`details.issues`) but never echoes the submitted value; stacks are omitted from responses in `production`.
- **Host ports.** The host's access port fails closed: `definePlatformHost` refuses missing or non-decorator access functions and an empty permission list, and every packaged `forRoot` refuses a missing `host`, so a packaged route is never public. The audit port never receives secret material (`meta` is scalars only), and the settings port patches only through the app's own validated, versioned, audited path. `createTestPlatformHost` trusts a request header and is for package tests only.
- **Pluggable kinds keep secrets out of settings.** An implementation declares its secrets; `describe` reports only whether one is stored (`hasValue`), and the kit fails any `settingsSchema` field named like a secret. The kind never stores, logs or returns a secret: the consuming slice owns the credential store and hands `build` a resolver that lives for the call. Unknown ids are refused on write and ignored with a warning on read, so a removed plugin neither bricks the row nor is silently accepted.
- **Principal and scope.** A `Scope` is derived from the principal, never from request input; `SystemActor` is the only unscoped path and always carries a reason.
- **Scoped data access is defence in depth.** Every route still declares its access, and a service still decides which user it acts for; the scoped client guarantees that, once it has, a forgotten `where: { userId }` cannot reach another user's rows. It is application-level only until row-level security arrives with organisations (#725). Another user's row is "not found", never a 403 that leaks its existence.
- **Raw SQL bypasses scoping.** A scoped client refuses it outright; unscoped raw SQL is allowed only in files on the app's raw-SQL allowlist, each with a reason, enforced by the `userOwnedData` conformance suite. A raw statement must never take a request-derived id without scoping it to the caller.
- **Not rewritten:** nested writes and relation `include`/`select`. Scope the nested model with its own call.

## Conformance suite

The pluggable-kind kit is `describePluggableKindConformance` of `@marinoscar/platform-api/core/testing` (see [Pluggable kinds](#pluggable-kinds)); every kind runs it on its implementations. Otherwise none of its own: the slice is pinned by its specs in the package (`test/core/`: registry, principal types, filter, verbatim brand, cipher, startup check, OpenAPI tags, import boundary, and `data-access/`: the registry rules and the scoped extension run against a fake client implementing `$extends`). Apps run the platform conformance suites from the [`testing` slice](../testing/README.md); `userOwnedData` is the one that checks an app's user-owned registrations against its schema and its raw SQL against its allowlist. The real-database isolation proof stays in the reference app (`apps/api/test/prisma/scoped-access.db.spec.ts`), because it needs the app's schema.

## Upgrade notes

PP-14.5 (#923) adds the pluggable-kind primitive and the `./core/testing` entry; nothing existing changes. `describeOrgFields` of the settings slice now delegates to `describeConfigFields` and drops the new `label` and `help`, so the organization settings response (and its OpenAPI) is byte-identical.

First release of the full slice (the registry primitive shipped first, issue #694; the host ports with #696). For anyone who copied the app's files before the move:

- `verifyEncryptionKeyAtStartup(prisma, logger)` is now `verifyEncryptionKeyAtStartup(countStoredSecrets, logger)`: pass `() => prisma.credential.count()`. Messages and decisions are unchanged.
- Delete the local copies under `src/common/{registry,principal,filters/http-exception.filter.ts,exceptions,dto/error.dto.ts,crypto}` and import from `@marinoscar/platform-api/core`. Stored ciphertexts stay readable.
- Scoped data access (#699): delete the local `user-owned-model.registry.ts`, `scoped-access.error.ts` and the extension inside `scoped-prisma.service.ts`; import `userOwnedModelRegistry`, `registerUserOwnedModels`, `ownerFieldOf`, `ownerRelationOf`, `ScopedAccessError`, `userScopeExtension` and `asSystem` from this subpath, type registrations as `UserOwnedModelDef<Prisma.ModelName>`, and keep `ScopedPrismaService` as a thin wrapper. `buildUserScopedClient(prisma, scope)` is now `prisma.$extends(userScopeExtension(scope))` (typed) or `forUser(prisma, scope)` (schema-independent). `asSystem(actor)` on the service is unchanged; the package form is `asSystem(client, actor)`. Semantics are unchanged.
- An app that kept a local `deriveSigningKey` beside its copy of the cipher (#822): delete it and import `deriveSigningKey` from this subpath. The derivation and the label are identical, so outstanding signed tokens stay valid.
- Roles and permissions (#866): delete a local `permission.registry.ts`, `permission-ids.ts` and the declaration types, and import `roleRegistry`, `permissionRegistry`, `registerRoles`, `registerPermissions`, `permissionIds`, `roleIds`, `buildPermissionCatalog` and the types from this subpath. The registry names (`roles`, `permissions`), the id patterns, the validation messages and the catalog shape are unchanged, so a committed catalog stays byte-identical. Register the platform's declarations with `registerPlatformPermissions()` of `@marinoscar/platform-api/manifest` instead of a hand-written list.
- #727: delete local copies of `common/decorators/api-data-response.decorator.ts` and `common/maintenance/allow-during-maintenance.decorator.ts` (or re-export them, as the reference app does) and import `ApiDataResponse`, `AllowDuringMaintenance` and `ALLOW_DURING_MAINTENANCE_KEY` from this subpath. Same metadata, same OpenAPI output.
- `apps/api/src/openapi/tags.ts` no longer exports `OPENAPI_TAGS`, `OPENAPI_TAG_GROUPS` or `TAG_GROUPS`: it registers into `openApiTags`; read `openApiTags.list()` and `openApiTagGroups()` instead.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `FROZEN` on `register()` | The application already bootstrapped. Register from a module-scope manifest imported before bootstrap, not from a request or a later hook. |
| `DUPLICATE_REGISTRY` at import | Two `defineRegistry` calls share a `name`, or the package was loaded twice (two copies installed). |
| `DUPLICATE_ID` | The id is already registered. Use `onDuplicate: 'replace'` only where replacing is the documented behaviour. |
| A registry that never freezes | `RegistryFreezeService` is not provided in any module of the app. |
| Boot fails with `SECRETS_ENCRYPTION_KEY is not set, but N encrypted credential(s) are stored` | The key that wrote them is gone. Restore it; see the rotation runbook if it is lost. |
| `SECRETS_ENCRYPTION_KEY is not valid base64` or `decoded to N bytes` | The key is malformed. Generate one with `openssl rand -base64 32`. |
| `Failed to decrypt secret: ...` | Wrong key, wrong purpose (a per-user secret decrypted with the bare purpose), or a tampered payload. |
| An error body without `message` (only `error`, `error_description`) | The exception was branded with `withVerbatimErrorBody`; that is the RFC 8628 device token endpoint's contract. |
| A tag renders with no description or outside every sidebar group | No one registered it in `openApiTags`. |
| `Unknown <kind> implementation "x". Registered: ...` (`PluggableUnknownError`) | Nothing registered that id: import the file that registers it before the application is created (or, on a read, the plugin was removed and its stored entry is ignored with a warning). |
| The conformance kit fails "keeps secrets out of settingsSchema" | A settings field is named `key`, `secret`, `token` or `password`. Move real secrets to the implementation's `secrets`; for a field that is not one (an S3 `keyPrefix`) pass `allowSecretLikeFields`. |
| The kit runs no cases for an implementation | The registering file was imported after `describePluggableKindConformance` was called; import it first. |
| `Nest can't resolve dependencies ... Symbol(@marinoscar/platform/AUDIT_SINK)` (or another port) | A slice injects a port the app did not bind. Add it to `PlatformHostModule.forRoot({...})` in `apps/api/src/platform/platform-host.module.ts`. |
| `definePlatformHost: ... never public` at import | The host's `access` functions are missing or return something that is not a decorator. |
| `ScopedAccessError: <Model> is not user-owned; use asSystem() with a reason.` | The model is actor-only or unregistered (or the registry was never filled: the app's manifest was not imported before the call). Register it, or use `asSystem` for system work. |
| `ScopedAccessError: ... raw SQL is system-only` | Raw SQL on a scoped client. Use `asSystem` (and the raw-SQL allowlist). |
| `ScopedAccessError: ... names another user` / `cannot move a row to another owner` | A scoped write set the owner field to someone else. |
| A scoped client returns rows of every user | The call went through the unscoped client, or the model's `ownerField` is wrong (the `userOwnedData` suite catches a wrong field). |
| A packaged route's `operationId` changed | The controller class or handler was renamed, or decorators were reordered; see the controller-factory recipe. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "Dependency graph", "The Extension Contract" (rung 2, registries) and "Tenancy and access model".
- ADR: [0001, org-aware principal and scope](../../../../docs/adr/0001-org-aware-principal-and-scope.md).
- Scoped data access in the reference app: [prisma/ownership/README.md](../../../../apps/api/src/prisma/ownership/README.md); security view: [SECURITY-ARCHITECTURE.md §17](../../../../docs/SECURITY-ARCHITECTURE.md#17-user-owned-data-and-scoped-access).
- Registry recipe and behaviour rules: [registry/README.md](./registry/README.md).
- Pluggable kinds: [Pluggable kinds](#pluggable-kinds); wire shapes in the [contract settings README](../../../platform-contract/src/settings/README.md).
- Encrypted credential storage: [SECURITY-ARCHITECTURE.md](../../../../docs/SECURITY-ARCHITECTURE.md) and the [key rotation runbook](../../../../docs/runbooks/rotate-secrets-encryption-key.md).
- Error envelope: [API.md](../../../../docs/API.md).
- Package README: [platform-api](../../README.md).
