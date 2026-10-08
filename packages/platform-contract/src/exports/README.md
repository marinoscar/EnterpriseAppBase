# @marinoscar/platform-contract/exports

The wire shapes of the exports slice (issue #744, PP-9.2): the request and responses of `/api/exports` (`GET /exports/sources`, `POST /exports`, `GET /exports`, `GET /exports/:id`), the cell, column and request-field shapes a source declares, and the JSON writer's file envelope (`schemaVersion: 1`), as zod schemas plus inferred types and zod-free constants. `@marinoscar/platform-api/exports` wraps them as DTOs (so the OpenAPI document is generated from them); `@marinoscar/platform-web/exports` takes the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the export routes accept and return. An export's id is its job id (there is no export table); its `status` (`pending`, `running`, `ready`, `expired`, `failed`) is derived on every read, never stored; a `ready` export read by id carries a short-lived signed `download`.

Layout: `constants.ts` (zod-free: statuses, scopes, column types, request field kinds, the id, dataset and file-name patterns, the list limit, the fixed failure message, the JSON `schemaVersion` and the route paths), `schemas.ts` and `index.ts`.

Not here: the source and writer registries, the jobs and the routes (`@marinoscar/platform-api/exports`), the dialog and the hooks (`@marinoscar/platform-web/exports`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { createExportSchema, EXPORT_STATUSES } from '@marinoscar/platform-contract/exports';
import type { ExportView, ExportSourceDescriptor } from '@marinoscar/platform-contract/exports';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod` (`constants.ts` imports no zod).

## Quick start

The web slice types its client with the view ([`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx) routes the page that reads it):

```ts
import type { ExportView } from '@marinoscar/platform-contract/exports';
const view: ExportView = await api.post('/exports', { source: 'user-data', format: 'json' });
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; a new source or format is `registerExportSource` / `registerExportWriter` in `@marinoscar/platform-api/exports`, not a contract change. Every object schema is exported so an app can `.extend()` it.

Supporting exports (experimental): `EXPORTS_PATH`, `EXPORTS_SOURCES_PATH`, `EXPORT_STATUSES`, `EXPORT_SCOPES`, `EXPORT_COLUMN_TYPES`, `EXPORT_REQUEST_FIELD_KINDS`, `EXPORT_ID_PATTERN`, `EXPORT_DATASET_PATTERN`, `EXPORT_FILE_NAME_PATTERN`, `EXPORT_LIST_LIMIT`, `EXPORT_FAILED_MESSAGE`, `EXPORT_JSON_SCHEMA_VERSION`; the schemas `exportCellSchema`, `exportColumnSchema`, `exportJsonDatasetSchema`, `exportJsonFileSchema`, `exportRequestFieldSchema`, `exportRequestFieldOptionSchema`, `exportFormatDescriptorSchema`, `exportSourceDescriptorSchema`, `exportSourcesResponseSchema`, `createExportSchema`, `exportDownloadSchema`, `exportSchema`, `exportListResponseSchema`, the enum schemas, and their types.

## Data

None. The contract owns no table: an export is a `jobs` row (`export.run`) plus a `storage_objects` row for its file.

## Permissions and settings

Declares none. The permission a source requires is the source's own (`user_settings:read` for `user-data`, `org_members:read` for `org-data`), enforced by the API slice.

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

`createExportSchema` is strict: an unknown key is a `400`, never silently dropped. `request` is an open record here on purpose, because the source's own schema validates it (at the route and again when the job starts). `EXPORT_FILE_NAME_PATTERN` keeps a `Content-Disposition` free of quotes, CR and LF, so the API never escapes a header. `download` exists only on a single-export read and is never stored.

## Conformance suite

None. `test/exports.test.ts` pins the schemas' behaviour and `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

New in #744. EvoPath's `GET /api/health/exports/:id` view (`format`, `from`, `to`, `datasets`, `labUnits` at the top level) maps to `source: 'health'` with those fields in the source's request; the status values and the `download` shape are unchanged.

## Troubleshooting

- **`POST /exports` answers 400 with a valid source.** The body has an extra key (the schema is strict), or the source's own request schema refused `request`; the error names the field.

## Links

- API: [`@marinoscar/platform-api/exports`](../../../platform-api/src/exports/README.md). Web: [`@marinoscar/platform-web/exports`](../../../platform-web/src/exports/README.md).
- Spec: [data-export.md](../../../../docs/specs/data-export.md), [platform-packages.md](../../../../docs/specs/platform-packages.md).
