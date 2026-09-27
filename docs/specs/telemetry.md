# Telemetry (GreptimeDB + Telemetry Explorer)

> **Status:** shipped · **Code:** `apps/api/src/telemetry/`, `apps/api/src/common/otel/telemetry-gate.ts`, `apps/web/src/pages/Admin/TelemetrySettingsPage.tsx`, `TelemetryExplorerPage.tsx` · **API:** `/api/telemetry/config`, `/api/admin/telemetry/*` (see `/api/docs`) · **Admin UI:** `/admin/settings/telemetry`, `/admin/settings/telemetry/explorer` · **Runbook:** [telemetry.md](../runbooks/telemetry.md)

This is a two-container overlay — an OTel Collector in front of a GreptimeDB
standalone instance — replacing the earlier Uptrace/ClickHouse/Redis stack.
Admins query telemetry with SQL, export the results, and ask an AI assistant
about them. The application's own PostgreSQL database takes no telemetry
load: traces, logs and metrics live in GreptimeDB alone.

## Decision record

### Options considered

| Option | Containers | OTLP ingest | Retention | SQL + read-only user | Maturity | License |
|---|---|---|---|---|---|---|
| Uptrace (today) | Uptrace + ClickHouse + Redis (3) | Native | ClickHouse TTL, per table | ClickHouse SQL; no built-in read-only role | Mature | BSL (Uptrace), Apache-2.0 (ClickHouse) |
| ClickHouse + collector | Collector + ClickHouse (2) | Via `clickhouseexporter` | `TTL` per table | Full SQL; `READONLY` user profile | Mature, best operational guardrails | Apache-2.0 |
| DuckDB + Parquet | Collector + a writer process (2+) | No mature OTLP→Parquet path | File lifecycle, manual | DuckDB SQL over Parquet; no server, no user model | Early-stage | MIT |
| OpenObserve | OpenObserve (1) | Native | Built-in retention | Its own query language plus a full UI | Mature | AGPL-3.0 |
| SQLite | Collector + SQLite file (2) | No collector exporter | Manual | SQL; single writer, no server-side user model | Mature as a library, not as a telemetry store | Public domain |
| **GreptimeDB** | **Collector + GreptimeDB standalone (2)** | **Native (OTLP/HTTP, protobuf)** | **Database-level `TTL`, inherited by tables** | **Postgres wire protocol; built-in read-only user** | **Maturing (v1.2.1 tested)** | **Apache-2.0** |

### Decision

GreptimeDB is the choice. It ingests OTLP natively, needs only one container
beside the collector, speaks the PostgreSQL wire protocol (so the API reuses
`pg`, the client already in the dependency tree, instead of adding a new
driver), and ships a database-level `TTL` and built-in read-only users out of
the box, so the read-only query surface and the retention policy need no
application-level enforcement. It is Apache-2.0, with no AGPL or BSL
obligation on this repository.

### Rejected alternatives

- **ClickHouse + collector.** Kept as the fallback if GreptimeDB proves
  unworkable in practice: it has the best operational guardrails of any
  option (mature `READONLY` profiles, well-understood `TTL`), but it is
  heavier to run (roughly 1–2 GB RAM once tuned) for a template whose default
  path should stay light, and it does not reduce the container count versus
  GreptimeDB.
- **DuckDB + Parquet.** No mature OTLP→Parquet ingest path exists today:
  `duckdb-otlp`-style writers are early-stage with no write-ahead log, and the
  collector's own `fileexporter` is alpha and only emits JSON or raw proto,
  not Parquet. A workable pipeline would also need its own small-files
  compaction job, which is infrastructure this template would have to own.
- **OpenObserve.** AGPL-3.0, which this template avoids taking on as a
  dependency, and it ships a full UI that would duplicate the Telemetry
  Explorer this project wants to own.
- **SQLite.** Single-writer, and no collector exporter accepts OTLP into it
  directly; every option built on it needs a bespoke ingest process.

## Spike findings

Verified live on 2026-09-27 against `greptime/greptimedb:v1.2.1`
(standalone) and `otel/opentelemetry-collector-contrib:0.145.0`.

### Versions

| Component | Version | Note |
|---|---|---|
| GreptimeDB | v1.2.1 | Standalone mode |
| OTel Collector | collector-contrib 0.145.0 | |
| `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http` | 0.221.x / 0.222.0 | Pin `^0.221.0` to match the existing `@opentelemetry/sdk-node ^0.221.0` |
| `@uiw/react-codemirror`, `@codemirror/lang-sql` | 4.25.x / 6.10.x | Web SQL editor for the Telemetry Explorer |
| `pg` (node-postgres) | already in the API's dependencies | Reused for the Postgres wire protocol connection |

