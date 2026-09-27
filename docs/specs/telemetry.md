# Telemetry (GreptimeDB + Telemetry Explorer)

> **Status:** In progress

This spec covers replacing the current Uptrace/ClickHouse/Redis observability
stack with a two-container overlay: an OTel Collector in front of a GreptimeDB
standalone instance. Admins query telemetry with SQL, export the results, and
ask an AI assistant about them. The application's own PostgreSQL database
takes no telemetry load: traces, logs and metrics live in GreptimeDB alone.

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
- Subquery wrapping works for arbitrary user SQL, including a `WITH`/CTE
  inside the subquery: `SELECT * FROM (<user sql>) AS q LIMIT n`.
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

- The API's telemetry query path must build queries as `SELECT * FROM
  (<user sql>) AS q LIMIT n` and never as a parameterised `pg` query;
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

## Sections to come

The following sections are not written yet:

- Architecture (containers, data flow, module layout)
- Security model (credentials, network exposure, AI data sharing boundary)
- Retention (operator-facing policy and configuration)
- AI data sharing (what the assistant may see and query)
- BI access (read-only access for external tools)

## History

- #528: epic, Telemetry Explorer on GreptimeDB.
- #529: spike and decision record (this document's first version).
- #530: GreptimeDB telemetry overlay replaces Uptrace.
- #532: logs over OTLP behind a runtime telemetry gate.
- #533: telemetry settings namespace and permissions.
- #539: remaining sections of this spec.
