---
name: platform-migration
description: Author a database migration for a PLATFORM table (a model owned by packages/platform-db) - edit the fragment, compose the schema, create the SQL, promote it, apply it, run the lock and drift checks, and commit both copies with platform.lock and a changeset. Use when a task changes a platform-owned Prisma model, adds a raw-SQL partial index, or touches an org (row-level security) table. For an app-only table use a plain prisma:migrate:dev instead.
---

# Platform migration

Full text: `docs/DEVELOPMENT.md`, section "Authoring a platform migration" (`grep -n '^###' docs/DEVELOPMENT.md`, then read only that section). Run every command from `apps/api`.

## Steps

1. Edit the owning fragment: `packages/platform-db/schema/<slice>.prisma` (app tables: `apps/api/prisma/fragments/`). `apps/api/prisma/schema/` is GENERATED; never hand-edit it. A back-relation on a platform model is an `extend model` block.
2. `npm run db:compose`, then `npm run prisma:generate`.
3. `npm run prisma:migrate:dev -- --create-only --name <migration_name>`. Review the SQL under `prisma/migrations/<timestamp>_<name>/`. Never use bare `npx prisma`.
4. Promote: `npm run db:promote -- <localDir> --id <migration_name> --slice <slice>`. This copies the bytes to `packages/platform-db/migrations/NNNN_<name>/`, adds the manifest entry and records the directory in `prisma/platform.lock`.
5. Apply: `npm run prisma:migrate:dev` (or `prisma:migrate`).
6. Verify: `npm run db:check` and `npm run db:drift` (`db:check:database` also needs the database).
7. Commit together: `packages/platform-db/migrations/**`, `apps/api/prisma/**` (including `platform.lock`) and a `.changeset/<name>.md` for `@marinoscar/platform-db` (frontmatter `"@marinoscar/platform-db": minor`, then one paragraph).

## Rules

- An installed migration is never edited, renamed or re-commented: `platform.lock` stores a sha256 of every platform migration and `db:check` fails on any byte change (comments and line endings included).
- A partial or expression index is hand-written in the migration SQL and added to `packages/platform-db/raw-sql-indexes.json` (`name`, `table`, `unique`, `definition`, `reason`, `doc`, `createdIn`). Never replace it with `@@unique` or a `findFirst` pre-check. The tripwire (`packages/platform-db/test/raw-sql-indexes.spec.ts`) fails on an unlisted one.
- A migration touching an org table (`storage_objects`, `storage_object_chunks`, `ai_runs`, `ai_usage_events`, `groups`, `group_members`, `group_invites`, `grants`, `org_settings`, `org_credentials`) is wrapped:
  `BEGIN; SELECT set_config('app.rls_bypass','on',true); ...; COMMIT;`
  A link between two org-owned tables is a composite foreign key including `org_id`. RLS policies are listed in `packages/platform-db/rls-policies.json`.
- At most ONE open pull request may carry the `pp:migration` label. A second waits, rebases onto the first and redoes steps 3-4 so its directory sorts after.
- A new job type, settings key or `*.operation` value needs no migration (plain strings / JSONB).
- A new permission is a registry change plus `npm run catalog:permissions`, not a migration.
- Add a `*.db.spec.ts` (`npm run test:db`) for locking, uniqueness, index or RLS behaviour.

## Done when

`db:compose:check`, `db:check`, `db:drift` and `typecheck` pass, the migration applies to an empty database, and both trees plus the lock are in the same commit. Flag new tables or permissions for the docs agent (`docs/ARCHITECTURE.md`).