### Starting GreptimeDB

Standalone start command, tested:

```
standalone start --http-addr 0.0.0.0:4000 --rpc-bind-addr 0.0.0.0:4001 \
  --mysql-addr 0.0.0.0:4002 --postgres-addr 0.0.0.0:4003 \
  --user-provider='static_user_provider:cmd:admin=<pw>,writer=<pw>,reader:readonly=<pw>'
```

- `GET /health` on port 4000 returns `{}` with HTTP 200; use it as the
  container healthcheck.
- GreptimeDB otherwise phones home for its own usage telemetry, which logs a
  TLS error in a network-restricted environment. Set
  `GREPTIMEDB_STANDALONE__ENABLE_TELEMETRY=false` to disable it (verified:
  the running config then shows `enable_telemetry: false`).
- Data is written under `/greptimedb_data`; that path is where the named
  volume mounts.

### Ingest: collector to GreptimeDB

- GreptimeDB's OTLP endpoint accepts **protobuf only**. The collector's
  `otlphttp` exporter already sends protobuf, so no extra configuration is
  needed on that side.
- Exporter endpoint: `http://greptimedb:4000/v1/otlp`, with headers
  `Authorization: Basic base64(writer:pw)` and
  `X-Greptime-DB-Name: public`.
- **Traces need an additional header**, `x-greptime-pipeline-name:
  greptime_trace_v1`; without it GreptimeDB answers HTTP 400. Traces
  therefore need their own exporter (`otlphttp/greptime_traces`) carrying
  that header; logs and metrics share a second exporter
  (`otlphttp/greptime`) with no pipeline header.
- Basic auth is done through the collector's `basicauth/greptime` extension
  (`client_auth: {username: ${env:GREPTIME_WRITER_USER}, password:
  ${env:GREPTIME_WRITER_PASSWORD}}`), listed in `service.extensions` and
  referenced as `auth: {authenticator: basicauth/greptime}` on both
  exporters.
- Redaction works ahead of ingest: an `attributes` processor with `action:
  delete` on `http.request.header.authorization` stops that column from
  ever being created.

### Tables and column naming

Tables are created on first write, with no schema migration step:

- **`opentelemetry_traces`**: `timestamp` (`TIMESTAMP(9)`, the time index),
  `timestamp_end`, `duration_nano` (`UInt64`), `parent_span_id`, `trace_id`,
  `span_id`, `span_kind` (e.g. `SPAN_KIND_SERVER`), `span_name`,
  `span_status_code` (`STATUS_CODE_ERROR` / `STATUS_CODE_OK` /
  `STATUS_CODE_UNSET`), `span_status_message`, `trace_state`, `scope_name`,
  `scope_version`, `service_name` (tag), `span_events` (`Json`),
  `span_links` (`Json`). Two helper tables,
  `opentelemetry_traces_services` and `opentelemetry_traces_operations`,
  are created alongside it.
- **`opentelemetry_logs`**: `timestamp`, `trace_id`, `span_id`,
  `severity_text`, `severity_number`, `body` (full-text indexed),
  `log_attributes` (`Json`), `trace_flags`, `scope_name`, `scope_version`,
  `scope_attributes` (`Json`), `resource_attributes` (`Json`),
  `resource_schema_url`.
- **Metrics** land in Prometheus-style tables, one per metric name, created
  on first export (not exercised in the spike).
- **Span and resource attributes are flattened into their own columns**,
  named `span_attributes.<key>` and `resource_attributes.<key>` (for
  example `span_attributes.http.route`). New columns are created
  dynamically as new attribute keys arrive. Because the column name
  contains dots, **SQL referencing it must double-quote the identifier**,
  e.g. `SELECT "span_attributes.http.route" FROM opentelemetry_traces`.

### PostgreSQL wire protocol (port 4003) with `pg`

- `SELECT version()` returns `PostgreSQL 16.3 GreptimeDB 1.2.1`; connecting
  to database `public` works with an ordinary `pg` client.
- Subquery wrapping is syntactically accepted for arbitrary user SQL,
  including a `WITH`/CTE inside the subquery: `SELECT * FROM (<user sql>) AS
  q LIMIT n`. On GreptimeDB v1.2.1 that wrapper, and a CTE wrapper,
  deterministically dropped the inner `ORDER BY`, including for `UNION ALL
  … ORDER BY`, so the row cap cannot be applied this way.
