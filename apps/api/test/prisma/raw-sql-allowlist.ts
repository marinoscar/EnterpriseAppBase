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
// Files are paths relative to the scanned root (apps/api/src, or a packaged
// slice's src/<slice> folder: identity since #727, db-backup since #740, host
// since #867), with
// forward slashes.
// =============================================================================

export const RAW_SQL_ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'prisma/prisma.service.ts',
    why: 'cleanDatabase(): lists and truncates every table; test environment only (it throws otherwise).',
  },
  {
    // The host slice's root (#867), packages/platform-api/src/host.
    file: 'event-bus/postgres-event-bus.ts',
    why: 'Event bus publish: SELECT pg_notify(...). No table access.',
  },
  {
    // The host slice's generic Doctor checks (#879), host root.
    file: 'doctor/db-connection.doctor-check.ts',
    why: 'Doctor check: SELECT 1, timed. No table access.',
  },
  {
    file: 'doctor/db-migrations.doctor-check.ts',
    why: 'Doctor check: reads _prisma_migrations, which has no Prisma model.',
  },
  {
    file: 'health/indicators/database.indicator.ts',
    why: 'Health probe: SELECT 1.',
  },
  {
    file: 'restore-preflight.service.ts',
    why: 'Restore pre-flight: reads pg_extension. Read-only by invariant (no restore pre-flight may create, drop or rename anything).',
  },
  {
    file: 'db-backup-runner.service.ts',
    why: "Backup run: reads current_setting('server_version') to record the dump's server version.",
  },
  {
    file: 'doctor/rls-role.doctor-check.ts',
    why: 'Doctor check: reads pg_roles and pg_class (the API role and the FORCEd tables). Read-only catalogue reads, no user ids.',
  },
  {
    file: 'migration-state.util.ts',
    why: 'Backup and restore: reads the newest applied migration from _prisma_migrations, which has no Prisma model.',
  },
  {
    file: 'organizations/org-admin.common.ts',
    why: "Org administration (#726): SELECT ... FOR UPDATE on the caller's ACTIVE organization row, to serialize the last-admin check; Prisma has no row lock. The org id comes from the principal, never from the request.",
  },
  {
    file: 'platform/onboarding/onboarding-data.adapter.ts',
    why: "Onboarding activation metrics (#745): ONE read-only aggregate SELECT (cohort, milestones, funnel) built by @marinoscar/platform-api/onboarding from registered SQL fragments; every value a positional parameter, no per-user row returned.",
  },
  {
    file: 'data/identity-db.ts',
    why: "The identity slice's structural client (#727): DECLARES the `$queryRaw` / `$executeRaw` signatures the slice may call on the app's client; issues no statement itself.",
  },
  {
    file: 'doctor/backup-rls.doctor-check.ts',
    why: "The db-backup slice's Doctor check (#740): read-only COUNT(*) per tenant table through the system client (the `doctor` reason), compared with the same counts over a connection carrying the dump's startup option. No user ids, no writes.",
  },
  {
    file: 'ports.ts',
    why: "The db-backup slice's host ports (#740): DECLARES the `$queryRawUnsafe` signature of the system-data port the Doctor check calls; issues no statement itself.",
  },
];
