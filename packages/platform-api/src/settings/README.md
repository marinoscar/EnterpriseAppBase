# @marinoscar/platform-api/settings

The settings slice of the API package (issue #733, PP-8.1): the deployment-wide settings document (`/api/system-settings`), each user's own settings (`/api/user-settings`), each organization's overrides (`/api/org-settings`), the two namespace registries every document is composed from, the `SettingsResolver` that reads a setting through the layers (system, then organization, then user), and the `SystemSettingsRowStore` for a slice that owns a `system_settings` row of its own. It depends on `core`, `identity` (the route decorators, the principal cache) and `testing` (its conformance suite) (`packages/platform-slices.json`).

## Purpose and scope

Settings are the substrate every other slice configures itself through. Before this slice they were reference-app code: a 1,178-line `SystemSettingsService`, the registry of #677 and the DTOs lived in `apps/api/src/settings/`, and there was no organization layer. The slice moves all of it into the package, unchanged in behaviour, and adds the org layer the AI (#739) and notification (#738) slices build their per-organization policy on.

What it does:

- **Two namespace registries** (rung 2). A system namespace (`SystemSettingsNamespace`) declares the stored shape, the canonical partial, the PUT and PATCH request-body branches, the response branch, the defaults, the PATCH merge and, optionally, its salvage (`read`), its org layer (`org`) and extra forbidden field names. A user namespace (`UserSettingsNamespace`) is always optional and never `.default()`. Registration refuses, at import time, a duplicate key, a reserved key, defaults that fail the stored schema and any field named `secret`, `secretAccessKey`, `secretKey`, `password`, `apiKey`, `token`, `privateKey` or `sessionToken` (any depth, any case), naming the key and pointing to `CredentialsService`. The owning slices keep their compile-time proofs (`StorageSettingsCarriesNoSecret` and its siblings).
- **Composition.** Every top-level object (the stored schemas, the request bodies, the responses, the defaults) is a fold over the registries in registration order (`compose*`), so a namespace exists in all of them or none.
- **The services.** `SystemSettingsService` (the `global` row: field-by-field degradation of a damaged value, unknown keys carried forward and reported in the log and the audit meta, `If-Match` 409, an audit row per write, `getNamespace(key)`; the per-namespace getters `getJobsPolicy` and its siblings remain as deprecated aliases). `UserSettingsService` (one row per user; absent namespaces stay absent; the display-name sync invalidates the principal cache). `OrgSettingsService` (one `org_settings` row per organization, under row-level security; its own version and `If-Match`; audited with the organization's id; each namespace's own permissions filter what a caller reads and refuse what it may not write).
- **`SettingsResolver`**: `resolveSystem(key, { orgId })` and `resolveUser(key, userId)`, the one read every slice should use. Neither creates a row.
- **`SystemSettingsRowStore`**: `read(key, schema, defaults)` and `write(key, value, { actorId, ifMatch, schema })` for a slice's own row (its own version, 0 while missing; validated in, degraded out; audited; the main row refused).

Not here: the namespaces themselves (each lives with the slice that owns it: `jobs` and `nodes` with #734, `storage` and the profile-image routes with #736, the `email` row with #737, `notifications` with #738, `ai` with #739, `databaseBackup` with #740, `retention` with #898 (the jobs slice); `maintenance` is the host slice's), the uploaded profile picture (object storage, reached through `SETTINGS_PROFILE_IMAGES`), and the web hub (`@marinoscar/platform-web/settings`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { SettingsModule, SettingsResolver, SystemSettingsService } from '@marinoscar/platform-api/settings';
```

Peers beyond the package's own: `@nestjs/config` (the session policy `GET /api/system-settings` reports), `nestjs-zod` and `zod` (the DTOs). The wire shapes of the core user fields, the UI-preference namespaces and the org routes come from `@marinoscar/platform-contract/settings`.

## Quick start

The reference app registers its namespaces first, then calls `forRoot` once and imports that one module everywhere ([`settings.config.ts`](../../../../apps/api/src/platform/settings/settings.config.ts)):

```ts
import '../../settings/registry'; // the app's manifests: register every namespace

import { SettingsModule as PlatformSettingsModule } from '@marinoscar/platform-api/settings';

import { SettingsHostModule } from './settings-host.module';

export const SettingsModule = PlatformSettingsModule.forRoot({ imports: [SettingsHostModule] });
```

A namespace is one declaration, registered by the app's manifest ([`system-settings.manifest.ts`](../../../../apps/api/src/settings/registry/system-settings.manifest.ts)), and typed by module augmentation:

```ts
declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces { coach: CoachSettings }
}
registerSystemSettingsNamespaces([COACH_SYSTEM_SETTINGS]);
// later, in any service: await systemSettings.getNamespace('coach')
// or, typed by the declaration alone (no augmentation needed):
//   await systemSettings.getNamespace(COACH_SYSTEM_SETTINGS)
```

Augment `@marinoscar/platform-api/settings` itself, never a deeper path: the four augmentable interfaces (`SystemSettingsNamespaces`, `SystemSettingsNamespaceDeclarations`, `UserSettingsNamespaces`, `UserSettingsNamespaceDeclarations`) are declared in the slice's entry module, so an app's augmentation and every slice's merge into one interface in whatever order the compiler meets them (#865).

A slice that owns a namespace registers it from its own `forRoot()` with `ensureSystemSettingsNamespaces(declarations, owner)` (`JobsModule` registers `jobs`, `NodesModule` registers `nodes`): a key the app's manifest already registered is left alone, so an app that pins the stored key order lists the declaration in its manifest, and an app that does not still gets the slice's defaults. Call those `forRoot()`s before `SettingsModule.forRoot()`.

An org layer is one more block on the declaration ([`org-overridable.namespaces.ts`](../../../../apps/api/src/platform-extensions/settings/examples/org-overridable.namespaces.ts)):

```ts
org: {
  schema: exportPolicySchema.partial(),
  merge: (system, org) => ({ enabled: system.enabled && (org.enabled ?? true), maxRows: Math.min(system.maxRows, org.maxRows ?? system.maxRows) }),
  readPermission: 'org_settings:read',
  writePermission: 'org_settings:write',
},
```

Fields inside an existing namespace, a package that contributes settings, changed defaults and the core profile and theme fields are covered in [Extending a namespace](#extending-a-namespace).

## Configuration

`SettingsModule.forRoot(options)`; no option is an environment variable (settings are runtime configuration and live in the database).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `systemRowKey` | `string` | `'global'` | The key of the main `system_settings` row. DO NOT CHANGE IT on an existing database: the old row is orphaned and every namespace reads as its defaults. |
| `orgLayer` | `boolean \| 'auto'` | `'auto'` | `false`: the resolver ignores organizations and `/api/org-settings` is not mounted. `true` or `'auto'`: an organization's row applies wherever it exists; a single-org deployment that never wrote one behaves exactly as before (the parity test). `TENANCY_MODE` decides whether more than one organization exists. |
| `imports` | `ModuleImport[]` | `[]` | The modules binding the host ports (`SETTINGS_DATA`, `SETTINGS_PROFILE_IMAGES`). |

Call `forRoot` once, after the app's manifests ran: the request bodies of the system and user routes are composed from the registries when it runs.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SettingsModule.forRoot` | option | `forRoot(options?: SettingsModuleOptions): DynamicModule` | Mount the slice once, after the app's namespace manifests | experimental | [example](../../../../apps/api/src/platform/settings/settings.config.ts) |
| `registerSystemSettingsNamespaces` | registry | `registerSystemSettingsNamespaces(namespaces: SystemSettingsNamespace[]): void` | Add a system namespace, without an org block (deployment-wide only) or with one (overridable per organization) | experimental | [example](../../../../apps/api/src/settings/registry/system-settings.manifest.ts) |
| `systemSettingsNamespaceRegistry` | registry | `Registry<SystemSettingsNamespace>` | List or temporarily extend the system namespaces (a test registers an org-layer example with `withTemporaryEntries`) | experimental | [example](../../../../apps/api/test/settings/org-settings.integration.spec.ts) |
| `registerUserSettingsNamespaces` | registry | `registerUserSettingsNamespaces(namespaces: UserSettingsNamespace[]): void` | Add an optional user namespace (`dataTables`, `navigation` are the platform's) | experimental | [example](../../../../apps/api/src/settings/registry/user-settings.manifest.ts) |
| `userSettingsNamespaceRegistry` | registry | `Registry<UserSettingsNamespace>` | List or temporarily extend the user namespaces | experimental | [example](../../../../apps/api/test/settings/settings-catalog.spec.ts) |
| `extendSystemSettingsNamespace` | registry | `extendSystemSettingsNamespace(base, { key, path?, storedSchema, defaults, org?, ... }): SystemSettingsNamespace` | Add fields to a registered system namespace, beside its top-level fields or INSIDE a nested object (`path: 'query'`), optionally organization-overridable (`org`) | experimental | [example](../../../../apps/api/src/platform-extensions/settings/examples/telemetry-query.extension.ts) |
| `extendUserSettingsNamespace` | registry | `extendUserSettingsNamespace(base, { key, path?, schema, ... }): UserSettingsNamespace` | Add fields to a registered user namespace, at the top level or at a nested `path` | experimental | [example](../../../../apps/api/src/app-registrations/settings.ts) |
| `overrideSettingsNamespaceDefaults` | registry | `overrideSettingsNamespaceDefaults(key, partialDefaults): void` | Change the defaults of a system namespace (never its shape or merge), checked against its stored schema | experimental | [example](../../../../apps/api/src/platform-extensions/settings/examples/defaults.override.ts) |
| `registerSettingsContribution` | registry | `registerSettingsContribution({ id, system?, user?, extensions? }): void` | Let a package contribute namespaces and extensions from a side-effect import, assembled between the platform's and the app's | experimental | [example](../../../../apps/api/src/platform-extensions/settings/contribution.ts) |
| `extendUserProfile` | registry | `extendUserProfile({ fields: z.object(...) }): void` | Add optional, bounded fields to the core user `profile` (`timezone`) | experimental | [example](../../../../apps/api/src/platform-extensions/settings/examples/profile-timezone.ts) |
| `registerThemePreference` | registry | `registerThemePreference({ id, label }): void` | Add a theme id `theme` accepts and `GET /api/user-settings` lists in `themeOptions` | experimental | [example](../../../../apps/api/src/platform-extensions/settings/examples/profile-timezone.ts) |
| `SETTINGS_DATA` | token | `unique symbol` -> `SettingsDataPort` | Bind `runInOrg`, the org-scoped transaction `org_settings` is read and written in | experimental | [example](../../../../apps/api/src/platform/settings/settings-data.adapter.ts) |
| `SETTINGS_PROFILE_IMAGES` | token | `unique symbol` -> `SettingsProfileImages` | Bind the profile normalisation and the uploaded-avatar check (object storage) | experimental | [example](../../../../apps/api/src/platform/settings/settings-profile-images.adapter.ts) |
| `SettingsResolver` | token | `resolveSystem<T>(key, { orgId? }): Promise<T>`, `resolveUser<T>(key, userId): Promise<T \| undefined>` | Read a setting through the layers: system, then organization, then user | stable | [example](../../../../apps/api/src/platform-extensions/settings/examples/resolve-org-setting.example.ts) |
| `SystemSettingsRowStore` | token | `read<T>(key, schema, defaults)`, `write<T>(key, value, { actorId, ifMatch?, schema })` | Keep a slice's own `system_settings` row (its own version, audited) | experimental | [example](../../../../apps/api/src/platform-extensions/settings/examples/row-store.example.ts) |
| `settingsConformanceSuite` | registry | `ConformanceSuite<SettingsConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { settings } })` | experimental | [example](../../../../apps/api/test/settings/settings-conformance.spec.ts) |

Supporting exports (experimental unless noted): the declaration types (`SystemSettingsNamespace`, `UserSettingsNamespace`, `SettingsNamespaceOrgLayer`, `SettingsReadHelpers`, `SystemSettingsNamespaceOf`), `ensureSystemSettingsNamespaces` (a slice registering its own namespaces from its `forRoot()`) and the augmentation targets `SystemSettingsNamespaces`, `SystemSettingsNamespaceDeclarations`, `UserSettingsNamespaces`, `UserSettingsNamespaceDeclarations`, `UserProfileSettingsExtensions`; the extension folding (`foldSettingsExtensions`, the extension types `SystemSettingsNamespaceExtension`, `UserSettingsNamespaceExtension`, `SettingsExtensionOrgLayer`, `SettingsOrgTightener`); the assembly the app's manifests call (`assembleSystemSettingsNamespaces`, `assembleUserSettingsNamespaces`, `applySettingsDefaultsOverrides`, the registries `settingsContributionRegistry`, `settingsDefaultsOverrideRegistry`, `userProfileFieldRegistry`, `themePreferenceRegistry`, and the types `SettingsContribution`, `SettingsDefaultsOverride`, `UserProfileField`, `ThemePreferenceDefinition`, `CORE_PROFILE_FIELDS`); the platform's user namespaces `DATA_TABLES_USER_SETTINGS` and `NAVIGATION_USER_SETTINGS` (stable); the compose functions and the `current*` per-request variants; the deny-list `SETTINGS_SECRET_FIELD_NAMES` (stable) and the schema walkers; the catalog render and check; the services `SystemSettingsService` and `UserSettingsService` (stable), `OrgSettingsService`; the composed body types (`UpdateSystemSettingsDto`, `PatchSystemSettingsDto`, `UpdateUserSettingsDto`, `PatchUserSettingsDto`); the permission declarations `SETTINGS_PERMISSIONS` (stable) and `ORG_SETTINGS_PERMISSIONS`; the data declarations `SETTINGS_MODEL_OWNERSHIP` and `SETTINGS_USER_OWNED_MODELS`; the structural row types (`SettingsPrisma`, `SettingsOrgTx`, ...).

### Merge modes of an org layer

- `'override'`: each field the organization stores replaces the system value.
- A function `(system, org) => value`: a TIGHTEN merge. It may only restrict (an organization can switch a capability off, lower a cap, never the reverse); the slice cannot prove that for you, so keep the function a `&&` / `Math.min` of the two. Its result must satisfy the stored schema, or the system value applies.

An org schema is a `z.object` whose every field is optional and names a field the namespace stores. A stored org field that no longer validates is ignored (the system value applies) rather than failing the read.

### Extending a namespace

The extension ladder is [docs/EXTENDING.md](../../../../docs/EXTENDING.md#extend-a-settings-namespace); this is the contract of the settings rungs.

**Fields inside a namespace.** An extension is a list entry in `app-registrations/settings.ts` (or a contribution) and is folded into the declaration before anything is registered, so the registry only ever holds the final one. Every schema of the namespace gains the fields, the defaults gain theirs, the merge keeps the base's for the base fields and carries the added ones, and a stored value that predates the field reads with the field at its default and everything else intact.

| Extension field | Meaning |
|---|---|
| `key` | The namespace to extend: the platform's, the app's or a contribution's |
| `path` | A dot path to an object field (`query`, `a.b`): the fields go INSIDE it. The segments must exist and be objects; an existing LEAF key is refused, the parent is not. Absent: beside the top-level fields |
| `storedSchema`, `defaults`, ... | The added fields, as for a top-level extension |
| `org` | `{ mode: 'override' \| 'tighten', fields?, tighten?, readPermission?, writePermission? }`: which of the ADDED fields an organization may set |

**The org layer of an extension.** The namespace gains an org layer (or its existing one gains the fields), validated like any org layer at registration. Only the fields the extension adds can join it: `org.fields` naming a field the namespace already has is refused, so an extension never opens a system-only setting to organizations. With `path` the org fields are stored under the same path and merged into the system value at that path only; the base fields beside them stay the deployment's, and an organization that names one gets a `400` (the nested org schema is strict). `mode: 'tighten'` needs a tightener per field: `'and'` (a boolean the organization can only switch off), `'or'` (only on), `'min'` (a number it can only lower), `'max'` (only raise) or a function that itself only restricts. A value of the wrong type for the tightener keeps the system value. The layer has one permission pair: when the namespace already has an org layer the extension's must match it (default `org_settings:read` and `org_settings:write`). A second org extension under the same nested root is refused; put every org field of one path in one extension. The generated organization page shows an added top-level field as a control; a nested one is an object (`other`), drawn by a renderer the app registers ([web README](../../../platform-web/src/settings/README.md)).

**Defaults.** `overrideSettingsNamespaceDefaults(key, partial)` (a package's import-time call) and `APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES` (the app's data) merge a partial value onto the namespace's defaults, objects deeply and everything else replaced. Every path must exist in the stored schema and the result must satisfy it, or the boot fails naming the namespace; the shape, the merge and the org rules stay the namespace's. Run `npm run catalog:settings --workspace=api` after adding one in an app. User namespaces have no defaults (absent means "use the client's built-in default"), so there is nothing to override.

**Contributions and the assembled order.** A package calls `registerSettingsContribution({ id, system, user, extensions })` from its entry module; the app imports the package for its side effect in `app-registrations/settings-contributions.ts`. The manifests call `assembleSystemSettingsNamespaces` / `assembleUserSettingsNamespaces`, which list:

1. the platform's namespaces, in the order the app gives them,
2. the contributions' namespaces, in import order,
3. the app's own namespaces,

then fold the extensions (the contributions' in import order, then the app's) into whichever namespace they name, then apply the defaults overrides (calls in call order, then the app's list). Registration order is the stored JSON's key order and the OpenAPI document's, so a contribution never reorders an existing key. A key two owners declare fails the import naming both (`settings contribution "@kappa/billing" declares it, but the platform already does`); an extension of a missing namespace names the key and lists the known ones; a package imported twice (two copies installed) is refused as a duplicate contribution id.

**The core user fields.** `theme` and `profile` are core fields, not namespaces, so they have their own registries; `security` is derived from the session policy and stays closed.

- `extendUserProfile({ fields })` adds optional fields to `profile`. They are stored, validated, patched (`null` deletes one; absent keeps it), replaced by `PUT` (an omitted field is cleared) and returned with the profile. Each field must accept `undefined`, carry no `.default()`, and be bounded (`.max()` on every string and array, no `record`, `any` or `unknown`): the user writes the value themselves into a JSONB row. A core name (`displayName`, `imageSource`, `imageObjectId`), a secret name or a field another extension added is refused naming the field. A stored value that no longer validates is dropped on read, never returned. Type the field with `declare module '@marinoscar/platform-api/settings' { interface UserProfileSettingsExtensions { timezone?: string } }`.
- `registerThemePreference({ id, label })` adds an id `theme` accepts (`THEME_PREFERENCE_ID_PATTERN` of the contract; not `light`, `dark` or `system`). While at least one is registered `GET /api/user-settings` also returns `themeOptions: [{ id, label }]`; with none, the document and the OpenAPI schema are exactly what they were. A stored theme that is no longer registered reads as `system` with a warning rather than failing later writes. What a registered theme looks like, and applying the stored id, is the web app's.

Both are called at import time, before `SettingsModule.forRoot()` composes the request bodies. With nothing registered the composed schemas are the contract's own objects.

## Data

The `settings` fragment of `@marinoscar/platform-db` (`schema/settings.prisma`):

| Model | Table | Notes |
|---|---|---|
| `SystemSettings` | `system_settings` | Deployment-level, no RLS. One row per key. Keys in use in the reference app: `global` (every registered namespace), `email` (the email slice's transport), `telemetry_connection` (the telemetry store's connection). |
| `UserSettings` | `user_settings` | One row per user (`user_id` unique, `Cascade`). User-owned (`purge: 'delete'`, exported). |
| `OrgSettings` | `org_settings` | One row per organization (`org_id` unique, FK to `organizations`, `Cascade`; `updated_by_user_id` `SetNull`). FORCEd row-level security, policy `org_settings_org_isolation`. Migration `0028_add_org_settings`. |

An app may reference none of these columns: read and write settings through the services. Secrets never go in any of them; they go in the encrypted credential store (`CredentialsService`).

## Permissions and settings

| Permission | Scope | Default grant | Route |
|---|---|---|---|
| `system_settings:read`, `system_settings:write` | system | `admin` | `GET`, `PUT`, `PATCH /api/system-settings` |
| `user_settings:read`, `user_settings:write` | org | `org_admin`, `contributor`, `viewer` | `GET`, `PUT`, `PATCH /api/user-settings` |
| `org_settings:read`, `org_settings:write` | org | `org_admin` | `GET`, `PATCH /api/org-settings` (`If-Match`); each namespace's `org.readPermission` / `org.writePermission` then gates its own fields inside the handler (omitted from `GET`, `403` on `PATCH`) |

`PATCH /api/org-settings` refuses an unknown namespace, one without an org block and a field its org schema does not declare with a `400`; a stale `If-Match` is a `409` (`0` matches an organization without a row). In single-org mode the default organization's `org_admin` is the system administrator, so these are effectively the administrator's.

The slice reads no settings namespace of its own.

## UI

None in this package. The hub, the registry helpers, the hooks and the open feature registry are `@marinoscar/platform-web/settings` ([README](../../../platform-web/src/settings/README.md)); the reference app's `Organization settings` card and page render `GET /api/org-settings`.

## Infra

None. No environment variable, no container, no Compose fragment: settings are runtime configuration in the database.

## Observability

Every write logs one line (`System settings patched by user: <id>`, `Organization settings patched for org <id> by <user>`); a write that carried keys the code does not model forward logs a warning listing them. Every write is an audit row (`system_settings:replace`, `system_settings:patch`, `org_settings:patch` with `org_id`, `system_settings:<key>:write` from the row store). No metric or span of its own: the request spans cover the routes.

## Security notes

- No settings document may carry a secret: the registries refuse a secret-named field at registration, the row store at write time, the conformance suite re-checks what is registered. `GET /api/system-settings` returns the document wholesale and every audit row copies it.
- Request bodies stay closed (the composed DTOs strip unknown keys); the stored value is never narrowed (unknown stored keys are carried forward, never surfaced).
- `org_settings` is read and written only through `SETTINGS_DATA.runInOrg`, a transaction that sets `app.org_id` transaction-locally: row-level security, not the service, keeps organization A from organization B's row (`apps/api/test/settings/org-settings-rls.db.spec.ts`). The org layer never uses the bypass client.
- The resolver and every read path never create a row; only `GET /api/system-settings`, `GET /api/user-settings` and the writes do.
- An extension's `org` block can name only fields the extension itself adds, so no extension can make a system-only setting overridable by an organization; at a nested path the organization's stored object is strict and the merge touches only the added fields. A `tighten` merge cannot widen: the built-in tighteners compare against the system value and ignore a value of the wrong type.
- A profile field an app adds is user-written JSONB: it must be optional, bounded and not secret-named, and a stored value that no longer validates is dropped on read. `security` is not extensible.
- A defaults override is data checked at boot against the namespace's own stored schema; it cannot add a field, change a type or touch the merge, and it never reaches a stored row (a stored value still wins).

## Conformance suite

`@marinoscar/platform-api/settings/testing` registers the `settings` suite with `runPlatformConformance()` (the reference app: [`settings-conformance.spec.ts`](../../../../apps/api/test/settings/settings-conformance.spec.ts)):

1. **no-secrets**: no registered system or user namespace, nor any org layer, declares a secret-named field.
2. **defaults**: every system namespace's defaults satisfy its stored schema, and the app registered at least `minSystemNamespaces`.
3. **org-permissions**: every org layer's read and write permission is in the app's permission registry, with org scope.
4. **catalog** (optional): the committed defaults catalog equals what the registry renders.

The reference app's registry tripwires (`settings-parity.spec.ts`, `registry.spec.ts`, `no-cycles.spec.ts`) keep running in the app; they move into the suite with #742.

## Upgrade notes

From the reference app's local settings module (#733):

- `SystemSettingsService`, `UserSettingsService` and `SETTINGS_PERMISSIONS` are imported from `@marinoscar/platform-api/settings`; the registry types and `declare module` augmentations name `@marinoscar/platform-api/settings` instead of `settings/registry/system-settings-namespace`.
- The services inject `PLATFORM_PRISMA`, not `PrismaService`; a unit test provides `{ provide: PLATFORM_PRISMA, useValue: mock }`. `UserSettingsService` reaches object storage through `SETTINGS_PROFILE_IMAGES`.
- `SettingsReadHelpers.readDisabledEvents` is replaced by the generic `readStringArray(stored, element, max)`.
- `getJobsPolicy` and the other per-namespace getters are deprecated aliases of `getNamespace(key)`.
- #865: the augmentable interfaces are declared in the entry module; a slice's own `declare module` names `'../settings/index'` (an app keeps naming `@marinoscar/platform-api/settings`). `getNamespace(declaration)` reads a namespace typed by its declaration (`SystemSettingsNamespaceOf<D>`) and throws when the key is not registered. `ensureSystemSettingsNamespaces` registers a slice's own namespaces unless already registered.
- The secret deny-list gained `privateKey`.
- The OpenAPI document of `/api/system-settings` and `/api/user-settings` is unchanged; `/api/org-settings` and the `Organization Settings` tag are new.
- PP-14.21: nothing changes for an app that registers none of the new extension points: no schema, no stored value and no OpenAPI field moves. `SettingsNamespaceOrgLayer` gained an optional `mode`. `UserSettingsUpdateBase.theme` and `UserSettingsDocument.theme` (web) widened to a theme id; `applyTheme` is still only called with `light`, `dark` or `system`.

## Troubleshooting

- **A namespace is missing from the PATCH body (a silent no-op).** It was registered after `SettingsModule.forRoot()` ran. Import the app's manifests before calling `forRoot` (the reference app imports `settings/registry` at the top of `settings.config.ts`).
- **`<Slice>Module.forRoot() registers the system settings namespace(s) ... but SettingsModule.forRoot() already composed the request bodies`.** A slice that registers its own namespace (`JobsModule`, `NodesModule`) was configured after `SettingsModule.forRoot()`. Call it first, or list its declaration (`JOBS_SYSTEM_SETTINGS`, `NODES_SYSTEM_SETTINGS`) in the app's manifest.
- **`getNamespace('myKey')` does not compile from an installed package (`not assignable to parameter of type ...`).** The augmentation names a path other than `@marinoscar/platform-api/settings`, or the file holding it is not part of the program. Or read it as `getNamespace(MY_DECLARATION)`, which needs no augmentation.
- **`Nest can't resolve dependencies of the SystemSettingsService (?, ...)`.** `PLATFORM_PRISMA` is not bound in the graph. Bind it in the module you pass as `imports` (the reference app's `SettingsHostModule` does, as the same client the platform host binds).
- **`PATCH /api/org-settings` answers 400 "cannot be overridden per organization".** The namespace has no `org` block, or the field is not in its org schema.
- **`Cannot extend system settings namespace "x": no such namespace`.** The extension's `key` is registered nowhere: the platform's list, a contribution or the app's. Extensions fold after every namespace is collected, so import order between contributions does not matter here, but the package that declares the namespace must be imported at all.
- **`... already declares "daily"; an extension only adds fields`.** The field exists at that path. With `path` the error names the object (`storedSchema.limits`); an extension only adds, it never replaces.
- **`... has no "x" field to extend`.** `path` names a field the schema does not have, or one that is not an object.
- **`org.fields names "x", which the extension does not add`.** An extension cannot make an existing field org-overridable; declare the org layer on the namespace itself.
- **`PATCH /api/org-settings` answers 400 for a nested field.** The nested org schema is strict: only the fields the extension added are accepted under the path.
- **A new profile field or theme never appears in the request bodies.** It was registered after `SettingsModule.forRoot()` composed them; call `extendUserProfile` and `registerThemePreference` at import time, with the manifests.
- **An organization's value seems ignored.** It no longer validates against the org schema (it is skipped field by field), or a tighten merge clamps it, or `orgLayer` is `false`.

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md) (Tenancy and access model, per-slice impact: settings resolve system, then org, then user).
- [settings-ui.md](../../../../docs/specs/settings-ui.md), [API.md](../../../../docs/API.md#optimistic-concurrency-if-match).
- Web: [`@marinoscar/platform-web/settings`](../../../platform-web/src/settings/README.md). Contract: [`@marinoscar/platform-contract/settings`](../../../platform-contract/src/settings/README.md).
- The reference app's composition: [`settings/registry/README.md`](../../../../apps/api/src/settings/registry/README.md).
