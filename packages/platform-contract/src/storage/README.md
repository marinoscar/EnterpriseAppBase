# @marinoscar/platform-contract/storage

The wire contract of the storage slice (issue #736, PP-8.3), as zod schemas with their inferred types, plus the zod-free value lists: the `storage` system-settings namespace (`systemStorageSchema` and its partial, the PUT and PATCH branches `storageSettingsSchema` / `storageSettingsPatchSchema`, the GET branch `storageResponseSchema`), the objects API and `GET /api/storage/status`, and the storage-config admin routes (save, connection test, bucket provisioning). `@marinoscar/platform-api/storage` wraps them as DTOs; `@marinoscar/platform-web/storage` reads their types and value lists. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for object storage, so the API's validation, its OpenAPI document and the web page's types cannot drift. `constants.ts` holds `BUILTIN_STORAGE_PROVIDER_KINDS` (`s3`, `r2`, `s3compatible`: the drivers the platform ships, NOT the set of valid providers; `STORAGE_PROVIDER_KINDS` is its deprecated alias), `STORAGE_DRIVER_ID_PATTERN`, `LEGACY_STORAGE_FLAT_FIELDS`, `STORAGE_OBJECT_STATUSES`, `MISSING_STORAGE_CONFIG_FIELDS` and `STORAGE_SECRET_FIELD_NAMES`, zod-free.

Not here: the provider, the services and the routes (the API slice), the page (the web slice), the profile-image response (it embeds the COMPOSED user-settings schema, which only the app's registries know, so the API slice builds it at `forRoot` time).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { storageConfigResponseSchema, BUILTIN_STORAGE_PROVIDER_KINDS, storageDriverIdSchema } from '@marinoscar/platform-contract/storage';
import type { StorageConfigResponse, ObjectResponse } from '@marinoscar/platform-contract/storage';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The API slice wraps a body as a DTO; the reference app's settings schemas re-export the namespace's ([`settings.schema.ts`](../../../../apps/api/src/common/schemas/settings.schema.ts)):

```ts
import { createZodDto } from 'nestjs-zod';
import { updateStorageConfigSchema } from '@marinoscar/platform-contract/storage';

export class UpdateStorageConfigDto extends createZodDto(updateStorageConfigSchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

The shapes are the contract of the slice's routes and its settings namespace; what is open is the storage driver id. A driver an app or package registers (`registerStorageDriver` of `@marinoscar/platform-api/storage`) is a valid `provider` everywhere, with its own settings under `drivers.<id>`.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `storageDriverIdSchema` | option | `z.string().regex(STORAGE_DRIVER_ID_PATTERN)` | Validate a storage driver id (any registered driver, not an enum); the `provider` of every storage schema is this | experimental | [example](../../../../apps/api/src/app-registrations/storage.ts) |
| `BUILTIN_STORAGE_PROVIDER_KINDS` | option | `readonly ['s3', 'r2', 's3compatible']` | Labels and defaults for the drivers the platform ships; never to validate an id | experimental | [example](../../../../packages/platform-api/src/storage/drivers/s3/s3-family.ts) |
| `systemStorageSchema` and the PUT, PATCH and response branches | option | `{ provider, drivers: Record<id, Record<string, unknown>>, ...six deprecated flat aliases }` | Read or write the `storage` namespace: the active driver and each driver's non-secret settings (validated by the driver in the API) | experimental | [example](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts) |
| `storageConfigResponseSchema` `descriptors` | option | `descriptors: PluggableDescriptor[]` | Render a generated form for every registered driver, built-ins and an app's alike; secrets are `secret` fields with `hasValue` only | experimental | [example](../../../../apps/api/test/examples/storage/local-fs-driver.spec.ts) |

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

## Data

No tables. `systemStorageSchema` is the `storage` value of the `global` system-settings row; `version`, `updatedAt` and `updatedBy` of the admin view come from that row. Object sizes and part totals are strings (64-bit values lose precision as JSON numbers); dates are ISO strings; `forcePathStyle` is tri-state (`null` means "this vendor's convention"). The `storage` value stores `provider` plus a `drivers` record; the six flat fields (`bucket`, `region`, `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`) are optional deprecated aliases of the active built-in driver, read from an old row and accepted on PUT and PATCH.

## Permissions and settings

None declared here. The routes carrying these shapes are gated by `storage:read|write` (objects), `storage_config:read|write` (admin) and `system_settings:*` (the namespace through `/api/system-settings`).

## UI

None. The page is `@marinoscar/platform-web/storage/ui`.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

The secret access key is not representable in the stored settings, the GET branch or the admin view: `StorageSettingsCarriesNoSecret` is a compile-time proof that fails the build the moment a field named in `STORAGE_SECRET_FIELD_NAMES` is added to `systemStorageSchema` (`STORAGE_SETTINGS_CARRIES_NO_SECRET`). The admin PUT's `secretAccessKey` is write-only (blank preserves the stored one); the view describes it as a masked status only. `accessKeyId` is published on purpose: an identifier that travels in the clear in every SigV4 request.

## Conformance suite

The API slice's `storage` suite (`@marinoscar/platform-api/storage/testing`) scans `systemStorageSchema`, `storageResponseSchema` and `storageConfigResponseSchema` for secret-named fields; see its README.

## Upgrade notes

New in this version. The shapes are unchanged from the reference app's `common/schemas/` and `storage/**/dto/`; the OpenAPI document was identical until PP-14.7 (#925). The objects list query's `status` and the object responses' `status` enumerate `STORAGE_OBJECT_STATUSES` in the fragment's order.

PP-14.7 (#925) opens the storage provider. Additive for existing clients: `provider` widens from the `s3 | r2 | s3compatible` enum to a driver id pattern; the `storage` namespace gains the `drivers` record (the six flat fields stay as optional aliases, so an old row, a PUT, a PATCH and an old admin client keep working); the admin view gains `drivers` and `descriptors` and its `missing` widens from an enum to strings; the admin PUT, test and bucket bodies gain optional `drivers` and `secrets` and their flat fields become optional; the test and provisioning results gain an optional `message` (and `details`). `STORAGE_PROVIDER_KINDS` is a deprecated alias of `BUILTIN_STORAGE_PROVIDER_KINDS`; `StorageProviderKind` is `string`. The `storage` slice now depends on the `settings` contract slice (`pluggableDescriptorSchema`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `StorageSettingsCarriesNoSecret` resolves to `never` and the build fails | A secret-named field was added to the namespace | Store the secret with `CredentialsService` at `(purpose 'storage', name 'default')` |
| `{ "storage": { "bucket": "" } }` clears the bucket | By design: `''` un-configures a field; absent leaves it alone | Omit the field to keep it |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/storage/README.md)
- [The web slice](../../../platform-web/src/storage/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)
