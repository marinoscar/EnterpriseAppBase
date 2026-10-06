// =============================================================================
// Files under apps/api/src allowed to issue raw SQL (issue #688, PP-1.9)
// =============================================================================
//
// Raw SQL (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`)
// bypasses the user-scoped client (prisma/ownership/scoped-prisma.service.ts
// refuses it outright), so every file using it is listed here with the reason
// it needs it. raw-sql-allowlist.spec.ts fails for an unlisted file and for a
// listed file that no longer uses raw SQL.
//
// Adding an entry is a review signal: the statement must never take a
// request-derived id without scoping it to the caller itself. Prefer the
// Prisma query API; reach for raw SQL only for what it cannot express.
//
// Keys are paths relative to apps/api/src, with forward slashes.
// =============================================================================

export const RAW_SQL_ALLOWLIST: Readonly<Record<string, string>> = {
  'prisma/prisma.service.ts':
    'cleanDatabase(): lists and truncates every table; test environment only (it throws otherwise).',
  'ai/usage/ai-usage.service.ts':
    'Admin usage report: GROUPING SETS totals Prisma cannot express; filters are bound parameters from a validated admin query.',
  'jobs/job-insights.service.ts':
    'Queue insights: GROUPING SETS and percentile aggregates; read-only SELECTs over jobs, pinned by its own spec.',
  'jobs/job-claim.service.ts':
    'The queue claim: FOR UPDATE SKIP LOCKED in a CTE, which Prisma cannot express. System work, no user ids.',
  'common/event-bus/postgres-event-bus.ts': 'Event bus publish: SELECT pg_notify(...). No table access.',
  'health/doctor/db-migrations.doctor-check.ts': 'Doctor check: reads _prisma_migrations, which has no Prisma model.',
  'health/indicators/database.indicator.ts': 'Health probe: SELECT 1.',
  'db-backup/restore-preflight.service.ts':
    'Restore pre-flight: reads pg_extension. Read-only by invariant (no restore pre-flight may create, drop or rename anything).',
  'db-backup/db-backup-runner.service.ts': "Backup run: reads current_setting('server_version') to record the dump's server version.",
  'db-backup/migration-state.util.ts': 'Backup and restore: reads the newest applied migration from _prisma_migrations, which has no Prisma model.',
};
