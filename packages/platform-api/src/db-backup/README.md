# @marinoscar/platform-api/db-backup

The database backup and restore slice (issue #740, PP-8.7): logical backups that stream `pg_dump` into object storage, their schedule and retention, the in-app restore (pre-flight, scratch-database replay, swap, rollback), the four job types that run them, the `/api/admin/db-backup` routes, the per-job PostgreSQL role broker that lets a worker node take a backup, a pluggable backup target with mirror copies, a restore gate registry, the completion events and four Doctor checks. NestJS, CommonJS. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `email`, `jobs` and `storage` of this package (`packages/platform-slices.json`); its wire shapes are [`@marinoscar/platform-contract/db-backup`](../../../platform-contract/src/db-backup/README.md) and its page is [`@marinoscar/platform-web/db-backup`](../../../platform-web/src/db-backup/README.md).

## Purpose and scope

- **Backups.** `DatabaseBackupRunnerService` is the one writer of `database_backup_runs`: it claims a run (the raw-SQL partial unique index `database_backup_runs_active_uniq_idx` admits one active run, no `findFirst` pre-check), streams `pg_dump -Fc` straight into the primary backup target under `database-backups/` (by default the active storage provider; never buffered; the write AND the dump's exit code are awaited), verifies the archive with `pg_restore --list` and prunes by retention.
- **Row-level security.** Every dump and every restore carries BOTH `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (the option in the environment, never in argv; #725). The flag alone writes an archive with no rows; the option alone is refused.
- **Restore.** `DatabaseRestoreService` replays an archive into a scratch database, verifies it, renames it into place, carries the backup catalog (and every registered `RestoreCarryOver`) across the swap and exits so the supervisor restarts the API. No restore pre-flight creates, drops, renames or alters anything; the cluster admin connection is a short-lived `pg.Client` on the `postgres` maintenance database, outside the Prisma pool.
- **Targets and mirrors.** Where an archive lives is the `DB_BACKUP_TARGET` port (`BackupTarget`: `openWrite` returns a streaming sink, `openRead`, `delete`, `list`). `forRoot({ target })` replaces the default adapter over `STORAGE_PROVIDER`; `forRoot({ mirrorTargets })` adds copies written AFTER the primary's archive is written, read back and recorded `completed`, inside the same `db.backup.run` job: the primary's bytes are streamed into each mirror (the dump never runs twice, nothing is buffered), the copy is read back and its SHA-256 compared, and each result is an `audit_events` row (`db_backup.mirror.completed` / `.failed`). A failed mirror never fails the run; the `backup.mirrors` Doctor check warns. Retention, the stale sweep and the admin delete remove the copies with the original. An app primary target means a worker node cannot take backups (its presigned PUT writes through the storage provider), so node offload is withheld.
- **Schedule and retention.** `databaseBackup.frequency` is `daily`, `weekly`, `monthly` or `cron` (`cron` is a five-field expression of lists, ranges and steps, validated on write with the scheduler's own parser and held to a one-hour minimum gap). Retention is a count (`retention.count`, with `retentionCount` kept as its alias on read AND write) and an optional `retention.maxAgeDays`; the newest completed archive is never pruned.
- **Restore gates.** The pre-flight's gates are a registry (`registerRestoreGate`): the eight built-ins register through it in their historical order, an app's gates run after them. A gate is read-only, answers `pass` / `warn` / `fail` and fails closed (a throw, a malformed answer or ten seconds without one is a block that names the gate). An app gate's `fail` blocks outright; only the schema gate has an override.
- **Events.** `db_backup.run.completed` and `db_backup.restore.completed` are raised on the application's event emitter (the `@OnEvent` mechanism) with `{ runId, status, targetId, sizeBytes, durationMs }`, after the settling write commits and outside any transaction.
- **Jobs.** `db.backup.run` (node-eligible: `nodeResultSchema` + `persistNodeResult`, profile `{ maxRuntimeMs: 6 h, maxAttempts: 1 }`, its credential brokered per job by `PgJobRoleBroker`), `db.backup.sweep`, `db.restore.run` (server-only, permanently) and `db.restore.old-db-drop`. `DatabaseBackupScheduleTask` only decides and enqueues.
- **Deployment mode.** `DEPLOYMENT_MODE=saas` turns in-app restore off (use the provider's point-in-time recovery); backups keep working.

Not here: the notification registry and the browser templates (the app's, until the notifications slice), the email templates (the email slice's), the storage provider (the storage slice's), physical backups or PITR, per-organization export (`export` work, #744).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { DbBackupModule, DB_BACKUP_NOTIFIER, registerRestoreCarryOver } from '@marinoscar/platform-api/db-backup';
```

The package's peers (`@nestjs/*`, `@prisma/client-runtime-utils`, `zod`, `nestjs-zod`) plus `pg`, a dependency of the package. `pg_dump`, `pg_restore` and `psql` must be on `PATH` and at least the server's major (`docs/runbooks/postgres-client-version.md`).

## Quick start

The reference app's configuration ([`db-backup.config.ts`](../../../../apps/api/src/platform/db-backup/db-backup.config.ts)) and host ports ([`db-backup-host.module.ts`](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts)):

```ts
export const DbBackupModule = PlatformDbBackupModule.forRoot({
  appName: APP_NAME,
  appVersion: resolveApiVersion,
  imports: [DbBackupHostModule], // binds DB_BACKUP_NOTIFIER, DB_BACKUP_MAINTENANCE, ...
});
```

Then register `DB_BACKUP_PERMISSIONS` with the permission registry, `DATABASE_BACKUP_SYSTEM_SETTINGS` with the system-settings registry, `DB_BACKUP_KEY_PREFIX` with the storage key-prefix list (or let `forRoot` register it) and `DB_BACKUP_APP_METRICS` with the metric registry, and declare the two notification events (`DB_BACKUP_NOTIFICATION_EVENTS`) with their templates (`DB_BACKUP_EMAIL_TEMPLATES`).

## Configuration

`DbBackupModule.forRoot(options)`; every option defaults to the behaviour before the move, and none adds an environment variable:

| Option | Default | Meaning |
|---|---|---|
| `appName` | `'app'` | Slugified into every archive key and file name. |
| `appVersion` | `APP_VERSION`, else `npm_package_version`, else `0.0.0` | Stamped on every run. |
| `deploymentMode` | the `DB_BACKUP_DEPLOYMENT_MODE` port, else `self-hosted` | `saas` disables restore. |
| `restoreEnabled` | `deploymentMode !== 'saas'` | Explicit override of the restore surface. |
| `scheduleEnabled` | the `dbBackup.scheduleEnabled` config key (`DB_BACKUP_SCHEDULE_ENABLED !== 'false'`) | This process schedules backups. |
| `extraCarryOver` | none | `RestoreCarryOver` entries registered at `forRoot` time. |
| `target` | an adapter over the active `STORAGE_PROVIDER` | A `PortBinding<BackupTarget>` (`useClass`, `useExisting` or `useFactory`): the primary target. Its dependencies come from `imports` and global modules. |
| `mirrorTargets` | none | `PortBinding<BackupTarget>[]`: targets that receive a copy of every archive. Each id must be unique and differ from the primary's. |
| `imports` | none | The app's host module(s). |

The policy (schedule, retention, provider pin, compression, rollback mode, node offload) is the `databaseBackup` system-settings namespace, edited at `/admin/settings/db-backup`. `databaseBackup.storageProvider`, when set, must equal the primary target's `id` (the active provider's kind for the default target).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DbBackupModule.forRoot` | option | `forRoot(options?: DbBackupModuleOptions): DynamicModule` | Mount backups, restores, their jobs, routes and Doctor checks once | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup.config.ts) |
| `RestoreCarryOver` | registry | `{ id, exportSql, reinsertSql, order }` | Keep an app table's rows across a restore (a record of something outside the database) | experimental | [example](../../../../apps/api/src/examples/db-backup/release-artifacts.carry-over.ts) |
| `registerRestoreCarryOver` | registry | `registerRestoreCarryOver(entry: RestoreCarryOver): void` | Register a carry from a module-level file before bootstrap (frozen after) | experimental | [example](../../../../apps/api/src/examples/db-backup/release-artifacts.carry-over.spec.ts) |
| `DB_BACKUP_NOTIFIER` | token | `{ provide: DB_BACKUP_NOTIFIER, useExisting: NotificationsService }` | Required: the two `db_backup.*` events | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts) |
| `DB_BACKUP_MAINTENANCE` | token | `{ provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService }` | Required: the swap's in-memory maintenance gate | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts) |
| `DB_BACKUP_METRICS` | token | `{ provide: DB_BACKUP_METRICS, useExisting: AppMetricsService }` | Optional: the `app.backup.*` instruments | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts) |
| `DB_BACKUP_DEPLOYMENT_MODE` | token | `{ provide: DB_BACKUP_DEPLOYMENT_MODE, useExisting: DeploymentModeService }` | Optional: the deployment mode the restore gate reads | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts) |
| `DbBackupModule.forRoot({ target })` | option | `target?: PortBinding<BackupTarget>` | Put the archives somewhere the storage drivers do not reach | experimental | [example](../../../../apps/api/src/platform-extensions/db-backup/local-dir.target.ts) |
| `DbBackupModule.forRoot({ mirrorTargets })` | option | `mirrorTargets?: PortBinding<BackupTarget>[]` | Keep a second copy of every archive elsewhere | experimental | [example](../../../../apps/api/src/app-registrations/db-backup.ts) |
| `BackupTarget` | port | `{ id, location?, refresh?(), openWrite(key, meta): BackupSink, openRead(key), delete(key), list(prefix), signedDownloadUrl?(key, options) }` | Implement a backup target (a filesystem, a vault, a mirror); stream, never buffer | experimental | [example](../../../../apps/api/src/platform-extensions/db-backup/local-dir.target.ts) |
| `DB_BACKUP_TARGET` | token | `{ provide: DB_BACKUP_TARGET, useExisting: ... }` | Inject the primary target in a service of your own (bound by `forRoot({ target })`, not by an app module) | experimental | [example](../../../../apps/api/test/examples/db-backup/local-dir.target.spec.ts) |
| `DB_BACKUP_MIRROR_TARGETS` | token | `BackupTarget[]` | Inject the mirror targets (bound by `forRoot({ mirrorTargets })`) | experimental | [example](../../../../apps/api/test/examples/db-backup/local-dir.target.spec.ts) |
| `StorageProviderBackupTarget` | class | `new StorageProviderBackupTarget(storage, storageConfig?)` | The default target: delegate to it to wrap or decorate the storage-backed behaviour | experimental | [example](../../test/db-backup/backup-target.spec.ts) |
| `registerRestoreGate` | registry | `registerRestoreGate(gate: RestoreGateDefinition): void` | Add a read-only pre-flight check an app needs before a restore (frozen after bootstrap) | experimental | [example](../../../../apps/api/src/app-registrations/db-backup.ts) |
| `RestoreGateDefinition` | registry | `{ id, label, kind?, check(ctx: RestoreGateContext): Promise<RestoreGateOutcome> }` | Declare the gate; `check` answers `{ status: 'pass' \| 'warn' \| 'fail', message, action? }` | experimental | [example](../../../../apps/api/src/platform-extensions/db-backup/cdn-quiesced.gate.ts) |
| `restoreGateRegistry` | registry | `Registry<RestoreGateDefinition>` | Read the registered gates (the eight built-ins, then the app's) | experimental | [example](../../../../apps/api/test/examples/db-backup/cdn-quiesced.gate.spec.ts) |
| `DB_BACKUP_RUN_COMPLETED_EVENT` | event | `'db_backup.run.completed'`, payload `DbBackupRunCompletedEvent` | Subscribe with `@OnEvent` to a settled backup run (completed, failed or stale) | experimental | [example](../../../../apps/api/test/examples/db-backup/local-dir.target.spec.ts) |
| `DB_BACKUP_RESTORE_COMPLETED_EVENT` | event | `'db_backup.restore.completed'`, payload `DbBackupRestoreCompletedEvent` | Subscribe to a settled restore (completed or failed) | experimental | [example](../../test/db-backup/database-restore.service.spec.ts) |
| `describeBackupTargetConformance` | kit | `describeBackupTargetConformance(target, { describe, it, expect, ... })` | Prove a target streams, reads back, lists and deletes (`./db-backup/testing`) | experimental | [example](../../../../apps/api/test/examples/db-backup/local-dir.target.spec.ts) |
| `describeRestoreGateConformance` | kit | `describeRestoreGateConformance(gate, { describe, it, expect, scenarios })` | Prove a gate answers, is read-only and repeatable (`./db-backup/testing`) | experimental | [example](../../../../apps/api/test/examples/db-backup/cdn-quiesced.gate.spec.ts) |
| `DB_BACKUP_SYSTEM_DATA` | token | `{ provide: DB_BACKUP_SYSTEM_DATA, useExisting: PrismaSystemService }` | The bypass client the `backup.rls-bypass` Doctor check counts with | experimental | [example](../../../../apps/api/src/platform/db-backup/db-backup-host.module.ts) |

Supporting exports (experimental unless noted): the target types (`BackupSink`, `BackupTargetObject`, `BackupWriteMeta`, `BackupSignedUrlOptions`, `assertBackupTarget`, `isStorageBackedTarget`), the gate types (`RestoreGateContext`, `RestoreGateOutcome`, `RestoreGateRun`, `RestoreGateSettings`, `RestorePreflightFacts`, `RestoreClusterFacts`, `RestoreGateKind`, `RestoreGateResult`, `RestoreGateVerdict`, `evaluateRestoreGate`, `evaluateRestoreGates`, `RESTORE_GATE_TIMEOUT_MS`, `BUILTIN_RESTORE_GATES`), `DbBackupEvents` and the two payload types, the cron helpers (`parseBackupCron`, `assertBackupCron`, `minimumCronIntervalMinutes`, `InvalidCronExpressionError`, `CronIntervalTooShortError`), `resolveBackupRetention`, the options (`DB_BACKUP_OPTIONS`, `resolveDbBackupModuleOptions`, `resolveRestoreEnabled`, `defaultAppVersion`), `DbBackupRestoreGate` and `restoreGateFor`, the port interfaces and `NOOP_DB_BACKUP_METRICS`, `restoreCarryOverRegistry` and `registerRestoreCarryOvers`, the structural rows (`DatabaseBackupRun`, `DatabaseBackupStatus`, `DatabaseBackupTrigger`, `DbBackupPrisma`), the registrations (`DB_BACKUP_PERMISSIONS`, `DATABASE_BACKUP_SYSTEM_SETTINGS`, `DB_BACKUP_KEY_PREFIX`, `DB_BACKUP_APP_METRICS`, `DB_BACKUP_NOTIFICATION_EVENTS`, `DB_BACKUP_EMAIL_TEMPLATES`, `DB_BACKUP_JOB_TYPES`; stable), the runner and retention services, the PERMANENT job type strings, the errors and the RLS pair (`RLS_BYPASS_PGOPTIONS`, `rlsBypassEnv`).

### Internal, not extension points

`DB_BACKUP_ENGINE`, `DB_BACKUP_TIMERS`, `RESTORE_PREFLIGHT_SEAM`, `RESTORE_ADMIN_CLIENT_FACTORY`, `DATABASE_RESTORE_SEAM` and `PG_JOB_ROLE_SEAM` are optional tokens the module deliberately leaves UNBOUND: a stubbed dump engine, cluster or `exitProcess` in production is a subsystem that reports success and does nothing. They are exported from `./db-backup/testing` only, for a test that constructs the services directly; see the header of `db-backup.module.ts`.

## Data

The `db-backup` fragment of `@marinoscar/platform-db` owns `DatabaseBackupRun` (`database_backup_runs`; enums `DatabaseBackupStatus`, `DatabaseBackupTrigger`) and extends `Job` with its back-relation; no migration in this version. `database_backup_runs_active_uniq_idx` is intentional raw-SQL drift (`RAW_SQL_INDEXES`). The slice reads the table, `jobs`, `users` and `audit_events` through the core `PLATFORM_PRISMA` port (none carries row-level security); the org-owned tables are reached only by `pg_dump`/`pg_restore` and the Doctor check. Archives live under `database-backups/<slug>/YYYY/MM/` (deployment scope). `DB_BACKUP_KEY_PREFIX` is marked `survivesFactoryReset: true` (#743): the admin factory reset of `@marinoscar/platform-api/user-data` keeps the archives, their `database_backup_runs` rows and the jobs those rows link to, so a backup taken first is the reset's undo.

### Restore carry-over

Before the swap the restore reads, from the database being displaced, every `database_backup_runs` row, the restore's own `jobs` row (all of its columns, `org_id` included) and every registered `RestoreCarryOver`; after both renames it upserts them into the promoted database, writes the completion audit row with `org_id` NULL (a restore is a deployment event) and exits. A registered carry runs after the built-in four, in ascending `order`, each in its own transaction with `app.rls_bypass` set transaction-locally; its rows are bound to `reinsertSql` as `$1::jsonb`. A failing carry is logged as CRITICAL and never fails the restore.

## Permissions and settings

`db_backup:read`, `db_backup:write` and `db_backup:restore`: SYSTEM scope, `admin` only, declared by `DB_BACKUP_PERMISSIONS`. Every route also requires the system `admin` role: an organization's `org_admin` gets 403 on all of them. The admin card declares `db_backup:read`, the exact string the controller enforces on its reads. Settings: the `databaseBackup` system namespace (`DATABASE_BACKUP_SYSTEM_SETTINGS`, inert by default).

## UI

`@marinoscar/platform-web/db-backup/ui`: the `/admin/settings/db-backup` page and its admin card.

## Infra

None of its own. The deployment needs the PostgreSQL client binaries in the API (and worker) image, a role that may `CREATE DATABASE` for the automated restore (the pre-flight guides otherwise) and `CREATEROLE` for node offload, and a DIRECT connection to the database (a transaction-mode pooler rejects the RLS startup option).

## Observability

Logs (`DatabaseBackupRunnerService`, `DatabaseRestoreService`, ...), the `app.backup.runs`, `app.backup.duration` and `app.backup.size` instruments plus the two last-success gauges (`DB_BACKUP_APP_METRICS`, recorded through `DB_BACKUP_METRICS`), the job spans of the jobs slice, the two completion events, an `audit_events` row per mirror copy, and the Doctor checks `backup.schedule`, `backup.pg-client`, `backup.rls-bypass` and `backup.mirrors` (a read-only warning when a configured mirror's latest copy failed or never ran).

## Security notes

- **The bypass.** Dump and restore lift row-level security per session with `app.rls_bypass=on`, so the API role stays NOSUPERUSER NOBYPASSRLS. The restore pre-flight's `rls_bypass` gate reports how the restore session gets past RLS (a SUPERUSER/BYPASSRLS role, or the option reaching the server) and guides with an `ALTER ROLE ... BYPASSRLS` block for a dedicated restore role otherwise; `backup.rls-bypass` compares a bypass-client count with a count over the dump's startup option.
- **Brokered roles.** `PgJobRoleBroker` mints a SELECT-only, `VALID UNTIL`-bounded, NOBYPASSRLS login role per `db.backup.run` job; the node's dump reads every row through the same startup option. The secret is held in node memory only; `job_node_secrets` stores the role's name (the handle), revoked on settle and by the sweep.
- **Targets keep the invariants.** A target receives a key the SERVER built (`database-backups/<slug>/...`) and never chooses one; the archive streams through `openWrite` and is never buffered (the kit streams 20 MiB and fails a target whose buffer memory grows with it or whose reads arrive as one chunk); both the sink's `done` and the dump's exit code are awaited; the dump and restore keep both RLS flags whatever the target is. Mirror writes are part of the existing job, after the primary succeeded, never a detached task. A target holds no secret in a log or an error.
- **Gates are read-only.** A gate gets a frozen context with a read-only settings reader and the probes the pre-flight already ran (no password); it creates, drops, renames and alters nothing, and the kit runs it against a context that records every write. The cluster admin connection stays outside the Prisma pool on the `postgres` maintenance database.
- **The saas gate.** With restore off, the restore and rollback routes answer 403 with `details.reason: "deployment_mode_saas"` before any lookup, `db.restore.run` is refused before it touches a database (a job queued before the switch fails without a swap), and the page disables the actions with the reason.
- **Deployment-wide.** A restore rolls back every organization in multi-org mode. That is why the permissions are system scope and the audit rows carry no organization.

## Conformance suite

`dbBackupConformanceSuite` (`./db-backup/testing`, suite id `db-backup`, option key `dbBackup`): both halves of the RLS pair on `pg_dump` and `pg_restore`, the restore server-only and the backup node-eligible with its profile and broker, system-scope permissions, the `database-backups/` prefix registered with deployment scope, and every registered carry binding `$1`. The reference app runs it in [`db-backup-conformance.spec.ts`](../../../../apps/api/test/db-backup/db-backup-conformance.spec.ts); the real-Postgres proofs (the RLS round trip, the broker, the restore round trip with the `org_id` carry) and the HTTP suites stay in `apps/api/test/db-backup/` and `apps/api/test/integration/`, where the composed app is.

## Upgrade notes

PP-14.12 is additive. `RESTORE_GATE_IDS` is renamed `BUILTIN_RESTORE_GATE_IDS` (the old name stays as a deprecated alias of the same eight ids) and the wire gate id is an open pattern rather than a closed enum; a gate's `kind` gains `app`. `frequency` gains `cron` and the namespace gains optional `cron` and `retention`; a row stored before them loads and round-trips unchanged, `retentionCount` stays the alias of `retention.count` on read and write, and the shipped defaults are unchanged. With no `target` and no `mirrorTargets` the engine behaves exactly as before.

New in this version: moved from the reference app's `apps/api/src/db-backup/`. Routes, job types, permissions, the settings namespace, the metric names and the archive keys are unchanged. New: the `rls_bypass` pre-flight gate (in `RESTORE_GATE_IDS`), the `RestoreCarryOver` registry, and the carry-over now preserves `org_id`, `provider_key`, `model_version` and `trace_context` on the restore's job row and `job_id`, `pg_dump_version` on run rows.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A backup completes with empty tables | `--enable-row-security` without `app.rls_bypass=on` | Both halves are in `buildPgDumpArgs` and `rlsBypassEnv`; check a custom `PGOPTIONS` and the Doctor's `backup.rls-bypass` |
| `unsupported startup parameter: options` | A transaction-mode pooler | Point `POSTGRES_HOST`/`POSTGRES_PORT` at the database directly |
| Restore answers 403 `deployment_mode_saas` | `DEPLOYMENT_MODE=saas` | By design: use the provider's point-in-time recovery |
| Boot fails: `Nest can't resolve dependencies ... DB_BACKUP_NOTIFIER` | The host module was not passed | `forRoot({ imports: [YourHostModule] })` binding the two required ports |
| `backup.mirrors` warns, or the log says a mirror copy failed | The mirror was unreachable, out of space, or its read-back differed | Fix the target; the next successful backup copies again. The primary archive is unaffected |
| Saving a cron schedule answers 400 `cron_interval_too_short` / `invalid_cron` | The expression can fire less than an hour apart, or uses syntax the scheduler does not read (names, macros, a restricted month, both day fields) | Use five numeric fields; lists, ranges and steps are fine |
| A restore is blocked by a gate the app registered, with no override | App gates block outright | Resolve what the gate reports and run the pre-flight again |
| Node offload is never offered after binding a `target` | A worker node writes through the storage provider's presigned PUT | By design: with an app primary target the in-process worker streams the dump |
| A registered carry logs `CRITICAL ... could not be re-inserted` | Its table or SQL does not exist in the promoted database | Fix `reinsertSql`; the restore itself succeeded |

## Links

- [Package README](../../README.md)
- [Spec: database backup](../../../../docs/specs/database-backup.md), [database restore](../../../../docs/specs/database-restore.md)
- [Runbook: database restore](../../../../docs/runbooks/database-restore.md), [node job secrets](../../../../docs/runbooks/node-job-secrets.md)
- [The web slice](../../../platform-web/src/db-backup/README.md), [the contract](../../../platform-contract/src/db-backup/README.md)
