# packages/platform-db rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This package owns the platform's Prisma model fragments, migrations, raw-SQL index list and RLS policy list. README: [README.md](README.md). Guide: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md#authoring-a-platform-migration).

## Layout

- `schema/<slice>.prisma`: model fragments (`base`, `identity`, `jobs`, `ai`, `storage`, `sharing`, ...). `platform db compose` writes `apps/api/prisma/schema/`.
- `migrations/`: platform history (the base's 22 are `0001_initial` to `0022_add_retention_created_at_indexes`).
- `raw-sql-indexes.json` (`RAW_SQL_INDEXES`), `rls-policies.json` (`RLS_POLICIES`).

## Migration flow for a PLATFORM table

1. Edit the owning fragment in `schema/`.
2. `cd apps/api && npm run db:compose`.
3. `npm run prisma:migrate:dev -- --create-only --name <migration_name>`; review the SQL and hand-write any partial index.
4. `npm run db:promote -- <localDir> --id <migration_name> --slice <slice>`.
5. Apply (`npm run prisma:migrate`), then `npm run db:check` and `npm run db:drift`.
6. Commit the package copy, the app copy, `apps/api/prisma/platform.lock` and a `.changeset` file.

At most ONE open PR may carry the `pp:migration` label; a second rebases and re-runs steps 3 and 4 so its directory sorts after the first. An app-only table uses plain `prisma:migrate:dev`.

## Never

- **Never edit an installed migration.** `platform.lock` stores a sha256 of every migration; `npm run db:check` fails on any byte change in either copy. Comments inside `migration.sql` count, so a comment clean-up must exclude `**/migration.sql`. Never rename an installed directory.
- **Never hand-edit `apps/api/prisma/schema/`** (generated; CI runs `db:compose:check`).
- **Never fix raw-SQL partial index drift with `@@unique`.** They exist only in migration SQL: `jobs_active_dedup_uniq_idx`, `database_backup_runs_active_uniq_idx`, `organizations_default_uniq_idx`, `group_invites_pending_uniq_idx`, `grants_active_user_uniq_idx`, `grants_active_group_uniq_idx`, `grants_active_ref_uniq_idx`, `android_app_releases_one_current_uniq_idx`, plus non-unique `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx`. A new one is also listed in `raw-sql-indexes.json`; a fragment never redeclares one (`assertRawSqlIndexes`, `test/raw-sql-indexes.spec.ts`).
- **Never touch an org table without the bypass wrapper**: `BEGIN; SELECT set_config('app.rls_bypass','on',true); ...; COMMIT;`.

## Row-level security

- `org` tables force RLS on `org_id`: `storage_objects`, `storage_object_chunks`, `ai_runs`, `ai_usage_events`, `groups`, `group_members`, `group_invites`, `grants`, `org_settings`, `org_credentials`. New policy: add to `rls-policies.json` (intentional drift).
- A link between two org-owned tables is a composite foreign key including `org_id`.
- `jobs` has no RLS.
- A back-relation onto a platform model is an `extend model` block in the app's fragment.

Tests: `npm run test:run --workspace=@marinoscar/platform-db`; `runDbConformance()`.
