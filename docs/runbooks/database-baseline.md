# Runbook: Baseline an Existing Database onto the Platform Migration History

Use this **once per app and database**, the first time an app that already has
a production database adopts `@marinoscar/platform-db`. It records which of the
database's existing migrations *are* platform migrations, proves the live
schema equals the platform schema at that version, and marks the platform
history applied **without running it**. Doing the same by hand (inserting into
`_prisma_migrations`, renaming directories) is error-prone and irreversible on
production, which is why the tool exists.

This is not part of a deploy. `appctl deploy update` runs `prisma:migrate` then
`prisma:seed` and must **never** run a baseline; baseline **before** the first
deploy of an app version that depends on `@marinoscar/platform-db`, as a
deliberate operator action, in a maintenance window.

Source of truth for every claim below:

- [ADR 0002](../adr/0002-database-packaging-and-rls.md) D4: the steps B1 to B6,
  `--through`, placement, the P3005 and P3008 handling, and what the experiments
  observed.
- `packages/platform-db/src/baseline/run.ts`: the steps, in order, and every
  refusal.
- `packages/platform-db/src/baseline/plan.ts`: the directory names an installed
  migration gets.
- `apps/api/test/prisma/platform-baseline.db.spec.ts`: the procedure on real
  Postgres, including a database migrated from the pre-package history.

