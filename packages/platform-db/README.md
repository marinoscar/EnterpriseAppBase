# @marinoscar/platform-db

The data layer of the platform: Prisma schema fragments (`schema/`), SQL migrations (`migrations/`) and seed functions that an app composes into its own schema and migration history. CommonJS, like the API that consumes it.

## Purpose and scope

Schema fragments, migrations and seeds of the platform's data slices, and the **composer** that turns the fragments into the Prisma schema an app generates its client from.

What ships today: the schema fragments (`schema/`, 31 models and 10 enums in eight slices) and `platform db compose`. Migrations (`migrations/`) and seeds arrive with later stories; today the app's own `prisma/migrations` still holds the history. The package does not run migrations against a database itself; the app's `prisma:*` scripts do.

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

## Permissions and settings

None. The data layer declares no permission or setting; the API slices do.

## UI

None. The package renders nothing.

## Infra

None. The package ships no deployment configuration and reads no environment variable; the database connection is the app's.

## Observability

None. The package emits nothing at run time.

## Security notes

The composer reads and writes schema text only: it opens no database connection and reads no environment variable. A fragment cannot add a column to a platform table (the `EXTEND_SCALAR_FIELD` and `EXTEND_OWNING_RELATION` rejections), so an app cannot weaken a platform constraint through composition. No secret belongs in a fragment: secrets are stored encrypted in the `credentials`, `user_credentials` and `user_ai_keys` tables, never as a column that holds plaintext. Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants).

## Conformance suite

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness.

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

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

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md): the fragment layout, the `extend model` syntax and the rule table (D1, D2)
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Making Database Changes](../../docs/DEVELOPMENT.md#making-database-changes): the schema editing workflow
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands

