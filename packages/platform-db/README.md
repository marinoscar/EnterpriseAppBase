# @marinoscar/platform-db

The data layer of the platform: Prisma schema fragments (`schema/`), SQL migrations (`migrations/`) and seed functions that an app composes into its own schema and migration history. CommonJS, like the API that consumes it.

## Purpose and scope

Schema fragments, migrations and seeds of the platform's data slices, and the **composer** that turns the fragments into the Prisma schema an app generates its client from.

What ships today: the schema fragments (`schema/`, 31 models and 10 enums in eight slices), `platform db compose`, and the migration tooling (`platform db sync|check|promote|drift`, the `platform.lock` and `manifest.json` formats, the raw-SQL index list). The platform migrations themselves arrive with a later story (the manifest is empty and the app's own `prisma/migrations` still holds the history), and so do the seeds. The package does not run migrations against a database itself; the app's `prisma:*` scripts do.

Status: pre-release (version `0.0.0`). The `extend model` seam is `experimental` until the extension contract is frozen.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-db
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@prisma/client` | `^7.8.0` |
| `prisma` | `^7.8.0` |

## Quick start

In an app that already depends on the package (the reference app is `apps/api`):

```bash
# once, and after pulling platform changes: the `platform` command runs the built package
npm run build:packages

cd apps/api
npm run db:compose          # platform fragments + prisma/fragments/ -> prisma/schema/ (committed)
npm run prisma:generate
npm run db:compose:check    # CI: exits 1 when prisma/schema/ differs from a fresh compose
```

`apps/api/package.json` wires the two scripts as `"db:compose": "platform db compose"` and `"db:compose:check": "platform db compose --check"`, and `apps/api/prisma.config.ts` points Prisma at the folder:

```ts
export default defineConfig({
  schema: 'prisma/schema',                    // the generated FOLDER
  datasource: { url: process.env.DATABASE_URL as string },
  migrations: { path: 'prisma/migrations' },  // must be explicit with a schema folder
});
```

To add an app model that points at a platform model, see the example in [Extension-point catalog](#extension-point-catalog).

**Migrations.** Wire the commands into the app's `package.json` and run them from the directory that holds `prisma/`:

```json
{
  "scripts": {
    "db:sync": "platform db sync",
    "db:check": "platform db check",
    "db:drift": "node scripts/platform-env.js db drift"
  }
}
```

```bash
npm run db:sync     # install package migrations the lock does not hold yet
npm run prisma:migrate   # apply them, explicitly (the API never migrates on startup)
npm run db:check    # prove the installed SQL is still byte-identical to the package's
```

`db:drift` (and `platform db check --database`) read `DATABASE_URL`; the reference app's `apps/api/scripts/platform-env.js` builds it from `POSTGRES_*` the way `prisma-env.js` does.

## Configuration

`platform db compose [--check]` reads `--platform-schema` (default: the `schema/` folder shipped in this package) and the app's `--fragments` folder, and writes `--out`. Paths are relative to `--root` (default: the current directory).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--check` | flag | off | Write nothing; exit 1 and print a diff when the generated folder differs from a fresh compose |
| `--root <dir>` | path | current directory | The app's directory |
| `--fragments <dir>` | path | `prisma/fragments` | The app's own fragments (a missing folder means none) |
| `--out <dir>` | path | `prisma/schema` | The generated folder Prisma reads |
| `--platform-schema <dir>` | path | the package's `schema/` | Override the platform fragments (tests, unusual layouts) |

Exit codes: 0 success, 1 `--check` found a stale folder, 2 a rejected fragment or a usage error.

The programmatic API takes the same three folders as `ComposeOptions` (`platformSchemaDir`, `appFragmentsDir`, `outDir`): `composeSchema()` reads and returns the files (no write), `writeComposedSchema()` also writes and removes stale `*.prisma` files, `checkComposedSchema()` compares.

**Migration commands.** The package is tooling and data, with no `forRoot()` or module option. The commands take flags:

| Command | Flags |
|---|---|
| `platform db sync` | `--check` (same as `check`), `--dry-run`, `--timestamp <iso>` (the clock for the new directory names), `--root <dir>`, `--package-dir <dir>` |
| `platform db check` | `--database` (also compare `_prisma_migrations`; needs `DATABASE_URL`), `--root`, `--package-dir` |
| `platform db promote <localDir>` | `--id <slug>` (required), `--since <version>`, `--slice <slice>`, `--requires <slices>`, `--root`, `--package-dir` |
| `platform db drift` | `--schema <path>` (default `prisma/schema`, else `prisma/schema.prisma`), `--shadow-database-url <url>`, `--root` |

`--root` is the directory holding `prisma/` (default: the current directory). `--package-dir` is the package that holds `migrations/` (default: the installed one). Exit codes: `0` success, `1` a failed check or a refusal, `2` a usage error or a missing `DATABASE_URL`.

`SHADOW_DATABASE_URL`, when set, names the empty database `db drift` replays the history into; otherwise it creates and drops `<database>_drift_shadow_<pid>`, which needs a role that may create databases. The app's `prisma.config.ts` must pass it through as `datasource.shadowDatabaseUrl` (Prisma refuses `migrate diff --from-migrations` without one).

## Extension-point catalog

The one seam of the data layer is the `extend model` block, written in the app's fragment folder (`ComposeOptions.appFragmentsDir`). The row below names the option that locates it.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `ComposeOptions.appFragmentsDir` | option | `extend model <Model> { <back-relation field> }` in a `*.prisma` file of the folder | An app model points at a platform model (`User`, `Job`, `StorageObject`) and Prisma needs the back-relation field on the platform side | experimental | [example](../../apps/api/prisma/fragments/README.md) |

Stability stays `experimental` until the extension contract is frozen (issue #727).

**`extend model`**

```prisma
// apps/<app>/prisma/fragments/workouts.prisma
model Workout {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("workouts")
}

extend model User {
  workouts Workout[]
}
```

Run `npm run db:compose`, then `include: { workouts: true }` type-checks on the generated client. The compiled fixture is [`test/fixtures/app-with-domain/`](test/fixtures/app-with-domain/fragments/workouts.prisma): it extends `User`, `StorageObject` and `Job`, and `test/compose/app-with-domain.spec.ts` runs `prisma validate`, `prisma generate` and `tsc` against it.

Rules:

- Only a model its owner marked `// @extensible` can be extended: `User`, `Job` and `StorageObject` today. Everything else is closed; opening one more is a minor-version change reached through a seam request, never an app edit.
- An `extend` block holds back-relation fields only: no scalar field (it would add a column), no relation with `fields: [...]` (it would add a foreign key column), no `@@` attribute.
- The slice or app that owns the foreign key writes the back-relation; the composer merges what is written and generates nothing.
- Fragments are `prisma format` shaped: a block header is `<kind> <Name> {` on one line at column 0, and the block ends with `}` alone at column 0.
- An app fragment named `base.prisma` replaces the package's `base.prisma` (the generator and datasource), which is how an app sets the generator `output` or `previewFeatures`. The composer warns when it does.

The migration tooling adds no row to the catalog. How an app extends the migration history, which is a convention rather than a code seam:

- **The app's own migrations live after the installed ones.** `platform db sync` names every installed directory after the newest directory already in `prisma/migrations`, so an app-authored migration and an installed one never reorder. The app keeps authoring with `prisma migrate dev`; those directories are not in `platform.lock`.
- **App-owned raw-SQL indexes** go in `platform.lock` under `rawSqlIndexes` (`name` and `pg_indexes.indexdef`); `platform db drift` asserts them next to the package's own.
- **A comment-only difference** between an installed file and its package origin is recorded in the lock entry as `localSha256` plus `note`; any further edit is still caught.
- **`platform db promote` is platform-internal.** It is how a maintainer turns a migration generated in the base app into a package migration; an app that only consumes the package never runs it.

## Data

**Fragments** (`schema/`, hand-edited by the platform; one file per slice, enums travel with their model):

| Fragment | Models |
|---|---|
| `base.prisma` | `generator client`, `datasource db` |
| `identity.prisma` | `User` (`@extensible`), `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken`, `PersonalAccessToken`, `DeviceCode`, `AllowedEmail`, `AuditEvent` |
| `settings.prisma` | `SystemSettings`, `UserSettings` |
| `storage.prisma` | `StorageObject` (`@extensible`), `StorageObjectChunk` |
| `credentials.prisma` | `Credential`, `UserCredential` |
| `notifications.prisma` | `Notification`, `NotificationDelivery`, `PushSubscription`, `NotificationBroadcast` |
| `jobs.prisma` | `Job` (`@extensible`), `JobStatsRollup`, `WorkerNode`, `NodeCredential`, `JobNodeSecret` |
| `db-backup.prisma` | `DatabaseBackupRun` |
| `ai.prisma` | `AiModel`, `UserAiKey`, `AiRun`, `AiUsageEvent` |

A slice declares the back-relations that point **into** another slice as `extend model` blocks in its own fragment (the 17 `User` fields that leave identity, and `Job.backupRun` in `db-backup.prisma`). Every block comment of the original schema is kept verbatim: they are the design documentation.

**Composition.** Package fragments load first, app fragments second, each alphabetically. `extend` blocks are appended to the target model before its first `@@` line under a `// composed from <origin>:<file>` comment. The output is `platform.<slice>.prisma` per package fragment and `app.<fragment>.prisma` per app fragment (a fragment of only `extend` blocks produces no file), each starting with `// GENERATED by platform db compose — do not edit` and `// source: <origin>:<file>`. The folder is committed and `--check` guards it.

**Schema-neutral.** Composing the shipped fragments reproduces the previous single `schema.prisma` exactly in content: `prisma migrate diff` from the old file to the generated folder, and from a database migrated by the 22 existing migrations to the folder, both report no difference.

**Raw-SQL indexes.** `jobs_active_dedup_uniq_idx`, `database_backup_runs_active_uniq_idx` and the other raw-SQL indexes live only in migration SQL, because Prisma cannot express a partial unique index. Never add an `@@unique` for them in a fragment; the comments in `jobs.prisma` and `db-backup.prisma` say why.

**Public vs private.** An app may point at any model and add back-relations to the three `@extensible` ones. It never edits a platform fragment or a column of a platform table.

**Migrations.** `migrations/manifest.json` is `[]`: the base's 22 migrations move in with the migration-move story, so `db:check` passes trivially today. What exists is the install model ([ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md) D3):

- **Package history.** `migrations/NNNN_slug/migration.sql`, one linear, immutable history. `migrations/manifest.json` lists it: `[{ "id": "0001_initial", "dir": "0001_initial", "sha256": "…", "since": "1.0.0", "slice": "identity", "requires": [] }]`. The origin id of an entry is `platform:` plus its `id`. The whole history is installed in order; slice opt-out is not supported in v1, and `requires` is checked as an ordering sanity check.
- **Install.** `platform db sync` byte-copies each migration missing from the lock into `prisma/migrations/<YYYYMMDDHHMMSS>_<slug>/migration.sql` and appends a lock entry. The timestamp of the i-th migration of a run is `max(now, newest local timestamp + 1 second) + i seconds` (UTC), so it sorts after everything already there. A second run installs nothing. It never rewrites or renames an existing directory.
- **`prisma/platform.lock`.** JSON, committed, keys sorted:
  ```json
  {
    "lockVersion": 1,
    "migrations": [
      { "localDir": "20260124223146_initial", "originId": "platform:0001_initial", "sha256": "…", "since": "1.0.0" }
    ],
    "platformVersion": "1.0.0"
  }
  ```
  `sha256` is the SHA-256 of the package file's raw bytes. It is also what Prisma stores in `_prisma_migrations.checksum` for a byte copy, which `apps/api/test/prisma/platform-sync.db.spec.ts` proves on a real database. Optional keys: `localSha256` and `note` (a comment-only divergence), `deviations`, `rawSqlIndexes`. A reader refuses a `lockVersion` newer than it knows. Prisma's own `migration_lock.toml` is separate and untouched.
- **Raw bytes.** Hashes are over the bytes, never normalised: a changed comment, trailing newline or line ending is a different migration. The repository marks `**/migration.sql` as `-text` in `.gitattributes`.
- **`raw-sql-indexes.json`.** The partial and expression indexes that exist only in migration SQL because Prisma cannot express them (`jobs_active_dedup_uniq_idx`, `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx`, `database_backup_runs_active_uniq_idx`), each with its definition, a reason and the migration that creates it.
- **Concurrent index builds.** A big-table index change is `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as the only statement of its own migration. Prisma runs a migration inside a transaction unless it contains only statements that cannot, and `CONCURRENTLY` cannot run in one.

The exported functions (`planSync`, `applySync`, `checkLock`, `checkLedger`, `promote`, `readLock`, `readManifest`, `serializeLock`) are `experimental` and documented in the API reference (`npm run docs:packages`).

## Permissions and settings

None. The data layer declares no permission or setting; the API slices do.

## UI

None. The package renders nothing.

## Infra

None. The package ships no deployment configuration. The two commands that touch a database read `DATABASE_URL` (and optionally `SHADOW_DATABASE_URL`) from the environment of the process; the app's scripts build the first from its `POSTGRES_*` variables, and the package adds no variable of its own. CI runs `db:check`, `db:check:database` and `db:drift` in the `smoke` job after `prisma:migrate`.

## Observability

None. The package emits nothing at run time.

## Security notes

The composer reads and writes schema text only: it opens no database connection and reads no environment variable. A fragment cannot add a column to a platform table (the `EXTEND_SCALAR_FIELD` and `EXTEND_OWNING_RELATION` rejections), so an app cannot weaken a platform constraint through composition. No secret belongs in a fragment: secrets are stored encrypted in the `credentials`, `user_credentials` and `user_ai_keys` tables, never as a column that holds plaintext. Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants).

Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants), and `platform db drift` asserts them against `pg_indexes` rather than filtering Prisma's diff. The tooling reads and writes only migration files, the lock and the manifest. It holds no credential: `db drift` and `check --database` use the `DATABASE_URL` the caller supplies, and `drift` creates and drops only its own throwaway shadow database. An installed migration is never edited: `platform.lock` proves it, and Prisma does not (`migrate deploy` and `migrate status` stay silent about an applied file that changed afterwards).

## Conformance suite

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness.

## Upgrade notes

After every version bump of `@marinoscar/platform-db`, run `npm run db:sync`, review the new directories under `prisma/migrations/`, commit them with the updated `platform.lock`, then `npm run prisma:migrate`. No version has been published yet, so there is nothing older to migrate from.

A migration that changes a package-owned table is authored in the base app and promoted into the package; see [Authoring a platform migration](../../docs/DEVELOPMENT.md#authoring-a-platform-migration). Only one pull request labelled `pp:migration` may be open at a time; a second one waits, rebases, deletes its local directory and re-runs `prisma migrate dev --create-only` and `platform db promote`, so its directory gets a newer timestamp.

## Troubleshooting

Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages). Composer errors print `file:line: CODE: message`.

| Symptom | Cause | Fix |
|---|---|---|
| `platform: @marinoscar/platform-db is not built` | The `platform` command runs `dist/` | `npm run build:packages` from the repository root |
| `db:compose:check` fails in CI | A fragment changed without re-composing, or a generated file was edited by hand | `npm run db:compose --workspace=api` and commit the result |
| `NOT_EXTENSIBLE` | The model is not marked `// @extensible` by its owner | Use a side table keyed by the platform id, or file a seam request |
| `UNKNOWN_MODEL` | No fragment declares the model | Check the spelling; the model must exist in a platform or app fragment |
| `FIELD_COLLISION` | The field name already exists on the model or in an earlier `extend` | Rename the back-relation field |
| `EXTEND_SCALAR_FIELD`, `EXTEND_OWNING_RELATION`, `EXTEND_BLOCK_ATTRIBUTE` | The `extend` block would change the platform's table | Keep the column or index on your own model; the block holds back-relation fields only |
| `EXTEND_UNKNOWN_TYPE` | The field's type is no model | Declare the model in a fragment |
| `DUPLICATE_MODEL` | A model or enum is declared in two fragments | Declare it once; add relations to a platform model with `extend model` |
| `DUPLICATE_BASE` | A second `generator` of the same name or a second `datasource` | Provide a `base.prisma` in the app's fragments instead (it replaces the package's) |
| `MALFORMED` | A header or footer is not `prisma format` shaped | Put `<kind> <Name> {` on one line at column 0 and end the block with `}` alone at column 0 |
| `Could not find Prisma Schema` | `prisma.config.ts` has no `schema` | Set `schema: 'prisma/schema'` |
| `No migration found in prisma/migrations` | `migrations.path` missing: with a schema folder the default becomes `<schema folder>/migrations` | Set `migrations: { path: 'prisma/migrations' }` |

Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages). Each `platform db check` problem names the migration and has one fix:

