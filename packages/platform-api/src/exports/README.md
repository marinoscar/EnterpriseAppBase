# @marinoscar/platform-api/exports

The data export framework (issue #744, PP-9.2): it answers "give me my data" (a GDPR or CCPA access request) and "give us our organization's data before we leave". Export **sources** turn a request into datasets, export **writers** serialise datasets into one file, and the `export.run` job streams a writer's output straight into object storage, where a short-lived signed URL downloads it. Harvested from EvoPath (`health-export/`: job-based files, the JSON, CSV-zip and XLSX writers, signed downloads, the expiry purge, `common/export/csv.ts`) and kvox (`export/`: `Exporter<TDoc>`, `ExporterRegistry<TDoc>`, the streaming render, declarative options). It depends on the `core`, `otel-core`, `identity`, `jobs`, `storage` and `testing` slices (`packages/platform-slices.json`); its wire shapes are `@marinoscar/platform-contract/exports` and its pages `@marinoscar/platform-web/exports`.

## Purpose and scope

- **Sources (rung 2).** `registerExportSource(source)`. The platform registers two:
  - `user-data`: the caller's own data. One dataset per model the user-owned registry (#688/#699) marks `export: 'include'`, plus `account` (the caller's `User` row). Permission `user_settings:read`, which every role holds.
  - `org-data`: one organization's data. Every model of kind `org` in the ownership registry (#725), plus `organization` and `members`. Permission `org_members:read` (the organization's admins); `organizations:read` (a system administrator) may name another organization.