The design is in the
[platform packages spec](../specs/platform-packages.md#baseline-adoption-for-existing-databases);
the tool's reference is in
[`packages/platform-db/README.md`](../../packages/platform-db/README.md).

---

## 1. What the tool does

`platform db baseline` is a **dry run unless you pass `--apply`**. A dry run
reads the database and the files, prints a report and changes nothing: no file
is written, no `prisma migrate resolve` runs. (To replay the package history it
creates a throwaway shadow database next to the live one and drops it again; pass
`--shadow-database-url` to use one you made, which needs no `CREATEDB`.)

| Step | What it checks or does | Refuses when |
|---|---|---|
| Ledger first | Reads `_prisma_migrations` | a row is failed or rolled back and not superseded by a later successful run (section 8) |
| B1 Map | Matches each platform migration to one of your directories: identical bytes, else identical after stripping comments and whitespace, else your `--map` file | never; it only reports. Unmatched migrations and app-only directories are listed |
| B2 Ledger | Each mapped directory must be a finished row of `_prisma_migrations` with the checksum of the local file | a row is missing, or the checksum differs |
| B3 Diff | Replays the package history up to `--through` in a shadow database and diffs it against the **live** database | any statement remains that no `deviations[].expectDiff` in `platform.lock` declares |
| B4 Indexes | Compares the live `pg_indexes` rows for the package's and the app's raw-SQL indexes, by name and definition | one is missing or differs |
| B5 Act (`--apply`) | Installs each migration that has no directory; runs `prisma migrate resolve --applied` for those at or below `--through`; writes `platform.lock` | `resolve` fails; the lock already has entries and `--force-remap` was not given |
| B6 Verify (`--apply`) | `prisma migrate status`, the offline `platform db check`, and the ledger comparison | any of them fails |

There is **no `--force`**: a live difference nobody declared always refuses.
Prisma's own diff ignores partial and expression indexes in both directions, so
B4 asserts them positively instead of filtering diff output.

Every Prisma CLI call goes through the app's `scripts/prisma-env.js`, which
builds `DATABASE_URL` from `POSTGRES_*`. Never run a bare `npx prisma` against a
database for this.

## 2. Before you start

- **Know the version the database claims to equal.** By default that is the
  newest platform migration. A database that is behind (an app that lacks the
  last few platform migrations) uses `--through <NNNN>`: the migrations above it
  are installed, not resolved, and `prisma migrate deploy` applies them for real
  (section 6).
- **Install the package and run `npm run build:packages`** (in this repository)
  or `npm install` (in an app), so `platform` resolves.
- **Have the app's own raw-SQL indexes ready.** An app that owns partial or
  expression indexes lists them under `rawSqlIndexes` in `prisma/platform.lock`
  (name and `pg_indexes.indexdef`), or B4 cannot assert them.
- **Have a way back.** Section 9. Do not start without a fresh backup.

## 3. Rehearse on a restored copy first

Production is touched only after the whole procedure has run clean on a copy.

1. **Take a fresh backup.** Use the **Database Backup** admin page, or enqueue
   `db.backup.run` (see [database-restore.md](database-restore.md) for where the
   archives come from and how to verify one).
2. **Restore it into a scratch database on a non-production cluster.** Use
   `pg_restore` into a new, empty database:

   ```bash
   createdb -h <scratch-host> -U postgres app_rehearsal
   pg_restore -h <scratch-host> -U postgres -d app_rehearsal --no-owner --no-acl <archive>.dump
   ```

   Do **not** use the in-app restore: it swaps the live database. The dump
   carries `_prisma_migrations`, so the copy has the same ledger.
3. **Point a shell at the copy.** Set `POSTGRES_HOST`, `POSTGRES_PORT`,
   `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB=app_rehearsal`. Check it
   twice: `--apply` writes to whatever these name.
4. **Run the dry run** (section 4) and fix what it reports (section 5).
5. **Run `--apply` on the copy** (section 6), then `npm run prisma:migrate` (a
   no-op), `npm run prisma:seed` and a smoke test of the app against the copy.
6. **Keep the plan.** The report of the rehearsal and of the production run must
   be the same; a difference means the copy is not a faithful copy.

## 4. Run the dry run

From the app (for example `apps/api`):

```bash
npm run db:baseline                                  # newest platform migration
npm run db:baseline -- --through 15                  # a database that is behind
npm run db:baseline -- --map prisma/baseline-map.json
```

The report has one block per step and ends with `dry run clean`, `nothing to do`
or a `REFUSED` list. The exit code is 0 when nothing refuses and 1 otherwise. In
the mapping block:

- `[sha256]` is an identical file (a directory rename does not matter). Nothing
  to review.
- `[normalised, localSha256 recorded]` differs only in comments or whitespace.
  **Review the difference**; the lock records your file's hash, so any further
  edit is still caught.
- `[operator-map, ...]` is a match you declared. The diff is what proves it; read
  it.
- `(no local directory)` is a platform migration your history lacks. If its effect
  is in the database (an app migration did the same thing under another name), it
  will be installed and resolved. If it is above `--through`, it will be
  installed and applied by `migrate deploy`.
- `app-only` directories are your own migrations. They are left alone.

A map file is a JSON object from platform id to your directory name:

```json
{ "platform:0019_add_device_session_credential_link": "20260929090000_device_link_renamed" }
```

Use it when the SQL differs by more than comments and whitespace (for example you
wrote `IF NOT EXISTS`). The directory may match only one migration.

## 5. Fixing differences

The tool reports; it never changes your schema.

| You see | It means | Do |
|---|---|---|
| `DIFF_BLOCKING` and a `BLOCKING:` statement | The live database has something the platform history up to `--through` does not (or lacks something it has) | If the app **intends** it, declare it: add `{ "id": "app:<name>", "reason": "...", "expectDiff": ["<the statement>"] }` under `deviations` in `prisma/platform.lock` (the statement is printed normalised: no `"public".`, single spaces). If it is **not** intended, write an ordinary forward migration that fixes the database, apply it, and re-run. If the database is simply behind, lower `--through` |
| `INDEX_MISSING` or `INDEX_DEFINITION_DIFFERS` | A raw-SQL index was dropped, or re-created without its `WHERE` clause. Prisma's diff cannot see this | Re-create it from the definition printed, in a forward migration |
| `LEDGER_ROW_MISSING` | A directory you matched is not recorded as applied in this database | The database never applied it: lower `--through`, or apply it first |
| `LEDGER_CHECKSUM_MISMATCH` | The file was edited after the database applied it (Prisma does not notice) | Restore the file from Git. Never edit an applied migration |
| `PLACEMENT_IMPOSSIBLE` | Your directories do not sort in package order, or no free second exists between a migration and its successor | Rename the offending app directory (on a database that has not applied it yet) or re-map; a fresh database must apply the history in package order |
| `MAP_INVALID` | `--map` names an unknown id or directory, or a directory another migration already matches exactly | Fix the file |

An app that wrote its **own equivalent** of a platform migration must have
written it idempotently (`IF NOT EXISTS`). The platform's copy is placed
immediately after its predecessor, so on a fresh database it runs first and the
app's version is a no-op. Without that, a fresh database fails with
`column ... already exists`. The baseline refuses to place a directory where the
order would break.

## 6. Apply

Only when the dry run is clean, and on the copy first:

```bash
npm run db:baseline -- --apply
```

It logs each action, then prints the report with a `B6 verify` block. It:

1. Installs each platform migration without a directory as a **byte copy**,
   named so it sorts right after its package predecessor (a migration above
   `--through` goes to the end).
2. Runs `prisma migrate resolve --applied <dir>` for each migration at or below
   `--through` that the ledger does not record, in package order. Directories
   already recorded are skipped (Prisma answers a second `resolve` with `P3008`).
3. Writes `prisma/platform.lock`. It is written **last**: if a `resolve` fails,
   the directory created for that step is removed, no lock is written, and a
   re-run maps what was already resolved by hash.
4. Verifies: `prisma migrate status`, `platform db check`, and the ledger
   comparison. A partial adoption (`--through` below the newest) is expected to
   list exactly the installed migrations as not yet applied.

The paste-ready summary is the printed report. Commit the new directories and
`platform.lock` together.

If `platform.lock` already has entries, `--apply` refuses (`LOCK_NOT_EMPTY`);
`--force-remap` recomputes the mapping from the files and replaces the entries
(declared `deviations` and `rawSqlIndexes` are kept).

**Then, still on the copy:**

```bash
npm run prisma:migrate    # "No pending migrations to apply" (a partial adoption applies the rest here)
npm run prisma:seed
npm run db:check:database # the lock, the files and _prisma_migrations agree
npm run db:baseline       # a second dry run says "nothing to do"
```

A **fresh** database built from the adopted history must also deploy: create an
empty database and run `npm run prisma:migrate` against it, then
`npm run db:drift`. This is what proves the placement.

### A database Prisma never managed

If the schema is present but `_prisma_migrations` is not (`migrate deploy` fails
with `P3005`), the baseline says so, and records **every** migration up to
`--through` with `migrate resolve --applied`, which creates the ledger. It does
not touch your own (app-only) directories: resolve them yourself, in order,
before the first `prisma migrate deploy`, or deploy will try to run them.

## 7. Production

Only after the rehearsal's plan and result are what you expect:

1. Open a maintenance window ([maintenance-mode.md](maintenance-mode.md)).
2. Take another backup. The rehearsal's backup is stale by now.
3. Run the dry run against production and compare it with the rehearsal's report.
4. Run `--apply`, then the checks at the end of section 6, then
   `npm run prisma:seed`.
5. Deploy the app version that depends on `@marinoscar/platform-db`, then close
   the window.

## 8. A failed migration row

`LEDGER_FAILED_ROW` is the classic trap: `_prisma_migrations` has a row that never
finished, or was rolled back, and no later successful run of the same migration.
The live schema is in an unknown state, so the baseline stops before the diff.

1. Find it: `SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`
2. Look at what the migration did and what it left behind.
3. Resolve it with Prisma, per what you find: `npm run prisma -- migrate resolve --rolled-back <dir>` if you undid it by hand and want it re-applied, or `--applied <dir>` if its effect is fully in the database.
4. Re-run the dry run.

## 9. Rollback

The baseline writes one thing to the database: ledger rows, through
`migrate resolve --applied`. It never creates, drops or alters a table, column or
index. To undo a baseline:

- **Before `--apply`:** nothing to undo.
- **After `--apply`:** restore the backup you took in step 2 of section 7 (see
  [database-restore.md](database-restore.md)) and revert the commit that added the
  directories and `platform.lock`. For a rehearsal, drop the scratch database.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is not set` | Ran `platform` directly | Use `npm run db:baseline`; it builds the URL from `POSTGRES_*` |
| `permission denied to create database` | No `--shadow-database-url` and the role cannot create databases | Create an empty database and pass `--shadow-database-url` |
| `P3005 The database schema is not empty` on `migrate deploy` | The database was never managed by Prisma Migrate | Section 6, "A database Prisma never managed" |
| `P3008 The migration is already recorded as applied` | `migrate resolve --applied` on a recorded directory | The baseline skips recorded directories; this appears only if you ran it by hand |
| `column ... already exists` on a fresh database after the baseline | An app migration wrote the change non-idempotently, so it ran before the platform's copy | Make the app migration `IF NOT EXISTS` on a database that has not applied it, or re-map |
| `PACKAGE_FILE_MISMATCH` | A package file does not match its manifest hash | Reinstall the package |
| `THROUGH_UNKNOWN` | `--through` names no platform migration | Use `22`, `0022` or `platform:0022_slug` |