| Code | Meaning | Fix |
|---|---|---|
| `LOCAL_MODIFIED` | An installed `migration.sql` no longer hashes to the lock | Restore the file from Git. Never edit an installed migration; add a new one. If it differs from the package only in comments, record `localSha256` and `note` in the lock entry |
| `PACKAGE_MODIFIED` | The lock's hash differs from the manifest's for that migration: a released package migration was rewritten | Restore the package file and manifest entry; fix the mistake in a new migration |
| `PACKAGE_FILE_MODIFIED` | The package's `migration.sql` differs from its manifest hash, or is missing | Restore the file, or reinstall the package |
| `NOT_INSTALLED` | A package migration is not in the lock | Run `npm run db:sync` |
| `LOCAL_DIR_MISSING` | A directory the lock names does not exist | Restore it from Git; do not rename installed directories |
| `NOT_IN_PACKAGE` | The lock names a migration the manifest no longer has | A package must never drop a released migration; reinstall the matching version |
| `LOCAL_OUT_OF_ORDER` | Installed directories do not sort in package order | Restore the original directory names; a fresh database would apply them in another order |
| `LEDGER_CHECKSUM_MISMATCH` (`--database`) | A file was edited after the database applied it | Restore the file; the database keeps the original checksum |
| `LEDGER_UNFINISHED` (`--database`) | A row of `_prisma_migrations` never finished | `prisma migrate resolve --rolled-back <dir>` or `--applied <dir>`, after checking the database |

