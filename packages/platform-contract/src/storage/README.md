# @marinoscar/platform-contract/storage

The wire contract of the storage slice (issue #736, PP-8.3), as zod schemas with their inferred types, plus the zod-free value lists: the `storage` system-settings namespace (`systemStorageSchema` and its partial, the PUT and PATCH branches `storageSettingsSchema` / `storageSettingsPatchSchema`, the GET branch `storageResponseSchema`), the objects API and `GET /api/storage/status`, and the storage-config admin routes (save, connection test, bucket provisioning). `@marinoscar/platform-api/storage` wraps them as DTOs; `@marinoscar/platform-web/storage` reads their types and value lists. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for object storage, so the API's validation, its OpenAPI document and the web page's types cannot drift. `constants.ts` holds `STORAGE_PROVIDER_KINDS` (`s3`, `r2`, `s3compatible`; closed), `STORAGE_OBJECT_STATUSES`, `MISSING_STORAGE_CONFIG_FIELDS` and `STORAGE_SECRET_FIELD_NAMES`, zod-free.

Not here: the provider, the services and the routes (the API slice), the page (the web slice), the profile-image response (it embeds the COMPOSED user-settings schema, which only the app's registries know, so the API slice builds it at `forRoot` time).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { storageConfigResponseSchema, STORAGE_PROVIDER_KINDS } from '@marinoscar/platform-contract/storage';
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

None. The shapes are the closed contract of the slice's routes and its settings namespace; the provider list is closed on purpose (a non-S3 backend overrides `STORAGE_PROVIDER` in the API slice, it is not a new kind).

## Data

No tables. `systemStorageSchema` is the `storage` value of the `global` system-settings row; `version`, `updatedAt` and `updatedBy` of the admin view come from that row. Object sizes and part totals are strings (64-bit values lose precision as JSON numbers); dates are ISO strings; `forcePathStyle` is tri-state (`null` means "this vendor's convention").

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

New in this version. The shapes are unchanged from the reference app's `common/schemas/` and `storage/**/dto/`; the OpenAPI document is identical. The objects list query's `status` and the object responses' `status` enumerate `STORAGE_OBJECT_STATUSES` in the fragment's order.

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