- **Bind parameters fail.** `$1`-style placeholders error with `Placeholder
  '$1' was not provided a value`; parameterised queries cannot be used.
  Identifiers (e.g. a table name for `describe_table`) must instead be
  checked against the table list read from `information_schema.tables`,
  then quoted by hand (`` `"` + name.replace(/"/g,'""') + `"` ``).
- **Multi-statement strings execute every statement.** The simple protocol
  returns an array of results for a semicolon-separated string. Any API
  built on this connection must reject a query containing more than one
  statement itself; GreptimeDB will not refuse it.
- **Type OIDs** arrive in `fields[].dataTypeID`: `1043` = varchar, `20` =
  int8, `1700` = numeric (a `UInt64` column reports as numeric), plus the
  timestamp OIDs. Values for int8 and numeric columns come back as strings,
  which must be kept as strings through to JSON so large values (byte
  counts, durations) never lose precision.
- **Schema discovery** works for the read-only user via
  `information_schema.columns` (`table_name`, `column_name`, `data_type`)
  and `information_schema.tables` (`table_name`, `table_rows`).
- **`statement_timeout` cannot be used**: the read-only user gets `User is
  not authorized to perform this action` on `SET statement_timeout`, and
  passing it as a startup parameter is silently ignored (`SHOW
  statement_timeout` still reports `0ms`). Timeouts must therefore be
  enforced **client-side** — `pg`'s `query_timeout` option, or a
  `Promise.race`, followed by destroying the connection on timeout. Killing
  the query server-side (through the admin user) is a follow-up, not
  covered by this spike.

### Read-only user enforcement

The `reader:readonly` user can `SELECT`, `SHOW` and `DESCRIBE`, and can read
`information_schema`. It is refused, each with `User is not authorized to
perform this action`, on `INSERT`, `DROP`, `ALTER DATABASE` and `SET`. This
enforcement is server-side and needs no additional guard in the API beyond
using that role for every user-supplied query.

### Retention (TTL)

- `ALTER DATABASE public SET 'ttl'='7d'` works when run as the admin user;
  `SHOW CREATE DATABASE public` then reports `WITH(ttl = '7days')`.
- Existing tables inherit the database-level setting automatically: `SHOW
  CREATE TABLE opentelemetry_logs` also shows `ttl = '7days'`. One
  database-level `TTL` therefore covers every table, including ones a
  future OTLP export creates later. Accepted formats include `'7d'`,
  `'30d'` and `'365d'`.

### Export libraries

- **Parquet: `hyparquet-writer`** (0.16.x), chosen for being pure
  JavaScript with no WASM dependency and active maintenance.
  `parquetWriteBuffer({ columnData: [{ name, data: [], type:
  'STRING'|'DOUBLE'|'INT64'|'BOOLEAN'|'TIMESTAMP'|'JSON' }] })` returns an
  `ArrayBuffer`. Its output was verified readable by DuckDB, nulls
  included (`duckdb.sql("select * from 'x.parquet'")`). The package is
  **ESM-only**; from CJS NestJS code it must be loaded with `await
  import('hyparquet-writer')` (Node 24 also supports `require(esm)`), and
  Jest needs a mock or a `moduleNameMapper` entry for it.
- **XLSX: `exceljs` 4.4.0.** Its streaming `WorkbookWriter` supports writing
  directly to a stream, avoiding buffering a whole workbook in memory.

### Consequences for the design

- The API's telemetry query path must cap rows with a `LIMIT` added at the
  statement's own top level, never by wrapping it in a subquery (which drops
  the inner `ORDER BY`), and never as a parameterised `pg` query;
  identifiers that need interpolation must be validated against
  `information_schema` first, then quoted, never bound.
- The query endpoint must reject any input containing more than one SQL
  statement before sending it to GreptimeDB, since the wire protocol will
  otherwise execute all of them.
- Query timeouts are the API's responsibility (`pg`'s `query_timeout` plus
  connection teardown), not a setting pushed into GreptimeDB.
- Any UI or export code that lists span or resource attribute columns must
  double-quote the flattened `span_attributes.<key>` / column names, and
  must treat their set as dynamic (new attributes add new columns over
  time).
- Numeric values wide enough to touch `UInt64` (byte counts, nanosecond
  durations) must be carried as strings end-to-end, matching the existing
  `BigInt`-as-decimal-string convention used for `database_backup_runs`
  (see [database-backup.md](database-backup.md)).
- The collector configuration needs two OTLP exporters against GreptimeDB
  (one for traces, carrying the pipeline header; one shared by logs and
  metrics), both authenticated through a `basicauth` extension, not one
  shared exporter.
- Retention is a single `ALTER DATABASE … SET 'ttl'` operation run once
  (or on policy change), not a per-table setting the application must keep
  in sync.
- The read-only SQL role enforced by GreptimeDB itself is the trust
  boundary for the Telemetry Explorer's query surface; the API does not
  need to reimplement statement-type filtering on top of it, only the
  single-statement and timeout guards above.
- Export (Parquet, XLSX) is client-library work in the API process, not a
  GreptimeDB feature; both chosen libraries stream or return in-memory
  buffers small enough for typical query result sizes, consistent with the
  no-buffering discipline the backup engine already follows for larger
  transfers.

## 1. Architecture

```
API (OTel Node SDK)
  │ OTLP/HTTP, gated by telemetryGate (see §2)
  ▼
otel-collector                                          (infra/otel/otel-collector-config.yaml)
  │ memory_limiter → attributes/redact → batch
  │   redact drops: http.request.header.authorization, http.request.header.cookie,
  │                 http.response.header.set-cookie, url.query
  │ basicauth/greptime (GREPTIME_WRITER_USER/PASSWORD)
  ├─ traces  → otlphttp/greptime_traces  (adds x-greptime-pipeline-name: greptime_trace_v1)
  └─ logs, metrics → otlphttp/greptime
  ▼
GreptimeDB standalone v1.2.1                             (infra/compose/telemetry.compose.yml)
  HTTP :4000 (ingest, /health, /dashboard) · Postgres wire :4003
  ▲
  │ Postgres wire protocol, GreptimeClient (apps/api/src/telemetry/greptime/greptime.client.ts)
  │   reader pool  (GREPTIME_READER_*) — explorer, assistant, status
  │   admin pool   (GREPTIME_ADMIN_*)  — retention ALTER DATABASE, SHOW CREATE DATABASE
  ▼
API (TelemetryModule) ──► Admin browser (explorer, assistant, settings)
```

`TelemetryModule` (`apps/api/src/telemetry/telemetry.module.ts`) wires:

- `GreptimeClient` — the only connection to the store (§2).
- `TelemetrySettingsService` — the `telemetry` settings namespace, its 5 s
  cache, and the export gate (§2).
- `TelemetryStatusService` — `GET /api/admin/telemetry/status`.
- `TelemetryRetentionHandler` + `TelemetryRetentionTask` — the retention job
  and its daily cron (§4).
- `TelemetryQueryService`, `TelemetrySchemaService`, `TelemetryExportService`
  — the explorer (§5).
- `TelemetryAssistantService` — the AI assistant (§6), built on `AiModule`.

Four controllers, all tagged `Telemetry` in the OpenAPI document:
`TelemetryConfigController` (public feature flag), `TelemetryAdminController`
(policy + status), `TelemetryExplorerController` (query/schema/export) and
`TelemetryAssistantController` (the SSE route).

GreptimeDB creates tables on first write, with no migration step: typically
`opentelemetry_traces` (spans), `opentelemetry_logs` (log records), and one
table per exported metric. Span, resource and log attributes are flattened
into their own columns whose names contain dots (`"span_attributes.http
.route"`, `"resource_attributes.service.name"`), created dynamically as new
attribute keys arrive — see the spike findings above for the full column
inventory and quoting rule.

## 2. The two switches

Two independent controls decide whether telemetry data ever leaves this
process, documented in full in `apps/api/src/common/otel/telemetry-gate.ts`:

1. **`OTEL_ENABLED`** (environment, infra). Read once by
   `apps/api/src/instrumentation.ts` before Nest exists: whether the
   OpenTelemetry SDK is installed in this process at all. It cannot change
   without a restart — auto-instrumentation only patches modules required
   after `sdk.start()`. `telemetry.compose.yml` sets it to `true` on the
   `api` service.
2. **`telemetry.enabled`** (system setting, admin UI). Whether what the
   installed SDK produces is actually exported. An administrator flips it at
   runtime with no restart.

The SDK keeps running either way — spans are still created, log records
still correlated, metrics still aggregated — and the gated exporters
(`GatedSpanExporter`, `GatedLogRecordExporter`, `GatedPushMetricExporter`)
simply drop each batch while the gate is closed, acknowledged as success so
nothing retries or logs an export error for it. The gate is read at export
time, not at creation time, so a batch queued while closed and flushed after
the gate opens is still sent.

**The gate starts closed.** Nothing leaves the process until settings have
been read and an administrator's choice is known.

`TelemetrySettingsService.refreshGate()` sets the gate to
`telemetry.enabled && GreptimeClient.isConfigured()` — both conditions,
because with no GreptimeDB there is nowhere for the collector to write. It
runs once on boot and every `TELEMETRY_GATE_REFRESH_MS` (5 s) after, so the
instance that served a `PUT` flips its own gate immediately and every other
instance in a fleet converges within one interval. A failed settings read
leaves the gate at its last value rather than flipping it either way.

## 3. Settings

The `telemetry` system-settings namespace (`systemTelemetrySchema`,
`apps/api/src/common/schemas/settings.schema.ts`), read and written through
`TelemetrySettingsService`:

| Field | Type | Range | Default |
|---|---|---|---|
| `enabled` | boolean | — | `false` |
| `retentionDays` | integer | 1–3650 | `30` |
| `query.maxRows` | integer | 1–100000 | `10000` |
| `query.timeoutSeconds` | integer | 1–120 | `30` |
| `assistant.enabled` | boolean | — | `false` |
| `assistant.provider` | string or `null` | — | `null` |
| `assistant.modelId` | string or `null` | — | `null` |
| `assistant.shareResults` | boolean | — | `true` |
| `assistant.maxResultRowsToModel` | integer | 1–100 | `100` |
| `assistant.maxSteps` | integer | 1–12 | `6` |

Everything ships off: a fresh deployment does not collect or retain
observability data nobody asked for merely because the namespace exists, the
same posture `databaseBackup.enabled` and `ai.enabled` take. `assistant` is a
second, narrower switch nested inside the namespace: `assistant.enabled`
answers "may an AI model be pointed at telemetry data", on top of `enabled`
answering "is telemetry collected at all". A compile-time check
(`TELEMETRY_SETTINGS_CARRIES_NO_SECRET`) fails the build if a field named
like a credential (`apiKey`, `password`, `token`, …) is ever added to this
namespace — the assistant's AI key is resolved through `AiKeyResolver`, per
call, and never stored here.

`GET`/`PUT /api/admin/telemetry/config` (`telemetry:read`/`telemetry:write`)
read and replace the namespace with the usual `If-Match` optimistic
concurrency. A successful `PUT` also enqueues a `telemetry.retention.apply`
job so a changed retention reaches GreptimeDB immediately rather than at the
next nightly run. `GET /api/telemetry/config` is the public feature flag
(`@Auth()`, no permission — any signed-in user, like `GET /api/ai/config`):
`available`, `enabled`, `assistantEnabled`, nothing else.

## 4. Retention

`telemetry.retention.apply` (`TelemetryRetentionHandler`,
`apps/api/src/telemetry/handlers/telemetry-retention.handler.ts`) runs one
statement:

```sql
ALTER DATABASE <GREPTIME_DB> SET 'ttl'='<retentionDays>d'
```

as the GreptimeDB admin user. One database-level TTL covers every telemetry
table, including per-metric and per-attribute tables GreptimeDB creates
later — tables inherit the database's TTL. GreptimeDB enforces it itself
during compaction; the job only states the policy, it deletes nothing
directly.

**The database name is deliberately unquoted.** GreptimeDB v1.2.1 resolves a
double-quoted name in `ALTER DATABASE` literally (`"public"` fails with
"Failed to find schema"), so the statement builder instead restricts the
name to a plain identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) and refuses anything
else, checked again at the job even though `GREPTIME_DB` is already
validated at startup.

**Idempotent**: setting the TTL to the value it already has is a no-op on
the server, so a retry, a duplicate enqueue, or the daily re-assertion are
all harmless. The job is enqueued by every successful
`PUT /api/admin/telemetry/config` and by `TelemetryRetentionTask`
(`@Cron(EVERY_DAY_AT_4AM)`, enqueue-only per the queue-job rule) — daily
re-assertion matters because a fresh GreptimeDB volume starts with no TTL,
and the save-time enqueue may have raced a store that was briefly down.

Retention is **not gated on `telemetry.enabled`**: a deployment that
switched collection off still wants what it already collected to age out. A
deployment without GreptimeDB, or without `GREPTIME_ADMIN_USER`/
`GREPTIME_ADMIN_PASSWORD` configured, completes the job as a no-op with a
log line — a supported configuration, not a failure. The job is
**server-only, permanently**: no `nodeResultSchema`/`persistNodeResult`,
because the statement needs the GreptimeDB admin credential (CLAUDE.md queue
rule 3).

## 5. Explorer

Three routes, all `telemetry:query`, all on `TelemetryExplorerController`:

| Route | Purpose |
|---|---|
| `POST /api/admin/telemetry/query` | Run one read-only statement; returns columns, rows, `truncated` |
| `GET /api/admin/telemetry/schema` | Every table with its columns, row estimates and semantic types |
| `POST /api/admin/telemetry/export` | Run the same statement and return it as a file attachment |

`TelemetryQueryService.run` (`apps/api/src/telemetry/query/telemetry-query
.service.ts`) is the **one entry point** for caller-supplied SQL: the
explorer, the export and the assistant's `run_query` tool all come through
it, so all three get the same guard, bounds and audit trail.

**The SQL guard** (`apps/api/src/telemetry/query/sql-guard.ts`) is defence
in depth on top of GreptimeDB's own read-only user, which already refuses
`INSERT`/`DROP`/`ALTER`/`SET`. It is a small lexer, not a parser: it strips
comments outside quotes, then requires

- **exactly one statement** — GreptimeDB's simple query protocol executes
  every statement in a semicolon-separated string, so a caller-supplied
  second statement is refused here, before it is ever sent; and
- **one of `SELECT`, `WITH`, `SHOW`, `DESCRIBE`/`DESC`, `EXPLAIN`** (not
  `EXPLAIN ANALYZE`, which runs the whole query).

Each `SELECT`/`WITH` is capped at `maxRows + 1` rows by a `LIMIT` at the
statement's top level (parenthesis depth 0, found by the guard's quote- and
comment-aware scan), never by wrapping it as `SELECT * FROM (<statement>)
LIMIT n`. On GreptimeDB v1.2.1 that wrapper, and a CTE wrapper,
deterministically dropped the inner `ORDER BY`, including for `UNION ALL …
ORDER BY`. `applyRowCap` picks one of four strategies. `appended`: with no
top-level `LIMIT`, ` LIMIT <cap>` is added at the end (or just before a bare
top-level `OFFSET`), so it applies after the statement's own `ORDER BY` and
to a whole `UNION`. `clamped`: a top-level `LIMIT <integer>` at or above the
cap has its number replaced by the cap, keeping any `OFFSET` in either
order. `kept`: a smaller literal `LIMIT` is sent unchanged. `client-only`:
`LIMIT ALL`, a non-literal `LIMIT`, `FETCH FIRST`, and SHOW/DESCRIBE/EXPLAIN
are sent unchanged. In every case the service slices the result to
`maxRows` and sets `truncated` when the server returned more, so for
client-only statements the query timeout is the only bound on rows held in
memory before the slice.