`platform db sync` refuses with `LOCK_GAP` (the lock is not an in-order prefix of the package history: restore `platform.lock`), `REQUIRES_VIOLATION` (a manifest entry requires a slice no earlier entry provides: a package bug) or `PACKAGE_FILE_MISMATCH` (a package file does not match its manifest hash; nothing is copied). `platform db promote` refuses with `PROMOTE_NOT_SYNCED` (run `db:sync` first), `PROMOTE_ORDER` (the directory sorts before the last installed platform migration: rebase and regenerate it) and `PROMOTE_CONFLICT` (the slug or directory is already recorded with different bytes).

`platform db drift` prints `SCHEMA_DRIFT` with the SQL that is in the schema but in no migration (add a migration), `INDEX_MISSING` or `INDEX_DEFINITION_DIFFERS` for a raw-SQL index that was dropped or re-created without its `WHERE` clause. `Error: You must set datasource.shadowDatabaseUrl` means `prisma.config.ts` does not pass `process.env.SHADOW_DATABASE_URL` through.

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md): the fragment layout, the `extend model` syntax and the rule table (D1, D2)

- [ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md): why migrations are installed with app-local timestamps and a lock (D3)
- [Authoring a platform migration](../../docs/DEVELOPMENT.md#authoring-a-platform-migration): `migrate dev --create-only`, `promote`, and the one-open-`pp:migration`-PR rule
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Making Database Changes](../../docs/DEVELOPMENT.md#making-database-changes): the schema editing workflow
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands

