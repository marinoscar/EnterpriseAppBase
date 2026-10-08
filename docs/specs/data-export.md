# Data export

> **Status:** shipped (#744, PP-9.2) · **Code:** `@marinoscar/platform-api/exports` ([README](../../packages/platform-api/src/exports/README.md)), `@marinoscar/platform-web/exports/{headless,ui}` ([README](../../packages/platform-web/src/exports/README.md)), `@marinoscar/platform-contract/exports` ([README](../../packages/platform-contract/src/exports/README.md)); the reference app's binding: `apps/api/src/platform/exports/`, `apps/api/src/app-registrations/exports.ts`, `apps/api/src/examples/exports/` · **API:** `GET /api/exports/sources`, `POST /api/exports`, `GET /api/exports`, `GET /api/exports/:id` (tag `Exports` in `/api/docs`) · **Jobs:** `export.run`, `export.purge` · **UI:** `/settings/data-export` · **Recipe:** [§4](#4-extending-it-in-an-app)

The platform could not answer "give me my data" (a GDPR or CCPA access request) or "give us our organization's data before we leave". Two apps had each solved half of it:
- **EvoPath's `health-export/`**: job-based files with JSON, CSV-zip, XLSX and PDF writers, signed downloads and a daily expiry purge, plus `common/export/csv.ts`.
- **kvox's `export/`**: a generic `Exporter<TDoc>` / `ExporterRegistry<TDoc>` with a streaming render and declarative options.

This is one framework for both shapes, with the domain parts left to the apps.

## 1. Purpose

**What it is.**
- A user downloads a copy of everything the application stores about them.
- An organization's administrator downloads the organization's data, the first step of offboarding ("export, then purge the org").
- An app adds its own domain exports (EvoPath's health record, kvox's transcripts) as sources and writers, and gets the queue, storage, signed download, expiry, notifications, audit and metrics for free.

**What it is not.**
- Not an import or round trip.
- No file bytes in the user export: `storage_object` is a manifest; "with files" is a future seam.
- No PDF writer: every PDF in the apps is domain layout.
- Not a synchronous download (see §6).

### 1.1 Design principles

- **The registry is the data boundary.** The user-owned registry (#688/#699) already records an `export` policy for every model with a `User` relation; `user-data` is that policy, executed. A new model with a `User` relation cannot be added without a decision (the `userOwnedData` tripwire), so it cannot be silently left out of, or silently included in, an export.
- **Redaction has a floor.** Whatever an entry says, a column named like a secret never leaves the database.
- **Streaming is mandatory.** No component may hold a whole table or a whole file: sources page, writers honour backpressure, the upload consumes the stream as it is produced.
- **No export table.** The job row already carries the status, the subject and the payload (EvoPath's design).

## 2. How it works

### 2.1 Request, job and file

1. **Request.** `POST /api/exports { source, format, request, orgId? }`. The route is `@Auth()`; the service checks the source's permission, validates `request` with the source's zod schema, and checks the in-flight cap. It then enqueues `export.run` with `skipDedup` and answers `202` with the export (`pending`).
   - Subject `user:<userId>` for a `user` source, `organization:<orgId>` for an `org` source.
   - The cap is 3 pending or running per subject; the fourth is a `429`.
2. **Job.** `export.run` runs on a worker slot. It re-validates the request and asks the source for its tables, then streams the writer's output through a byte counter into `STORAGE_PROVIDER.upload`. In ONE transaction (the file's organization scope) it upserts the `storage_objects` row and writes `payload.result` on the job. After the commit it audits `export:create`, records the metrics and notifies `export.ready`.
3. **Keys.**
   - `exports/users/<userId>/<exportId>.<ext>`
   - `exports/orgs/<orgId>/<exportId>.<ext>`

   Both prefixes are registered (`exports-users`, user-scoped; `exports-orgs`, org-scoped, so `orgKeyPrefixes(orgId)` lists an organization's exports).
4. **Retry and failure.** The key is derived from the job id, so a retry overwrites the same object. A failure deletes what was written (best effort) and rethrows. On the last attempt (default 2), `export.failed` is sent.
5. **Download.** `GET /api/exports/:id` derives the status. While `ready`, it mints a signed GET valid for `downloadUrlTtlSeconds` (300), with `Content-Disposition: attachment; filename="<name>"`, after checking the name against `EXPORT_FILE_NAME_PATTERN`. The URL is never logged or stored.
6. **Expiry.** A daily `@Cron` (03:00) enqueues `export.purge` through `enqueueHousekeepingJob`. The purge deletes every `storage_objects` row under `exports/` older than `retentionDays` (7): the bytes first, then the row. A provider failure keeps the row; the run finishes the rest, then fails so the queue retries.

### 2.2 Status

| Status | When |
|---|---|
| `pending`, `running` | the job's own status, while no result is recorded |
| `ready` | `payload.result` is set, its object exists and `expiresAt` is in the future |
| `expired` | the result is set but the object is gone or past its expiry |
| `failed` | otherwise (the job settled without a result); the view carries a fixed message, never `lastError` |

### 2.3 The platform sources

**`user-data`.**
- The `account` dataset (the caller's `User` row).
- Then one dataset per registry entry with `export: 'include'`, in registry order, named after the model in snake_case:
  - for an **owner** model, the rows whose owner field is the user;
  - for an **actor-only** model, the rows where any actor field is the user (the audit events naming them).
- Columns come from the datamodel's scalar fields (`Prisma.dmmf.datamodel`, passed to `forRoot`), minus `exportOmit`, minus `Bytes`, minus the default redaction rule.
- It reads through the bypass client with an explicit owner filter, because the user's rows sit in every organization they belong to.

**`org-data`.**
- The `organization` row and `members` (user id, email, role, status, joined).
- Then every model of kind `org` in the ownership registry (#725), filtered on its organization field, unless the user-owned registry marks the model `exclude` (an organization's encrypted credentials).
- It reads through the bypass client with an EXPLICIT `orgId` filter on every query, so row-level security neither hides the organization's rows nor shows another organization's.
- Permission `org_members:read` for the active organization (its administrators). A system administrator's `organizations:read` lets the caller name another organization with `orgId`.

### 2.4 Writers

- **`json`**: `{ schemaVersion: 1, source, exportedAt, datasets: { <name>: { title, columns, rows } } }` (`exportJsonFileSchema`), streamed row by row.
- **`csv`**: a zip (archiver) of `<dataset>.csv`, one entry at a time. Each file is RFC 4180 with a UTF-8 BOM and CRLF. Text cells a spreadsheet would read as a formula are prefixed with `'`; numbers are left alone.
- **`xlsx`**: exceljs' streaming workbook, one sheet per dataset with a bold, frozen header of labels, cells typed.

The writer contract (kvox's): write to `out` with backpressure, END it, settle when it finished, and on failure reject AND destroy it.

### 2.5 Redaction

A column is exported only if every one of these holds:
1. It is a scalar or enum field (relations are other datasets).
2. It is not `Bytes` (binary is ciphertext or a blob).
3. It is not in the entry's `exportOmit` (the story's `exportRedact`).
4. It is not named `secret`, `tokenHash`, `token_hash`, `password` or `hint`, and does not end in `Secret`, `Hash`, `Ciphertext` or `Salt`.

The columns are also the query's `select`. Credential models are either `exclude` (refresh tokens, device codes, push subscriptions, node credentials) or list metadata only (personal access tokens, AI keys, BYOK credentials).

### 2.6 Document exporters

`Exporter<TDoc>` and `ExporterRegistry<TDoc>` render ONE document into several formats, with options declared once (`optionsSchemaFor` gives the strict schema, the field list gives the dialog). `hashExportRequest` gives the identity a stored render is reused by. They carry the same streaming contract. They are primitives: an app that wants a document as a job-based export wraps it in a source and a writer limited to that source.

### 2.7 Web

- `DataExportPage` at `/settings/data-export`, the "Download your data" card in a "Your data" group, with no permission. The page offers every source `GET /api/exports/sources` returns for the caller, so an organization administrator also sees `org-data`.
- `ExportDialog` draws each source's request fields from its descriptor; a source may supply its own form (`slots.form`).
- `ExportsList` shows the status in words and downloads from a fresh signed URL, fetched at click time.

## 3. Configuration and permissions

`ExportsModule.forRoot({ datamodel, appSlug?, retentionDays = 7, downloadUrlTtlSeconds = 300, maxInFlightPerSubject = 3, pageSize = 500, jobProfile = { 15 min, 2 }, purgeProfile = { 30 min, 3 }, platformSources?, legacyJobTypes?, imports })`.

These are code options, not environment variables or system settings, as in EvoPath: they are product decisions. No new permission:

| Source | Permission | Notes |
|---|---|---|
| `user-data` | `user_settings:read` | every role holds it |
| `org-data` | `org_members:read` | the active organization; `org_admin` holds it |
| `org-data` (another organization) | `organizations:read` | the system `admin` role |

`GET /api/exports/sources` lists only the sources the caller may use. An export is visible to the user who asked for it, a user export also to its subject, and an organization export to anyone who may export that organization now. Anything else is a `404`.

Notifications: `export.ready` and `export.failed`, on the `browser` and `push` channels, on by default, not mandatory, sent to the requester after the commit.

## 4. Extending it in an app

### 4.1 Add a source

Declare it in `app-registrations/exports.ts` (`APP_EXPORT_SOURCES`); the manifest registers it. Requirements:
- a permanent kebab-case `id`;
- a `scope`;
- the exact `permission` the route should enforce;
- a strict zod `requestSchema`;
- `formats`;
- `collect(ctx, req)`, which yields `ExportTable`s whose `rows` page `ctx.db` by id with an explicit `ctx.subjectId` filter.

The reference example is `apps/api/src/examples/exports/example-notification-inbox.source.ts` (a date range and a checkbox, drawn by the dialog).

### 4.2 Add a format

Add an `ExportWriter` to `APP_EXPORT_WRITERS`. Use `writeChunk`, `endStream` and `failStream`, and the CSV helpers for any CSV. Limit a domain format to its source with `sources: ['health']`. The reference example is `example-single-csv.writer.ts`.

### 4.3 Render documents

Subclass `ExporterRegistry<TDoc>` per document type and declare each `Exporter<TDoc>` with `optionsSchemaFor`; see `example-markdown.exporter.ts`.

### 4.4 Change what `user-data` contains

Edit the model's user-owned registry entry: set `export: 'include'` or `'exclude'`, and list columns to drop in `exportOmit`. Never edit the source.

### 4.5 Seams per app at adoption

| App | Today | At adoption |
|---|---|---|
| EvoPath | `health.export`, `health.export.purge`, `/api/health/exports`, its JSON, CSV, XLSX and PDF writers, `common/export/csv.ts`, the `exports/` prefix, `health.export_ready` and `health.export_failed` | `registerExportSource({ id: 'health', scope: 'user', permission: 'health_data:read', … })`; the built-in writers replace its own; its PDF registers with `sources: ['health']`; `legacyJobTypes: [{ type: 'health.export', handles: 'run', toPayload }, { type: 'health.export.purge', handles: 'purge' }]`; its routes stay as thin app routes or redirect |
| kvox | `ExporterRegistry<TDoc>` for transcripts and notes, `hashExportRequest` | import `Exporter`, `ExporterRegistry`, `optionsSchemaFor` and `hashExportRequest` from the package (same shapes); optionally register transcript and note sources for job-based exports |
| MemoriaHub | none | `user-data` for free; media sources later |

## 5. Guardrails

| Guardrail | Proves |
|---|---|
| `exports` conformance suite (`apps/api/test/exports/exports-conformance.spec.ts`) | Every source names a registered permission and offers a registered writer; `exportOmit` names real fields. `secret-egress` fills every model with sentinels and runs both platform sources through every writer, unzipping: no secret, hash, hint, ciphertext or binary byte, and no column of an excluded model, in any output |
| `apps/api/test/exports/exports.db.spec.ts` | The same over real Postgres with row-level security and real credentials; org-data with two organizations returns only the exported organization's rows; the purge, then `expired` |
| `packages/platform-api/test/exports/streaming.spec.ts` | 100k rows through each writer keep the retained heap under 50 MB while a larger file flows |
| `cron-enqueue-only` | `ExportPurgeTask` only enqueues (the slice's root is scanned) |
| `job-type-snapshot.spec.ts` | `export.run` and `export.purge` are registered and labelled |
| `system-injection-boundary.spec.ts` | `platform/exports/exports-host.module.ts` is the one reviewed binding of the bypass client, with reasons `export` and `purge` |
| `storage-key-prefixes.spec.ts` | Both export prefixes are registered, so the storage purge reaches them |
| `userOwnedData` (#688) | Every model with a `User` relation has an export policy |

## 6. Design decisions

- **No export table.** Rejected, following EvoPath: the job row already carries the status, the subject and the payload, and a second table would need its own retention and reset handling.
- **No synchronous streamed HTTP download.** Rejected: large exports outlive a request, and CLAUDE.md's queue rule makes them jobs. Signed URLs also keep database-sized responses out of nginx and the API (the reasoning of backup downloads).
- **No PDF writer.** Every PDF in the apps is domain layout. The `pdf-fonts` pattern is documented in the package README instead.
- **Two prefixes, not one.** `exports/users/` (user-scoped) and `exports/orgs/` (org-scoped) follow the key-prefix scopes of #736, so offboarding lists an organization's exports without a scan. The purge selects rows under the shared root `exports/`, which also covers an adopting app's legacy keys.
- **The bypass client, with explicit filters.** A user's own rows sit in several organizations, and an organization export must see all of that organization's rows whoever's scope is active. Every query names the owner or the organization, and the `export` access reason makes each acquisition visible on the span.
- **The permission is the source's.** One route serves sources with different permissions, so the route is `@Auth()` and the service checks the source's string against the caller's effective permissions. A 403 names that permission.
- **`exportOmit`, not a new `exportRedact` field.** The user-owned registry already had `exportOmit` (#688) with exactly the story's meaning; a second field for the same thing would be two sources of truth.
- **Status and URL derived at read time.** A ready export's URL is minted per read and never stored, so a leaked list response carries no download.

## 7. Verification

```bash
npm run typecheck --workspace=api && npm run typecheck --workspace=web
npx jest --config ./packages/platform-api/test/jest.config.js packages/platform-api/test/exports
cd apps/api && npx jest --config ./test/jest.config.js test/exports src/examples/exports
cd apps/api && npm run test:db -- test/exports        # real Postgres
cd apps/web && npx vitest run src/__tests__/platform/exports.test.tsx
npm run openapi:dump && npm run openapi:lint
```

## 8. Open seams

- **The offboarding precondition.** Offboarding an organization (#743) will require "an `org-data` export completed in the last 7 days" through its `OffboardingPrecondition` registry. That registry had not merged when this framework did, so the registration is a follow-up, wired by whichever of the two lands second.
- **The telemetry export's CSV.** The telemetry slice keeps its internal copy of the CSV helpers until it exposes a seam to take this slice's (a slice may only import the slices it lists in `packages/platform-slices.json`).
- **An action on the organization pages.** Organization administrators export from "Download your data", which offers them `org-data`. A button on the packaged Organization page (#726) needs a slot there.
- **Files in the user export.** `storage_object` is a manifest; including the bytes ("with files") is a seam request.

## History

- #744 (PP-9.2): the framework, harvested from EvoPath's health export and kvox's exporters.