**Limits**: the row cap is the caller's `maxRows` (request body, ≤
`telemetry.query.maxRows`), clamped to that setting, which is also the
ceiling and the default; the statement text itself is capped at
`TELEMETRY_SQL_MAX_LENGTH` (20,000 characters). **Timeout**:
`telemetry.query.timeoutSeconds` (1–120 s) is enforced **client-side** in
`GreptimeClient` — GreptimeDB's read-only user cannot `SET
statement_timeout`, and the startup parameter is silently ignored — by
racing the query against a timer and, on timeout, destroying the pooled
connection (`release(true)`) rather than returning a socket with a query
still in flight to the next caller.

**Truncation and JSON-safe types**: `int8`/`numeric` columns arrive from
GreptimeDB as strings (a `UInt64` reports as `numeric`) and stay strings end
to end, so no value loses precision going through JSON. Timestamp columns
are also kept as the server's own text, which **carries microseconds**, not
GreptimeDB's native nanosecond precision — to get nanoseconds, `CAST(ts AS
STRING) AS ts_ns` in the query itself. `toJsonSafe`
(`telemetry-query.service.ts`) additionally turns a `Buffer`/`Uint8Array`
into base64, a `bigint` into a decimal string, a non-finite number into its
name, and recurses through arrays and plain objects.

**Export formats** (`TelemetryExportService`,
`apps/api/src/telemetry/export/telemetry-export.service.ts`), run through
the same guard, bounds and audit as the query endpoint with the row cap at
the full `telemetry.query.maxRows`:

| Format | Notes |
|---|---|
| `csv` | RFC 4180, CRLF, UTF-8 with a BOM. **CSV injection guard**: a text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` — telemetry rows are attacker-reachable (routes, user agents, log bodies), and this is the classic way to turn one into a spreadsheet formula. Numeric columns are left alone. |
| `ndjson` | One JSON object per row; a repeated column name gets `_2`, `_3`, … so no value is silently dropped. |
| `xlsx` | One sheet (`results`), bold header; numbers as numbers where exact, else text (`exceljs` never treats a string cell as a formula, so no injection concern there). |
| `parquet` | `hyparquet-writer` (pure JS, ESM-only, loaded dynamically). Numeric columns become `DOUBLE` when every value is exact as a double, else `STRING`; timestamps stay `STRING` (the server's own text); everything else is `STRING`. |

Both the query and the export run **in memory, bounded** by the row cap —
synchronous work over at most 100,000 rows — and complete inside the request,
which is why neither is a queue job (CLAUDE.md's "every long-running
activity is a queue job" exempts work that cannot outlive the request that
started it).

**Error reasons** (`details.reason` on every failure, `apps/api/src
/telemetry/query/telemetry-query.errors.ts`):

| Reason | Status | Meaning |
|---|---|---|
| `TELEMETRY_NOT_CONFIGURED` | 503 | No telemetry store in this deployment (the overlay is not deployed) |
| `TELEMETRY_UNREACHABLE` | 503 | Configured, but the store did not answer |
| `TELEMETRY_DISABLED` | 409 | `telemetry.enabled` is off |
| `TELEMETRY_QUERY_REJECTED` | 400 | The SQL guard refused the statement |
| `TELEMETRY_QUERY_FAILED` | 400 | GreptimeDB refused or failed the statement (syntax, unknown column, …) |
| `TELEMETRY_QUERY_TIMEOUT` | 504 | The statement outran `telemetry.query.timeoutSeconds` |
| `TELEMETRY_ASSISTANT_DISABLED` | 409 | `telemetry.assistant.enabled` is off |
| `TELEMETRY_ASSISTANT_NOT_CONFIGURED` | 409 | No `assistant.provider`/`assistant.modelId` chosen |

`TelemetrySchemaService` caches its two `information_schema` reads for
`TELEMETRY_SCHEMA_CACHE_MS` (30 s), shared by concurrent callers, and also
backs the assistant's `list_tables`/`describe_table` tools.

## 6. AI assistant

`POST /api/admin/telemetry/assistant/stream` (`telemetry:query` **and**
`ai:use` — `@Auth()` on a controller is all-of — plus `AiEnabledGuard`
answering 403 `AI_DISABLED` while the AI platform is off) turns a
natural-language question into one read-only SQL query, streamed as
`text/event-stream` frames: `step` (one per tool call), `answer` (`{ sql,
explanation }`), `error`, and always a final `done`. It behaves like
`POST /api/ai/responses/stream` (preconditions run and can fail as ordinary
JSON errors before anything is written; the reply hijacks to SSE only once
committed) but lives under `/api/admin/telemetry`, not `/api/ai`, so the AI
kill-switch/RBAC tripwire suites that enumerate `/api/ai*` do not cover it —
the guard is applied explicitly and pinned by this controller's own spec.

`TelemetryAssistantService` gives the model three function tools
(`list_tables`, `describe_table`, `run_query`) through `AiService
.forUser(userId).runTools`, bounded by `telemetry.assistant.maxSteps` (≤ 12
round trips). Every `run_query` call goes through `TelemetryQueryService.run`
with `source: 'assistant'` — the explorer's own guard, row cap and timeout,
audited as `telemetry:assistant_query` — and the model's suggested final SQL
is re-checked against the SQL guard before being shown to the user (a
statement that fails the re-check is withdrawn with a note, never run). Not
a queue job: the turn lives exactly as long as the SSE request, and a closed
tab aborts both the provider call and any in-flight query.

**Data sharing to the model**, bounded three ways regardless of what a query
returned:

1. Rows only when `telemetry.assistant.shareResults` is on; otherwise the
   model sees only the shape (columns, row count).
2. At most `telemetry.assistant.maxResultRowsToModel` rows, hard-capped at
   `TELEMETRY_ASSISTANT_ROWS_HARD_CAP` (100) regardless of the setting.
3. Each cell truncated to `CELL_MAX_CHARS` (500) and the whole tool output
   to `TOOL_OUTPUT_MAX_CHARS` (24,000) — rows are dropped from the end of
   the output, with a note, to stay under that.

`history` in the request carries up to `TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS`
(20) earlier turns, each at most `TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX`
(8,000) characters.

**Untrusted tool output.** Telemetry rows are attacker-reachable (a log
body, an HTTP route, a user agent). The assistant's system prompt
(`TELEMETRY_ASSISTANT_INSTRUCTIONS`) tells the model that everything a tool
returns is data from the monitored system, never instructions, and the blast
radius is bounded by construction: the tools can only read, through the
read-only store user, and the model's suggested SQL is only ever shown to
the user, never executed by this service.

Every conversation turn is audited as `telemetry:assistant` (question
length, provider, model, steps, tool calls, stop reason); every `run_query`
call is separately audited as `telemetry:assistant_query` through the shared
query service. No provider SDK is imported in the telemetry module — the
call goes through `AiService`, spending the caller's own key or the
organisation key per the AI platform's key policy (CLAUDE.md AI rule 1).

## 7. Security model

- **Three GreptimeDB accounts**, set from `.env` with no compose-level
  default (`docker compose` fails outright, naming the missing key, rather
  than booting a store with a well-known password):
  - `GREPTIME_WRITER_USER`/`PASSWORD` — collector ingest only; held by the
    collector's `basicauth/greptime` extension, never by the API.
  - `GREPTIME_READER_USER`/`PASSWORD` — a GreptimeDB `readonly` user.
    Everything user-driven (status, explorer, assistant) runs on it, and
    GreptimeDB itself refuses `INSERT`/`DROP`/`ALTER`/`SET` for it — verified
    server-side enforcement, not an application-level assumption.
  - `GREPTIME_ADMIN_USER`/`PASSWORD` — used only for the retention `ALTER
    DATABASE` and `SHOW CREATE DATABASE`; a route never runs caller-supplied
    SQL on it.
- **Redaction happens ahead of ingest**, in the collector, not the API: the
  `attributes/redact` processor deletes
  `http.request.header.authorization`, `http.request.header.cookie`,
  `http.response.header.set-cookie` and `url.query` before a batch reaches
  GreptimeDB, so a deleted attribute never becomes a column at all — it
  cannot be un-redacted by a later query.
- **`telemetry:read`/`telemetry:write`/`telemetry:query` are Admin-only**,
  seeded that way in `ROLE_PERMISSIONS` (`apps/api/prisma/seed-data.ts`):
  `read`/`write` gate the deployment-wide policy (whether telemetry is
  collected, its retention, its bounds), the same "narrow, operational
  surface" posture as `storage_config:*`/`ai_config:*`; `query` is the
  separate act of actually running SQL, exporting results or invoking the
  assistant against telemetry data — comparable to `db_backup:restore`.
- **No AI key ever reaches the browser or a log line.** The assistant
  resolves a key through `AiKeyResolver` exactly like every other AI call;
  see [AI Platform §2](ai-platform.md).
- **Same-origin.** The assistant stream is proxied by nginx like every other
  API route: `infra/nginx/nginx.conf`'s `location /api/admin/telemetry
  /assistant/stream` block forwards it unbuffered, with a long read timeout
  and 15 s heartbeats, matching the AI response stream's needs.
- **Never a credential in the settings namespace.** See §3's compile-time
  proof.
- Every admin write and every query/export/assistant call is an audit
  event: `telemetry:config_update`, `telemetry:query`, `telemetry:export`,
  `telemetry:assistant_query`, `telemetry:assistant` — including refused
  and failed queries, so a rejected `DROP` is on record.

## 8. BI access

`GREPTIME_BIND_PG_PORT` (default `14003`) is GreptimeDB's Postgres wire port,
bound to `127.0.0.1` only on a VPS deployment
(`infra/compose/vps.telemetry.compose.yml`) — nothing about the telemetry
store is ever published on a public interface. An analyst reaches it through
an SSH tunnel and a read-only login (`GREPTIME_READER_USER`), from Power BI,
Excel, DBeaver, Grafana or any other tool that speaks the PostgreSQL wire
protocol. See the [telemetry runbook](../runbooks/telemetry.md) for the exact
commands and per-tool notes.

## History

- #528: epic, Telemetry Explorer on GreptimeDB.
- #529: spike and decision record (this document's first version).
- #530: GreptimeDB telemetry overlay replaces Uptrace.
- #531: VPS deploy carries the telemetry overlay behind the `observability`
  group, with GreptimeDB's Postgres wire port bound to loopback only.
- #532: logs over OTLP behind a runtime telemetry gate.
- #533: telemetry settings namespace and permissions.
- #534: the telemetry module — settings service, status endpoint, and the
  `telemetry.retention.apply` job.
- #535: the Telemetry Explorer — query, schema and export endpoints, the SQL
  guard.
- #536: the telemetry AI assistant over SSE.
- #537: the Telemetry Explorer and settings pages in the admin web app.
- #538: the GreptimeDB tier in the API test suite.
- #539: this document's remaining sections.
- #554: row cap moved to a top-level LIMIT so ORDER BY survives.
