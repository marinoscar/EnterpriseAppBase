// =============================================================================
// Files under apps/api/src allowed to issue raw SQL (issue #688, PP-1.9)
// =============================================================================
//
// Raw SQL (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`)
// bypasses the user-scoped client (the scoped client extension in
// `@marinoscar/platform-api/core` refuses it outright), so every file using it
// is listed here with the reason it needs it. The `userOwnedData` conformance
// suite (run by user-owned-models.spec.ts) fails for an unlisted file and for
// a listed file that no longer uses raw SQL.
//
// Adding an entry is a review signal: the statement must never take a
// request-derived id without scoping it to the caller itself. Prefer the
// Prisma query API; reach for raw SQL only for what it cannot express.
//
// Files are paths relative to apps/api/src, with forward slashes.
// =============================================================================

export const RAW_SQL_ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'prisma/prisma.service.ts',
    why: 'cleanDatabase(): lists and truncates every table; test environment only (it throws otherwise).',
  },
  {
    file: 'ai/usage/ai-usage.service.ts',
    why: 'Usage report: GROUPING SETS totals Prisma cannot express; filters are bound parameters from a validated query. The admin report reads through the system client; the per-user view through an organization-scoped one (#725).',
  },
  {
    file: 'jobs/job-insights.service.ts',
    why: 'Queue insights: GROUPING SETS and percentile aggregates; read-only SELECTs over jobs, pinned by its own spec.',
  },
  {
    file: 'jobs/job-claim.service.ts',
    why: 'The queue claim: FOR UPDATE SKIP LOCKED in a CTE, which Prisma cannot express. System work, no user ids.',
  },
  {
    file: 'common/event-bus/postgres-event-bus.ts',
    why: 'Event bus publish: SELECT pg_notify(...). No table access.',
  },
  {
    file: 'health/doctor/db-migrations.doctor-check.ts',
    why: 'Doctor check: reads _prisma_migrations, which has no Prisma model.',
  },
  {
    file: 'health/indicators/database.indicator.ts',
    why: 'Health probe: SELECT 1.',
  },
  {
    file: 'db-backup/restore-preflight.service.ts',
    why: 'Restore pre-flight: reads pg_extension. Read-only by invariant (no restore pre-flight may create, drop or rename anything).',
  },
  {
    file: 'db-backup/db-backup-runner.service.ts',
    why: "Backup run: reads current_setting('server_version') to record the dump's server version.",
  },
  {
    file: 'health/doctor/rls-role.doctor-check.ts',
    why: 'Doctor check: reads pg_roles and pg_class (the API role and the FORCEd tables). Read-only catalogue reads, no user ids.',
  },
  {
    file: 'db-backup/migration-state.util.ts',
    why: 'Backup and restore: reads the newest applied migration from _prisma_migrations, which has no Prisma model.',
  },  {
    file: 'organizations/org-admin.common.ts',
    why: "Org administration (#726): SELECT ... FOR UPDATE on the caller's ACTIVE organization row, to serialize the last-admin check; Prisma has no row lock. The org id comes from the principal, never from the request.",
  },
  {
    file: 'data/identity-db.ts',
    why: "The identity slice's structural client (#727): DECLARES the `$queryRaw` / `$executeRaw` signatures the slice may call on the app's client; issues no statement itself.",
  },
];
