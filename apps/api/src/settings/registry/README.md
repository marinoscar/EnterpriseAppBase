# Settings namespace registries: the reference app's composition

Since #733 the registries, the compose functions, the services and the routes
are the settings slice of the platform package
([`@marinoscar/platform-api/settings`](../../../../../packages/platform-api/src/settings/README.md));
this folder holds what the APP decides: its manifests (which namespaces, in
which order), the import-time snapshot of what they compose to
(`composed.ts`), the seed catalog's path and the import-cycle guard.
`platform/settings/settings.config.ts` imports this folder before it calls
`SettingsModule.forRoot()`.

The system settings document (`system_settings.value`, the `global` row) and
each user's settings document (`user_settings.value`) are built from
**namespaces**, each declared once, next to the module that owns it, and
registered in two static registries on the [registry primitive](../../../../../packages/platform-api/src/core/registry/README.md)
(issue #677). Every top-level settings object the code uses is **derived** from
those registries: nothing lists the namespaces by hand.

Spec: [platform-packages.md](../../../../../docs/specs/platform-packages.md),
"The Extension Contract" (rung 2, settings namespaces). The app-owned seam:
[`app-registrations/settings.ts`](../../app-registrations/settings.ts).

## Files

| File | What it holds |
|---|---|
| `system-settings.manifest.ts`, `user-settings.manifest.ts` | The explicit lists: platform declarations in today's key order, then the app file |
| `composed.ts` | Imports the manifests and builds every composed object once, at module load (the stored schemas, the request bodies, the responses, the defaults) |
| `settings-catalog.ts` | The seed catalog's path (`prisma/catalog/system-settings-defaults.json`) and its staleness message, over the package's render and check |
| `registry.spec.ts`, `no-cycles.spec.ts` | The registries over this app's namespaces; the import-cycle guard |

In the package (`packages/platform-api/src/settings/registry/`): the registry
declarations (`system-settings-namespace.ts`, `user-settings-namespace.ts`),
`compose.ts`, `extend.ts`, `schema-walk.ts`, `merge-helpers.ts`, the secret
deny-list and the platform's `dataTables` and `navigation` user namespaces.
The per-namespace PUT, PATCH and response branches of the app's namespaces
are leaves in `common/schemas/system-settings-wire.schemas.ts` and
`common/schemas/system-settings-response.schemas.ts`.

The declaration files:

| Namespace | Declared in |
|---|---|
| system `notifications` | `notifications/notifications.system-settings.ts` |
| system `jobs` | `@marinoscar/platform-api/jobs` (`JOBS_SYSTEM_SETTINGS`; `JobsModule.forRoot()` would register it, the manifest lists it to pin the key order) |
| system `nodes` | `@marinoscar/platform-api/nodes` (`NODES_SYSTEM_SETTINGS`; likewise `NodesModule.forRoot()`) |
| system `databaseBackup` | `db-backup/db-backup.system-settings.ts` |
| system `maintenance` | `MAINTENANCE_SYSTEM_SETTINGS` of `@marinoscar/platform-api/host` (#867) |
| system `storage` | `storage/config/storage.system-settings.ts` |
| system `ai` | `ai/ai.system-settings.ts` |
| system `telemetry` | `platform/telemetry/telemetry.system-settings.ts` (data from `@marinoscar/platform-api/telemetry`) |
| system `retention` | `@marinoscar/platform-api/jobs` (`RETENTION_SYSTEM_SETTINGS`, #898; likewise registered by `JobsModule.forRoot()` unless the manifest lists it) |
| user `dataTables`, `navigation` | `@marinoscar/platform-api/settings` (`DATA_TABLES_USER_SETTINGS`, `NAVIGATION_USER_SETTINGS`) |
| user `notifications` | `notifications/notifications.user-settings.ts` |
| user `ai` | `ai/ai.user-settings.ts` |

## What a system namespace declares, and what each part feeds

`common/schemas/settings-parity.spec.ts` names the six places a namespace used
to be restated by hand. Each is now one field of the declaration:

| Field | Place | Composed into | What it is for |
|---|---|---|---|
| `key` | | every object below | Top-level key; `/^[a-z][A-Za-z0-9]*$/`; not `security`, `updatedAt`, `updatedBy`, `version` |
| `storedSchema` | 1 | `systemSettingsSchema` (required) | The value as stored, always complete |
| `patchSchema` | 2 | `systemSettingsPatchSchema` (`.optional()`) | The canonical partial |
| `putSchema` | 3 | `updateSystemSettingsSchema`, the PUT body | `requiredOnPut ? putSchema : putSchema.optional()` |
| `wirePatchSchema` | 4 | `patchSystemSettingsSchema`, the PATCH body (`.optional()`) | What the global `ZodValidationPipe` keeps; missing here is a silent no-op |
| `defaults` | 5 | `DEFAULT_SYSTEM_SETTINGS`, the seed catalog | The only place defaults live; must satisfy `storedSchema` |
| `merge(current, patch)` | 6 | `SystemSettingsService.patchSettings` | The namespace's PATCH merge; `patch` is `undefined` when the body does not mention it |
| `responseSchema` | | `systemSettingsResponseSchema` (OpenAPI) | The documented response branch, or `null` (still returned, not documented: today `telemetry`) |
| `requiredOnPut` | | the PUT body, `replaceSettings` | `false`: a PUT that omits the namespace keeps the stored value |
| `read?(stored, helpers)` | | `readKnownSettings` | Salvage of a stored value; default: field by field against `storedSchema`, falling back to `defaults` |
| `description` | | docs, error messages | One sentence |

The registry refuses, when the manifest registers it (so at import time): a key
already registered, a malformed or reserved key, a missing part, defaults that
fail `storedSchema`, a non-object `storedSchema` without its own `read`, and
**any field named `secret`, `password`, `apiKey`, `token`, `secretAccessKey`,
`secretKey`, `sessionToken` or `privateKey`** (any depth, any case) in the
stored, PUT, PATCH or response schema (or the org schema). The list is
`SETTINGS_SECRET_FIELD_NAMES` of `@marinoscar/platform-api/settings`
(re-exported by `common/schemas/settings.schema.ts`). Secrets go in the encrypted credential
store (`CredentialsService`), never in a document `GET /api/system-settings`
returns wholesale and every audit row copies.

## What a user namespace declares

User namespaces are always optional: absent means "use the built-in defaults".

| Field | Composed as | Notes |
|---|---|---|
| `key` | | Not `theme`, `profile`, `updatedAt`, `version` |
| `schema` | `.optional()` in `userSettingsSchema` | Bounded; **never `.default()`** (refused at registration) |
| `patchSchema` | `.nullable().optional()` in `userSettingsPatchSchema` | `null` clears the namespace |
| `putSchema?`, `wirePatchSchema?`, `responseSchema?` | the PUT body, the PATCH body, the response | Default to `schema`, `patchSchema`, `schema`; `responseSchema: null` leaves it out of the documented response (today `ai`) |
| `merge(current, patch)` | `UserSettingsService.patchSettings` | Return `undefined` for an emptied namespace, never `{}` |
| `assertLimits?(value)` | PUT and PATCH, after the merge | Throw `BadRequestException` for caps zod cannot express (key counts) |

## Adding a namespace

### From a platform module

1. Write the per-namespace zod schemas (stored and partial) as leaves, today in
   `common/schemas/settings.schema.ts` (system) or
   `common/schemas/user-settings-namespaces.schema.ts` (user). No `.default()`.
2. For a system namespace, add its PUT and PATCH branches to
   `common/schemas/system-settings-wire.schemas.ts` and its response branch to
   `common/schemas/system-settings-response.schemas.ts`.
3. Create `<module>/<module>.system-settings.ts` (or `.user-settings.ts`)
   exporting the declaration with `satisfies SystemSettingsNamespace<...>`, and
   augment `SystemSettingsNamespaces` (key → value type) and
   `SystemSettingsNamespaceDeclarations` (key → `typeof` the declaration):

   ```typescript
   declare module '@marinoscar/platform-api/settings' {
     interface SystemSettingsNamespaces { retention: SystemRetentionValue }
     interface SystemSettingsNamespaceDeclarations { retention: typeof RETENTION_SYSTEM_SETTINGS }
   }
   ```

4. **Append** it to the platform list in the manifest. Order is the stored
   JSON's key order and the OpenAPI document's; never insert.
5. Run `npm run catalog:settings --workspace=api` and commit the regenerated
   `prisma/catalog/system-settings-defaults.json` (system namespaces only).

A declaration file imports only leaves (zod schemas, constants, the registry's
types). It never imports `composed.ts`, `common/types/settings.types.ts` or a
DTO file: under CommonJS that closes an import cycle and hands someone
`undefined`. `no-cycles.spec.ts` loads each file first to prove it.

### From an app

Add the declaration to `apps/api/src/app-registrations/settings.ts`
(`APP_SYSTEM_SETTINGS_NAMESPACES` or `APP_USER_SETTINGS_NAMESPACES`), with the
same augmentation, then regenerate the catalog. The manifests register app
entries after the platform's, so a key that collides with a platform one fails
at import time naming the app's entry. An app namespace is optional on PUT
unless it sets `requiredOnPut`, and a stored row that lacks it reads as its
`defaults`. `SystemSettingsService.getNamespace('coach')` reads it, typed by
the augmentation.

### Adding fields inside a registered namespace

List an extension in `APP_SYSTEM_SETTINGS_EXTENSIONS` or
`APP_USER_SETTINGS_EXTENSIONS`:

```typescript
export const APP_USER_SETTINGS_EXTENSIONS: readonly UserSettingsNamespaceExtension[] = [
  { key: 'ai', schema: z.object({ training: trainingPreferencesSchema }) },
];
```

The manifest folds it into the namespace before registering
(`extendUserSettingsNamespace`, `extendSystemSettingsNamespace`): every schema
gains the fields, the base merge runs for the base fields and the added fields
merge on top (absent keeps, and for a user namespace `null` deletes), a system
extension's `defaults` join the namespace's, and a base `read` keeps salvaging
the base fields. An extension may only add fields, and names an existing
namespace or the import fails. The added fields are not part of the platform's
value type: read them through the app's own zod type.

## Testing with a namespace

`withTemporaryEntries(systemSettingsNamespaceRegistry, [ns], fn)` makes the
services validate, merge, salvage, preserve and return `ns` (they compose from
the registry per request). The request-body DTOs, however, are composed when
their module loads; to drive a temporary namespace through HTTP, build the app
inside `jest.isolateModulesAsync` after registering it, as
`test/settings/settings-catalog.spec.ts` does.

## Rejected alternatives

- **A generic deep merge.** Arrays replace in one namespace and concatenate in
  none; `null` clears in some fields and is a value in others. Each namespace
  keeps its own merge, moved verbatim from the service.
- **`z.record` or `.passthrough()` composed schemas.** That changes the OpenAPI
  document and opens the request bodies; apps would lose typed, documented
  namespaces.
- **Registering from `onModuleInit`.** DTO classes and `openapi:dump` need the
  composed schemas at import time.