- **Writers (rung 2).** `registerExportWriter(writer)`. Built in: `json` (a versioned envelope), `csv` (a zip of one RFC 4180 CSV per dataset) and `xlsx` (one sheet per dataset). There is no PDF writer: every PDF in the apps is domain layout, so an app registers its own, limited to its source with `sources`.
- **Document exporters.** `Exporter<TDoc>` and `ExporterRegistry<TDoc>`, with `optionsSchemaFor` and `hashExportRequest`, for an app that renders ONE document into several formats (kvox's transcripts and notes) rather than datasets.
- **CSV helpers.** `UTF8_BOM`, `FORMULA_TRIGGER`, `csvField`, `neutralizeFormula`, `csvRecord`, `csvCell`, `CSV_LINE_END`: RFC 4180 quoting and formula-injection neutralisation for every CSV the platform writes.
- **Jobs.** `export.run` (subject `user:<id>` or `organization:<id>`, `skipDedup`, an in-flight cap per subject) and `export.purge` (housekeeping). Both are server-only, and both type strings are permanent. The daily `@Cron` only enqueues.
- **Routes.** `GET /api/exports/sources`, `POST /api/exports`, `GET /api/exports` and `GET /api/exports/:id`.
- **No export table** (EvoPath's design). The export id is the job id, the request is on the job payload, the outcome is `payload.result`, and the status is derived.

Not here:
- domain sources and writers (EvoPath's health datasets and PDF, kvox's transcripts and notes), which apps register at adoption;
- file bytes in the user export: `storage_object` is a manifest, and "with files" is a future seam;
- import (a round trip);
- the telemetry slice's own CSV export, which keeps its internal helpers until the telemetry slice exposes a seam (follow-up).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { ExportsModule, registerExportSource, type ExportSource } from '@marinoscar/platform-api/exports';
import '@marinoscar/platform-api/exports/testing'; // tests only: registers the conformance suite
```

`archiver` (the CSV zip) and `exceljs` (the workbook) are dependencies of the package. The peers are the package's own (`@nestjs/*`, `zod`, `@opentelemetry/api`).

## Quick start

The reference app's binding, [`apps/api/src/platform/exports/exports.config.ts`](../../../../apps/api/src/platform/exports/exports.config.ts):

```ts
import { ExportsModule } from '@marinoscar/platform-api/exports';
import { Prisma } from '@prisma/client';

export const exportsModule = ExportsModule.forRoot({
  datamodel: Prisma.dmmf.datamodel, // the platform sources derive columns from it
  appSlug: APP_SLUG,                // download names: <slug>-user-data-2026-10-08.zip
  imports: [ExportsHostModule],     // binds EXPORTS_SYSTEM_DATA and EXPORTS_NOTIFIER
});
```

[`ExportsHostModule`](../../../../apps/api/src/platform/exports/exports-host.module.ts) binds the bypass client and the notifier. The app also:
- registers `EXPORTS_KEY_PREFIXES` in its key-prefix manifest, so the standalone storage purge reaches them;
- registers `export.ready` and `export.failed` in its notification registry;
- registers `EXPORTS_APP_METRICS` in its metric registry.

An app source:

```ts
registerExportSource({
  id: 'health', scope: 'user', label: 'Health data', permission: 'health_data:read',
  requestSchema: z.object({ from: z.iso.date(), to: z.iso.date() }).strict(),
  formats: ['json', 'csv', 'xlsx', 'health-pdf'],
  async *collect(ctx, req) { yield healthTable(ctx, req); }, // pages ctx.db, filters on ctx.subjectId
});
```

## Configuration

`ExportsModule.forRoot(options)`. These are code options, not environment variables or system settings: a retention period is a product decision. The defaults are EvoPath's.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `datamodel` | `ExportDatamodel` | required | The app's `Prisma.dmmf.datamodel`; the platform sources read each model's columns from it |
| `appSlug` | `string \| () => string` | `'app'` | The download-name prefix (`<slug>-<source>-<YYYY-MM-DD>.<ext>`) |
| `retentionDays` | `number` | `7` | Days a file is kept before `export.purge` deletes it |
| `downloadUrlTtlSeconds` | `number` | `300` | Lifetime of a signed download URL |
| `maxInFlightPerSubject` | `number` | `3` | Pending or running exports per user or organization; the next is a `429` |
| `pageSize` | `number` | `500` | Rows per page the platform sources read |
| `jobProfile` | `{ maxRuntimeMs, maxAttempts }` | 15 min, 2 | `export.run`'s execution profile |
| `purgeProfile` | `{ maxRuntimeMs, maxAttempts }` | 30 min, 3 | `export.purge`'s execution profile |
| `platformSources` | `{ userData?, orgData? }` | both `true` | Whether to register `user-data` and `org-data` |
| `legacyJobTypes` | `ExportLegacyJobType[]` | `[]` | An app's earlier job types (EvoPath's `health.export`, `health.export.purge`), kept registered as aliases, with an optional payload mapper |
| `imports` | `ModuleMetadata['imports']` | `[]` | The app's host module binding the ports |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `ExportsModule.forRoot` | option | `forRoot(options: ExportsModuleOptions): DynamicModule` | Mount the slice with the app's datamodel and its tuning | experimental | [example](../../../../apps/api/src/platform/exports/exports.config.ts) |
| `ExportLegacyJobType` | option | `{ type: string; handles: 'run' \| 'purge'; label?; toPayload?(payload) }` | Keep an app's earlier export job types processing after adoption (`legacyJobTypes`) | experimental | [example](../../../../apps/api/src/platform/exports/exports.config.ts) |
| `registerExportSource` | registry | `registerExportSource<Req>(source: ExportSource<Req>): void` | Add a domain source (EvoPath `health`, kvox `transcript`) | experimental | [example](../../../../apps/api/src/platform/exports/export-registrations.manifest.ts) |
| `registerExportWriter` | registry | `registerExportWriter(writer: ExportWriter): void` | Add an output format, optionally limited to sources (a domain PDF) | experimental | [example](../../../../apps/api/src/platform/exports/export-registrations.manifest.ts) |
| `exportColumnsOf` | hook | `exportColumnsOf(model: ExportDatamodelModel, omit?: string[]): ExportColumn[]` | The columns a registered model exports: scalar fields minus the entry's `exportOmit` (the story's `exportRedact`) and minus the default redaction rule | experimental | [example](../../../../apps/api/src/prisma/ownership/platform-user-owned-models.ts) |
| `UTF8_BOM` | hook | `'﻿'` | Start a CSV file so Excel detects UTF-8 | stable | [example](../../../../apps/api/src/examples/exports/example-single-csv.writer.ts) |
| `csvField` | hook | `csvField(text: string): string` | Quote one field as RFC 4180 requires | stable | [example](../../../../apps/api/src/examples/exports/example-single-csv.writer.ts) |
| `neutralizeFormula` | hook | `neutralizeFormula(text: string): string` | Prefix a text cell a spreadsheet would read as a formula with `'` | stable | [example](../../../../apps/api/src/examples/exports/example-single-csv.writer.ts) |
| `csvRecord` | hook | `csvRecord(fields: readonly string[]): string` | Join quoted fields into one record | stable | [example](../../../../apps/api/src/examples/exports/example-single-csv.writer.ts) |
| `writeChunk` | hook | `writeChunk(out: Writable, chunk: string \| Uint8Array): Promise<void>` | Write with backpressure inside a writer or a document exporter | experimental | [example](../../../../apps/api/src/examples/exports/example-single-csv.writer.ts) |
| `endStream` | hook | `endStream(out: Writable): Promise<void>` | End the output and wait until it finished (the writer contract) | experimental | [example](../../../../apps/api/src/examples/exports/example-markdown.exporter.ts) |
| `ExporterRegistry` | registry | `class ExporterRegistry<TDoc> { register; get; all; formats }` | Render one document type into several formats (kvox's transcripts and notes) | experimental | [example](../../../../apps/api/src/examples/exports/example-markdown.exporter.ts) |
| `optionsSchemaFor` | hook | `optionsSchemaFor(fields: readonly ExportOptionField[]): ExportOptionsSchema` | Derive a document exporter's strict options schema from its declared fields | experimental | [example](../../../../apps/api/src/examples/exports/example-markdown.exporter.ts) |
| `hashExportRequest` | hook | `hashExportRequest(input: { format; version; options; contentFingerprint? }): string` | Reuse an already-rendered document: the request's identity | experimental | [example](../../../../apps/api/src/examples/exports/example-markdown.exporter.ts) |
| `EXPORTS_SYSTEM_DATA` | token | `unique symbol` -> `ExportsSystemData` | Bind the app's bypass client (`asSystem(reason)`) | experimental | [example](../../../../apps/api/src/platform/exports/exports-host.module.ts) |
| `EXPORTS_NOTIFIER` | token | `unique symbol` -> `ExportsNotifier` | Bind the app's notification dispatch for `export.ready` / `export.failed` | experimental | [example](../../../../apps/api/src/platform/exports/exports-host.module.ts) |
| `EXPORT_READY_EVENT` | registry | `ExportNotificationEventDef` | Register `export.ready` with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/exports/exports.notifications.ts) |
| `EXPORT_FAILED_EVENT` | registry | `ExportNotificationEventDef` | Register `export.failed` with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/exports/exports.notifications.ts) |
| `exportReadyBrowserTemplate` | hook | `exportReadyBrowserTemplate(data: ExportNotificationData): ExportBrowserContent` | The bell row and push of `export.ready` | experimental | [example](../../../../apps/api/src/platform/exports/exports.notifications.ts) |
| `exportFailedBrowserTemplate` | hook | `exportFailedBrowserTemplate(data: ExportNotificationData): ExportBrowserContent` | The bell row and push of `export.failed` | experimental | [example](../../../../apps/api/src/platform/exports/exports.notifications.ts) |
| `EXPORTS_APP_METRICS` | registry | `readonly AppMetricDef[]` | Register the three export metrics with the app's metric registry | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `exportsConformanceSuite` | registry | `ConformanceSuite<ExportsConformanceOptions>` | Run the exports invariants (`runPlatformConformance({ suites: { exports } })`) | experimental | [example](../../../../apps/api/test/exports/exports-conformance.spec.ts) |

### The source contract

`ExportSource<Req>`:
- `id`: permanent, kebab-case.
- `scope`: `'user'` or `'org'`.
- `label` and `description`.
- `permission`: the exact string the route enforces.
- `crossOrgPermission`: `org` scope only; lets a caller name another organization.
- `requestSchema`: zod. It is validated at the route AND when the job starts; make it `.strict()`.
- `fields`: optional. Otherwise the dialog's fields are derived from the schema (`requestFieldsOf`: `z.iso.date()` gives a date picker, `z.boolean()` a checkbox, `z.enum` a select, any other string a text box).
- `formats`: writer ids.
- `collect(ctx, req)`: an `AsyncIterable<ExportTable>`, read-only.
- `fileName?(ctx, req, ext)`: optional.

`ctx.db` is the bypass client: every query names its owner (`ctx.subjectId`) or organization explicitly, pages by id, and never writes. A table's `rows` is lazy: never load a whole table.

### The writer contract

`ExportWriter` has `id`, `label`, `mimeType`, `extension`, an optional `sources` and `write(tables, out, ctx)`. `write`:
- writes the whole file to `out` with backpressure (`writeChunk`) and ENDS it (`endStream`);
- settles only once `out` finished;
- on failure, rejects AND destroys `out` (`failStream`), so a half-written file never looks complete.

It never returns a buffer.

### PDF fonts (documentation only)

kvox's `pdf-fonts.ts` pattern for a domain PDF writer:
- commit the faces (Noto Sans covers Latin, Greek and Cyrillic) under the app's `assets/fonts`;
- resolve `FONT_DIR` relative to the compiled file, so `src/` and `dist/` agree and no environment variable is needed;
- add a `COPY` of the directory to the API image's production stage, with a test asserting it (the image builds green and throws on the first PDF otherwise);
- document CJK and right-to-left scripts as a limitation of pdfkit.

The platform ships no font files.

## Data

The slice owns no table and no migration.
- **The export is an `export.run` row of `jobs`.** Its `payload` is `{ source, format, request, requestedById, scope, subjectId, orgId, result? }`, and `result` is `{ storageObjectId, fileName, mimeType, sizeBytes, rowCounts, completedAt, expiresAt }`.
- **The file is an ordinary `storage_objects` row.** It sits in the organization `orgId`, is uploaded by the requester and carries `metadata.source: 'export'`, so the user-data reset's `files` category deletes it. Keys:
  - `exports/users/<userId>/<exportId>.<ext>`
  - `exports/orgs/<orgId>/<exportId>.<ext>`

  Two prefixes are registered: `exports-users` (scope `user`) and `exports-orgs` (scope `org`, so `orgKeyPrefixes(orgId)` lists an organization's exports for offboarding).
- **Status** is derived: `pending` or `running` from the job, while no result exists; `ready` when the result's object exists and `expiresAt` is ahead; `expired` when the result exists but the object is gone or past its expiry; `failed` otherwise.
- **`user-data` reads the user-owned registry.** Every model with a foreign key to `User` is registered there with an `export` policy (the `userOwnedData` tripwire fails otherwise). An owner model's rows are those where the owner field is the user; an actor-only model's are those where any actor field is (the audit events naming the user). `exportOmit` removes columns.
- **`org-data` reads the ownership registry.** It takes every `org` model, filtered on its organization field, unless the user-owned registry marks the model `exclude` (an organization's encrypted credentials).

## Permissions and settings

The slice declares no permission. The platform sources use existing ones: `user_settings:read` for `user-data`, `org_members:read` for `org-data` on the active organization, and `organizations:read` for `org-data` across organizations. Every route is `@Auth()`, and the service checks the source's permission against the caller's effective permissions (system grants plus the active organization's role). It reads no setting.

## UI

`@marinoscar/platform-web/exports`:
- `ExportDialog`, with the source's fields and its own form through `slots.form`;
- `ExportsList`;
- `DataExportPage`;
- the `dataExportSettingsPage` card ("Download your data", `/settings/data-export`, no permission).

## Infra

None. No compose fragment and no environment variable: the options above are code, and storage is the runtime-configured provider.

## Observability

- **Metrics**, registered through otel-core (`EXPORTS_APP_METRICS`):
  - `app.exports` (counter; attributes `source`, `format`, `outcome` `completed|failed`);
  - `app.export.duration` (histogram, seconds);
  - `app.export.size` (histogram, bytes).

  No user or organization id on any label.
- **Span attributes** on the job's span: `export.source`, `export.format`, `export.size_bytes`.
- **Logs** carry ids, formats, byte and row counts only: never a value, a file name or a URL.
- **Audit.** `export:create` (target type `export`, target id the export id, `meta` with source, format, scope, row counts and size), written after the commit.
- **Bypass client.** Its acquisitions record `db.access.reason` `export` or `purge`.

## Security notes

- **The data boundary is the user-owned registry.**
  - Only `export: 'include'` models leave the server.
  - Columns are the model's scalar fields minus `exportOmit`, minus `Bytes`, and minus the DEFAULT REDACTION RULE: `secret`, `tokenHash`, `token_hash`, `password`, `hint`, and any name ending in `Secret`, `Hash`, `Ciphertext` or `Salt`. A registry entry cannot lower that floor.
  - Credential models are `exclude` or list metadata only. The columns are also the query's `select`, so a redacted value never leaves the database.
- **The proof** is the `exports` conformance suite's `secret-egress` case, plus `apps/api/test/exports/exports.db.spec.ts`. The suite fills every model with sentinels and runs every writer, unzipping the zips; the db spec does the same against real Postgres with real credentials.
- **Formula injection.** CSV text cells are formula-neutralised; numbers are not. XLSX cells are typed (exceljs never writes a string as a formula).
- **Signed URLs** are minted only by `GET /api/exports/:id` of a `ready` export. They last 5 minutes, with `Content-Disposition: attachment`. The file name must match `EXPORT_FILE_NAME_PATTERN` before it goes in a header. The URL is never logged or stored.
- **Not found, not forbidden.** Someone else's export is a `404`, never a `403`. A failed export shows a fixed message, never `lastError`.
- **Server-only.** `export.run` reads several tables through the bypass client mid-computation, and its input is a person's or an organization's whole record; `export.purge` deletes objects. Neither carries `nodeResultSchema` or `persistNodeResult`.
- **Bypass client.** `org-data` reads through it with an EXPLICIT `orgId` filter on every query, so row-level security neither hides the organization's rows nor shows another's.

## Conformance suite

Importing `@marinoscar/platform-api/exports/testing` registers `exports`:

```ts
runPlatformConformance({ suites: { exports: { datamodel: Prisma.dmmf.datamodel, permissions: permissionRegistry.list() } } });
```

Cases:
1. **registry**: every source names a registered permission (and cross-organization permission) and offers a registered writer; a writer limited to sources names registered ones.
2. **policy**: every user-owned model exists in the datamodel, and its `exportOmit` names real fields.
3. **secret-egress**: no forbidden sentinel in any output of `user-data` or `org-data`, with every writer. The fake client ignores `select`, so this holds even for a client that returns every column.

The `cron-enqueue-only` suite scans this slice's source root (`apps/api/test/jobs/cron-source-roots.ts`): `ExportPurgeTask` only enqueues. `job-type-snapshot.spec.ts` pins both job types.

## Upgrade notes

New in #744. Adoption by EvoPath:
- register `health` with `registerExportSource` (permission `health_data:read`; its request `from`, `to`, `datasets`, `includeHistory`, `labUnits`);
- drop its own JSON, CSV and XLSX writers for the built-ins;
- register its PDF as a writer with `sources: ['health']`;
- pass `legacyJobTypes: [{ type: 'health.export', handles: 'run', toPayload }, { type: 'health.export.purge', handles: 'purge' }]`, so rows of the old types keep a handler.

Its legacy `exports/<userId>/…` objects sit under the purge's root (`exports/`) and expire within the retention period. Its `health.export_ready` and `health.export_failed` events stay registered while it keeps its own routes. kvox imports `Exporter`, `ExporterRegistry`, `optionsSchemaFor` and `hashExportRequest` from here (same shapes).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `POST /api/exports` answers 400 "has no format" | The source's `formats` names a writer that is not registered, or a writer limited to other sources | Register the writer; check its `sources` |
| `403 This credential has no active organization` | A user export needs the active organization to own the file's row | Sign in with an organization (every user has the default one in `single` mode) |
| An export stays `pending` | No worker is running, or the queue is backed up | `/admin/jobs`; the Doctor's jobs checks |
| An export is `failed` | The job threw on its last attempt (storage unreachable, a source error) | The job's `lastError` in the jobs console; the user sees only the fixed message |
| A dataset is missing from `user-data` | The model is `export: 'exclude'`, or absent from the datamodel passed to `forRoot` | Change its user-owned registry entry; pass `Prisma.dmmf.datamodel` |
| `RegistryError FROZEN` when registering a source | Registration ran after bootstrap | Register from a manifest imported before `forRoot` (`app-registrations/exports.ts`) |

## Links

- [Package README](../../README.md)
- [Data export spec](../../../../docs/specs/data-export.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
- Contract: [`@marinoscar/platform-contract/exports`](../../../platform-contract/src/exports/README.md). Web: [`@marinoscar/platform-web/exports`](../../../platform-web/src/exports/README.md).
