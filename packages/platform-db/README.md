# @marinoscar/platform-db

The data layer of the platform: Prisma schema fragments (`schema/`), SQL migrations (`migrations/`) and seed functions that an app composes into its own schema and migration history. CommonJS, like the API that consumes it.

## Purpose and scope

Schema fragments, migrations and seeds of the platform's data slices, and the **composer** that turns the fragments into the Prisma schema an app generates its client from.

What ships today: the schema fragments (`schema/`, 39 models and 15 enums in nine slices), `platform db compose`, and the migration tooling (`platform db sync|check|promote|drift`, the `platform.lock` and `manifest.json` formats, the raw-SQL index list). The package also ships platform history v1: the base's 22 migrations as `migrations/0001_initial` to `0022_add_retention_created_at_indexes`, with a filled manifest, the raw-SQL index list `RAW_SQL_INDEXES` and its tripwire, and the offline `runDbConformance()` suite. The platform seed is shipped too: `seedPlatform` (the [`seed` slice](src/seed/README.md), `@marinoscar/platform-db/seed`). The package does not run migrations against a database itself; the app's `prisma:*` scripts do.

Status: pre-release (the current channel and how to install it: the [release runbook](../../docs/runbooks/release-platform-packages.md)). The `extend model` seam is `experimental` until the extension contract is frozen.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-db
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range | Required |
|---|---|---|
| `zod` | `^4.4.3` | yes (`lock`, and so `sync`, `drift`, `baseline` and the `platform db` CLI) |
| `prisma` | `^7.8.0` | optional: the `drift` slice and the CLI resolve its `build/index.js` at run time |
| `pg` | `^8.23.0` | optional: the `drift` slice loads it by name |

`@prisma/client` is not a peer of this package: the seed takes the app's client as a structural type ([the rule](../../docs/PACKAGES.md#peer-dependencies-per-slice)). The app has it anyway.

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
    "db:drift": "node scripts/platform-env.js db drift",
    "db:baseline": "node scripts/platform-env.js db baseline"
  }
}
```

```bash
npm run db:sync     # install package migrations the lock does not hold yet
npm run prisma:migrate   # apply them, explicitly (the API never migrates on startup)
npm run db:check    # prove the installed SQL is still byte-identical to the package's
```

`db:drift`, `db:baseline` (and `platform db check --database`) read `DATABASE_URL`; the reference app's `apps/api/scripts/platform-env.js` builds it from `POSTGRES_*` the way `prisma-env.js` does.

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

- Only a model its owner marked `// @extensible` can be extended: `User`, `Job`, `StorageObject`, `Organization` and `Group` today. Everything else is closed; opening one more is a minor-version change reached through a seam request, never an app edit.
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
| `identity.prisma` | `User` (`@extensible`), `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken`, `PersonalAccessToken`, `DeviceCode`, `AllowedEmail`, `AuditEvent`, `Organization`, `Membership`, `Invite` |
| `settings.prisma` | `SystemSettings`, `UserSettings`, `OrgSettings` |
| `storage.prisma` | `StorageObject` (`@extensible`), `StorageObjectChunk` |
| `credentials.prisma` | `Credential`, `UserCredential` |
| `notifications.prisma` | `Notification`, `NotificationDelivery`, `PushSubscription`, `NotificationBroadcast` |
| `jobs.prisma` | `Job` (`@extensible`), `JobStatsRollup`, `WorkerNode`, `NodeCredential`, `JobNodeSecret` |
| `db-backup.prisma` | `DatabaseBackupRun` |
| `ai.prisma` | `AiModel`, `UserAiKey`, `AiRun`, `AiUsageEvent` |
| `sharing.prisma` | `Group` (`@extensible`), `GroupMember`, `GroupInvite` |
| `android-app.prisma` | `AndroidAppRelease` (#746: the hosted Android APKs; `sizeBytes` BigInt; at most one current release through the raw-SQL index `android_app_releases_one_current_uniq_idx`) |

A slice declares the back-relations that point **into** another slice as `extend model` blocks in its own fragment (the 17 `User` fields that leave identity, and `Job.backupRun` in `db-backup.prisma`). Every block comment of the original schema is kept verbatim: they are the design documentation.

**Composition.** Package fragments load first, app fragments second, each alphabetically. `extend` blocks are appended to the target model before its first `@@` line under a `// composed from <origin>:<file>` comment. The output is `platform.<slice>.prisma` per package fragment and `app.<fragment>.prisma` per app fragment (a fragment of only `extend` blocks produces no file), each starting with `// GENERATED by platform db compose — do not edit` and `// source: <origin>:<file>`. The folder is committed and `--check` guards it.

**Schema-neutral.** Composing the shipped fragments reproduces the previous single `schema.prisma` exactly in content: `prisma migrate diff` from the old file to the generated folder, and from a database migrated by the 22 existing migrations to the folder, both report no difference.

**Raw-SQL indexes.** `jobs_active_dedup_uniq_idx`, `database_backup_runs_active_uniq_idx` and the other raw-SQL indexes live only in migration SQL, because Prisma cannot express a partial unique index. Never add an `@@unique` for them in a fragment; the comments in `jobs.prisma` and `db-backup.prisma` say why. [Raw-SQL indexes](#raw-sql-indexes) lists them, and a tripwire fails the build when a fragment redeclares one.

**Organizations.** The identity fragment owns `Organization`, `Membership` and `Invite` (tables `organizations`, `memberships`, `org_invites`) and the nullable `org_id` on `refresh_tokens`, `personal_access_tokens` and `device_codes` (migration `0023_add_organizations`). The migration backfills the default organization (slug `default`), one active membership per existing user and the default `org_id` on every existing credential row. The columns stay nullable (the expand step). Exactly one organization is the default, enforced by the raw-SQL index `organizations_default_uniq_idx`. These are identity tables read across organizations at login: no RLS on them.

**Tenant tables (`0025_org_scoped_rls`).** `org_id` (with a foreign key to `organizations`) is on `storage_objects`, `storage_object_chunks`, `ai_runs` (NOT NULL, `Restrict`), `ai_usage_events` (nullable, `SetNull`: a deployment-wide event and the history of a deleted organization keep no organization) and `audit_events` (nullable, `SetNull`, no policy). The four tables other than `audit_events` `ENABLE` and `FORCE ROW LEVEL SECURITY` with one policy each ([below](#row-level-security-policies)); `storage_object_chunks` links to its object with the composite `(object_id, org_id)`, because a foreign-key check bypasses row-level security. The migration backfills every existing row to the default organization (system audit actions and catalogue-sync usage keep NULL) inside a transaction that raises `app.rls_bypass`.

**Groups (`0026_add_groups`, #728).** The `sharing` fragment owns `Group`, `GroupMember` and `GroupInvite` (tables `groups`, `group_members`, `group_invites`) and the enum `GroupRole` (`admin`, `editor`, `viewer`). A group is a set of users inside one organization, never a tenant. All three carry a NOT NULL `org_id` (foreign key `Cascade`), `ENABLE` and `FORCE ROW LEVEL SECURITY` and a `<table>_org_isolation` policy; a member and an invite reach their group through the composite `(group_id, org_id)` -> `groups (id, org_id)` (the target of `@@unique([id, orgId])`). `group_invites_pending_uniq_idx` is the one raw-SQL index. `Group` is `// @extensible`, so an app table owned by a group adds its back-relation with `extend model Group`. New tables, so no backfill.

**Grants (`0027_add_grants`, #729).** The `sharing` fragment also owns `Grant` (table `grants`) and the enum `GrantGranteeKind` (`user`, `group`, `link`). A grant shares one record of an app's registered resource type, named polymorphically by `(resource_type, resource_id)` with no foreign key (the platform cannot know app tables; apps delete a record's grants in the same transaction and the `sharing.grants.prune` job catches the rest), with a role, an optional `expires_at` and a soft `revoked_at`. `org_id` is NOT NULL under a forced `grants_org_isolation` policy, and a group grantee reaches its group through the composite key `(grantee_group_id, org_id)`, so a grant cannot name another organization's group. The raw-SQL partial unique indexes `grants_active_user_uniq_idx` and `grants_active_group_uniq_idx` allow one active grant per resource and grantee, and the `CHECK` constraint `grants_grantee_consistency_check` keeps the grantee columns consistent with `grantee_kind` (a link grant has neither grantee and a `link_token_hash`). The link columns (`link_token_hash`, unique; `link_token_ciphertext`; `link_label`) are created now for #730.

**Organization settings (`0028_add_org_settings`, #733).** The `settings` fragment owns `OrgSettings` (table `org_settings`): one row per organization (`org_id` unique, foreign key to `organizations`, `Cascade`; `updated_by_user_id` `SetNull`) holding that organization's overrides of the org-overridable system settings namespaces, with a `version` of its own. NOT NULL `org_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY` and the `org_settings_org_isolation` policy. A new table, so no backfill; `system_settings` and `user_settings` are unchanged.

**Jobs carry their organization (`0030_add_jobs_org_id`, `0031_add_jobs_org_id_status_index`, #734).** The `jobs` fragment's `Job` gains `orgId` (`jobs.org_id`): nullable, no default (a metadata-only `ADD COLUMN`), foreign key to `organizations` `ON DELETE SET NULL` (added `NOT VALID`, then validated), so deleting an organization keeps its job history. `NULL` is a deployment-wide (system) job, and every earlier row is one. The `(org_id, status)` index `jobs_org_id_status_idx` is built `CONCURRENTLY` in `0031`, the only statement of that migration (`jobs` is a big table). Deliberately no row-level security on `jobs` (the claim is one cross-organization statement), and `jobs_active_dedup_uniq_idx` is unchanged.

**System and org roles.** Migration `0024_split_system_org_roles` (#723) adds the `RoleScope` enum (`system`, `org`), `roles.scope` and `permissions.scope` (default `system`), the required `memberships.role_id` (the member's org role, `onDelete: Restrict`) and the nullable `org_invites.role_id` (NULL means the default org role). Its data step creates `org_admin`, scopes `contributor`, `viewer` and the org permissions to `org`, moves `admin`'s org-permission grants to `org_admin`, sets each membership's role from the user's global roles (`admin` to `org_admin`, otherwise `contributor` over `viewer`, otherwise `viewer`) and deletes the `user_roles` rows of org roles; `user_roles` keeps its shape. `seedPlatform` writes the scope of every role and permission entry that carries one.

**Seeds** (`@marinoscar/platform-db/seed`, stability `experimental`; details in the [slice README](src/seed/README.md)). `seedPlatform(prisma, input, log?)` upserts the platform's roles, permissions, default role grants, the `global` `system_settings` row and the initial administrator's `allowed_emails` row, then creates the default organization when none is flagged default, in that order, and returns a summary. Idempotent: every write is an upsert on a natural unique, so a second run changes nothing, which is what `appctl deploy update` and the CI `smoke` job rely on. **Never deletes and never overwrites an admin-edited value:** a permission removed from the registry stays as a row until a migration removes it (expand/contract), and the settings row and the allowlist row are created with `update: {}`. `prisma` is the structural type `SeedPrisma` (the delegates `role`, `permission`, `rolePermission`, `systemSettings`, `allowedEmail`, `organization`), so the package never imports or bundles a generated client.

**Building the input** (`experimental`). `platformSeedInputFrom(snapshot, env)` builds the `PlatformSeedInput` from the registries' plain-data snapshots, and `readSeedSnapshot(catalogDir)` loads them from the two committed catalogs of an app's `prisma/catalog/` (`permissions.json`, `system-settings-defaults.json`). Seeds read generated catalogs, never `src/`: the production image carries `prisma/` but not `src/`. An app adds a permission or a setting by registering it and regenerating the catalogs, never by editing a platform file.

**The app's own seed** (the app's code, not the package's). The reference app's `prisma/seed.ts` runs `seedPlatform` and then `seedApp(prisma)` from [`prisma/seed-app.ts`](../../apps/api/prisma/seed-app.ts), the documented place for an app's own seed rows. Both are idempotent, and `seed.ts` stays Nest-free and runnable with `ts-node --transpile-only`.

**Public vs private.** An app may point at any model and add back-relations to the three `@extensible` ones. It never edits a platform fragment or a column of a platform table.

**Migrations.** `migrations/manifest.json` holds platform history v1 (below), and the reference app's `prisma/platform.lock` maps each entry to the directory the app already has. The install model ([ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md) D3):

- **Package history.** `migrations/NNNN_slug/migration.sql`, one linear, immutable history. `migrations/manifest.json` lists it: `[{ "id": "0001_initial", "dir": "0001_initial", "sha256": "…", "since": "1.0.0", "slice": "identity", "touches": ["settings", "storage"], "requires": [] }]`. `slice` is the first owner of the tables the migration creates or changes; `touches` (optional) lists the other slices whose tables it also changes. The origin id of an entry is `platform:` plus its `id`. The whole history is installed in order; slice opt-out is not supported in v1, and `requires` is checked as an ordering sanity check.
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
  `sha256` is the SHA-256 of the package file's raw bytes. It is also what Prisma stores in `_prisma_migrations.checksum` for a byte copy, which `apps/api/test/prisma/platform-sync.db.spec.ts` proves on a real database. Optional keys: `localSha256` and `note` (a comment-only divergence), `deviations`, `rawSqlIndexes`. A reader refuses a `lockVersion` newer than it knows. `platformVersion` and `since` are semantic versions, a prerelease included (`0.1.0-next.1`, which `platform db sync` writes when the installed package is a prerelease); versions are ordered by semver precedence, so `0.1.0-next.9` < `0.1.0-next.10` < `0.1.0`. Prisma's own `migration_lock.toml` is separate and untouched.
- **Raw bytes.** Hashes are over the bytes, never normalised: a changed comment, trailing newline or line ending is a different migration. The repository marks `**/migration.sql` as `-text` in `.gitattributes`.
- **`raw-sql-indexes.json`.** The partial and expression indexes that exist only in migration SQL, listed under [Raw-SQL indexes](#raw-sql-indexes) and exported as `RAW_SQL_INDEXES`.
- **Concurrent index builds.** A big-table index change is `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as the only statement of its own migration. Prisma runs a migration inside a transaction unless it contains only statements that cannot, and `CONCURRENTLY` cannot run in one.

### Platform history v1

The base's migrations, relocated byte for byte. The package ids are the platform's own numbering; the reference app keeps its original directory names (a rename would make `prisma migrate deploy` report every migration unknown and missing on an existing database), and its `platform.lock` maps each id to its directory with `since` `1.0.0`. `platform db check` proves the two copies are identical.

| Id | Reference app directory | Slice |
|---|---|---|
| `0001_initial` | `20260124223146_initial` | identity (touches settings, storage) |
| `0002_add_personal_access_tokens` | `20260329151231_add_personal_access_tokens` | identity |
| `0003_add_credentials` | `20260830211041_add_credentials` | credentials |
| `0004_add_notification_deliveries` | `20260831010356_add_notification_deliveries` | notifications |
| `0005_drop_stale_uuid_defaults` | `20260831014110_drop_stale_uuid_defaults` | identity (touches settings, storage) |
| `0006_add_notifications` | `20260831030721_add_notifications` | notifications |
| `0007_add_push_subscriptions` | `20260905182958_add_push_subscriptions` | notifications |
| `0008_add_jobs` | `20260906120000_add_jobs` | jobs |
| `0009_add_worker_nodes` | `20260906190000_add_worker_nodes` | jobs |
| `0010_add_database_backup_runs` | `20260907120000_add_database_backup_runs` | db-backup |
| `0011_add_notification_broadcasts` | `20260907130000_add_notification_broadcasts` | notifications |
| `0012_add_backup_run_job_link` | `20260907140000_add_backup_run_job_link` | db-backup (touches jobs) |
| `0013_add_job_node_secrets` | `20260907150000_add_job_node_secrets` | jobs |
| `0014_add_backup_run_pg_dump_version` | `20260907160000_add_backup_run_pg_dump_version` | db-backup |
| `0015_add_job_claim_token` | `20260908120000_add_job_claim_token` | jobs |
| `0016_add_ai_platform` | `20260926034919_add_ai_platform` | ai |
| `0017_revoke_viewer_ai_use` | `20260927000000_revoke_viewer_ai_use` | ai (touches identity) |
| `0018_add_user_credentials` | `20260927120000_add_user_credentials` | credentials |
| `0019_add_device_session_credential_link` | `20260927130000_add_device_session_credential_link` | identity |
| `0020_add_worker_node_vitals` | `20260928100000_add_worker_node_vitals` | jobs |
| `0021_add_job_trace_context` | `20260930120000_add_job_trace_context` | jobs |
| `0022_add_retention_created_at_indexes` | `20261006120000_add_retention_created_at_indexes` | notifications (touches ai) |

The history is frozen. A change to a package-owned table is a new migration appended with `platform db promote`, never an edit. Comments inside a `migration.sql` are part of its checksum, so a clean-up that strips comments must exclude `**/migration.sql`.

### Raw-SQL indexes

Prisma's schema language cannot express a partial index or an expression index, and `prisma migrate diff` ignores them in both directions, so they exist only in migration SQL. That is intentional schema drift: never "fix" it with `@@unique` or `@@index`, and never replace the index with a `findFirst` before the insert.

| Index | Table | Unique | Created in | Why | Design |
|---|---|---|---|---|---|
| `jobs_active_dedup_uniq_idx` | `jobs` | yes | `0008_add_jobs` | at most one pending or running job per `dedup_key` | [job-queue](../../docs/specs/job-queue.md) |
| `jobs_attempts_gt1_idx` | `jobs` | no | `0008_add_jobs` | retried jobs, for the queue insights report | [job-queue](../../docs/specs/job-queue.md) |
| `jobs_succeeded_duration_idx` | `jobs` | no | `0008_add_jobs` | finished succeeded jobs, for the duration percentiles | [job-queue](../../docs/specs/job-queue.md) |
| `database_backup_runs_active_uniq_idx` | `database_backup_runs` | yes | `0010_add_database_backup_runs`, re-created in `0012_add_backup_run_job_link` | at most one pending or running backup (a constant-expression key) | [database-backup](../../docs/specs/database-backup.md) |
| `organizations_default_uniq_idx` | `organizations` | yes | `0023_add_organizations` | exactly one default organization (a constant-expression key over `is_default`) | [platform-packages](../../docs/specs/platform-packages.md#tenancy-and-access-model) |
| `group_invites_pending_uniq_idx` | `group_invites` | yes | `0026_add_groups` | at most one PENDING invite per group and address; a declined, revoked or accepted one does not block a re-invite | [platform-packages](../../docs/specs/platform-packages.md#tenancy-and-access-model) |
| `grants_active_user_uniq_idx` | `grants` | yes | `0027_add_grants` | at most one ACTIVE (unrevoked) grant per resource and user; the grants API upserts on it | [platform-packages](../../docs/specs/platform-packages.md#tenancy-and-access-model) |
| `grants_active_group_uniq_idx` | `grants` | yes | `0027_add_grants` | at most one ACTIVE grant per resource and group | [platform-packages](../../docs/specs/platform-packages.md#tenancy-and-access-model) |

`raw-sql-indexes.json` is the one list (`name`, `table`, `unique`, `definition`, `reason`, `doc`, `createdIn`), exported as `RAW_SQL_INDEXES`. `platform db drift` asserts each against `pg_indexes` by name and definition, and `assertRawSqlIndexes` is the tripwire that travels with the package. It scans every manifest migration (ignoring comments, following `DROP INDEX` and `ALTER INDEX ... RENAME`) for a `CREATE [UNIQUE] INDEX` with a `WHERE` clause or an expression key, and fails when

- a migration creates one that is not in `RAW_SQL_INDEXES`,
- a listed one is not created, or its table, uniqueness or `createdIn` disagrees,
- a schema fragment declares `@@unique`, `@@index` or `@unique` under a listed index's name or on its table and key columns.

An app's own raw-SQL indexes go in its `platform.lock` under `rawSqlIndexes`; the drift test asserts them too.

### Row-level security policies

Prisma's schema language cannot express a policy either, and `prisma migrate diff` does not see one, so the tenant-isolation policies of `0025_org_scoped_rls`, `0026_add_groups`, `0027_add_grants` and `0028_add_org_settings` exist only in migration SQL, like the raw-SQL indexes. They are intentional drift too: never remove one to "fix" a diff.

| Policy | Table | Created in |
|---|---|---|
| `storage_objects_org_isolation` | `storage_objects` | `0025_org_scoped_rls` |
| `storage_object_chunks_org_isolation` | `storage_object_chunks` | `0025_org_scoped_rls` |
| `ai_runs_org_isolation` | `ai_runs` | `0025_org_scoped_rls` |
| `ai_usage_events_org_isolation` | `ai_usage_events` | `0025_org_scoped_rls` |
| `groups_org_isolation` | `groups` | `0026_add_groups` |
| `group_members_org_isolation` | `group_members` | `0026_add_groups` |
| `group_invites_org_isolation` | `group_invites` | `0026_add_groups` |
| `grants_org_isolation` | `grants` | `0027_add_grants` |
| `org_settings_org_isolation` | `org_settings` | `0028_add_org_settings` |

`rls-policies.json` is the one list (`name`, `table`, `reason`, `doc`, `createdIn`), exported as `RLS_POLICIES` beside `RAW_SQL_INDEXES`. `platform db drift` reads `pg_policies` and `pg_class` and reports `POLICY_MISSING` (a listed policy is not in the database), `POLICY_UNLISTED` (the database has one nobody listed), `RLS_NOT_ENABLED`, `RLS_NOT_FORCED` (the table does not `FORCE` it, so the owner, which is the application role, bypasses the policy) and `RLS_FORCED_WITHOUT_POLICY` (everything would be denied). `assertRlsPolicies` is the offline tripwire (`runDbConformance` runs it as `rls-policies`): it scans the manifest migrations and fails on `UNLISTED_POLICY`, `LISTED_POLICY_NOT_FOUND`, `LISTED_POLICY_MISMATCH` (`createdIn` disagrees) and a policy whose table the migrations never `ENABLE` / `FORCE`. The policy text and the settings it reads (`app.org_id`, `app.user_id`, `app.rls_bypass`, always `set_config(..., true)`) are specified in [SECURITY-ARCHITECTURE.md §18](../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls); the clients that set them are `PrismaService.forOrg` / `runInOrg` and `PrismaSystemService` in the reference app, built on the row-level-security helpers of `@marinoscar/platform-api/core` ([core README](../platform-api/src/core/README.md)).

A migration that enables row-level security carries `"rls": true` in the manifest (`platform db promote --rls`), and, because it changes what a connection can see, a partial `platform db baseline` that stops before it does so deliberately: a baseline through or past it needs `--allow-rls`, which is the operator's statement that the application role is already `NOSUPERUSER NOBYPASSRLS` (error `RLS_OPT_IN_REQUIRED` otherwise). `--touches <slices>` on promote records the other slices' tables a migration changes (`0025` touches `ai` and `identity` from the `storage` slice), so a baseline of a subset of slices can tell.

The exported functions (`planSync`, `applySync`, `checkLock`, `checkLedger`, `promote`, `readLock`, `readManifest`, `serializeLock`, `RAW_SQL_INDEXES`, `assertRawSqlIndexes`, `runDbConformance`) are `experimental` and documented in the API reference (`npm run docs:packages`).

## Permissions and settings

The data layer declares no permission or setting of its own; the API slices do. It **seeds** them: `seedPlatform` writes the roles, the permissions and the default grants an app's permission registry rendered into `prisma/catalog/permissions.json`, and the `global` system settings row from the settings namespaces' defaults in `prisma/catalog/system-settings-defaults.json` (stability `experimental`). A permission or a settings key is added in the registry plus a catalog regeneration (`npm run catalog:permissions`, `npm run catalog:settings` in the reference app), never in this package. Defaults are written once: the row is never overwritten, so a changed default reaches an existing deployment only through its own migration or the settings API.

## UI

None. The package renders nothing.

## Infra

None. The package ships no deployment configuration. The commands that touch a database (`db drift`, `db check --database`, `db baseline`) read `DATABASE_URL` (and optionally `SHADOW_DATABASE_URL`) from the environment of the process; the app's scripts build the first from its `POSTGRES_*` variables, and the package adds no variable of its own. The one variable the seed uses is `INITIAL_ADMIN_EMAIL` (the initial administrator), which `platformSeedInputFrom` reads only from the `env` object it is handed. CI runs `db:check`, `db:check:database` and `db:drift` in the `smoke` job after `prisma:migrate`.

## Observability

None. The package emits nothing at run time.

## Security notes

The composer reads and writes schema text only: it opens no database connection and reads no environment variable. A fragment cannot add a column to a platform table (the `EXTEND_SCALAR_FIELD` and `EXTEND_OWNING_RELATION` rejections), so an app cannot weaken a platform constraint through composition. No secret belongs in a fragment: secrets are stored encrypted in the `credentials`, `user_credentials` and `user_ai_keys` tables, never as a column that holds plaintext. Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants).

**Row-level security is only as strong as the role.** A superuser or `BYPASSRLS` role ignores every policy (`FORCE` included), so the policies protect nothing for an app that connects as one; the reference app's Doctor check `db.rls_role` fails in that case. A migration that backfills an RLS table runs as system work in an explicit transaction that sets `app.rls_bypass` (`BEGIN; SELECT set_config('app.rls_bypass', 'on', true); ... COMMIT;`), or the statement silently changes zero rows. Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants), and `platform db drift` asserts them against `pg_indexes` rather than filtering Prisma's diff. The tooling reads and writes only migration files, the lock and the manifest. It holds no credential: `db drift` and `check --database` use the `DATABASE_URL` the caller supplies, and `drift` creates and drops only its own throwaway shadow database. An installed migration is never edited: `platform.lock` proves it, and Prisma does not (`migrate deploy` and `migrate status` stay silent about an applied file that changed afterwards).

## Conformance suite

`runDbConformance({ appRoot })` registers the offline `db` suite in the app's own test run (Jest, or Vitest with `globals: true`; or pass `testApi`). It needs no database:

| Test | Fails when |
|---|---|
| `raw-sql-indexes` | the raw-SQL index tripwire above is tripped |
| `platform.lock` | an installed migration differs from the lock or the package, a package migration is not installed, or a locked directory is missing (the same check as `platform db check`) |

```ts
// apps/api/test/prisma/platform-db-conformance.spec.ts
import { runDbConformance } from '@marinoscar/platform-db';
runDbConformance({ appRoot: join(__dirname, '..', '..') });
```

It sits beside, not inside, `runPlatformConformance()` of `@marinoscar/platform-api/testing`: that harness scans TypeScript source roots, and this suite reads SQL and Prisma files. The real-database half (`platform db check --database` and `platform db drift`) runs in the app's `smoke` job, because it needs Postgres.

## Upgrade notes

After every version bump of `@marinoscar/platform-db`, run `npm run db:sync`, review the new directories under `prisma/migrations/`, commit them with the updated `platform.lock`, then `npm run prisma:migrate`. No version has been published yet, so there is nothing older to migrate from.

The first adoption of platform history v1 by an app that already has these tables is a **baseline**, not a sync: the database must not re-run the 22 migrations. The reference app is already baselined (its directories are the installed copies and `platform.lock` maps them); a fork or another app follows [the baseline runbook](../../docs/runbooks/database-baseline.md) with `platform db baseline` ([ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md) D4). **Baseline before the first deploy** of an app version that depends on this package, never from `appctl deploy update`.

`platform db baseline` is a dry run unless `--apply` is given, and a dry run writes nothing and runs no `prisma migrate resolve`:

| Step | What it does |
|---|---|
| B1 map | Matches each platform migration to one of the app's directories by identical bytes (a directory rename is irrelevant), else identical after stripping comments and whitespace (the lock records `localSha256` and a `note`), else the `--map <file.json>` (`{ "platform:0019_...": "<localDir>" }`). Reports unmatched migrations and app-only directories |
| B2 ledger | Every mapped directory must be a finished, non-rolled-back row of `_prisma_migrations` with the local file's checksum. A failed or rolled-back row is checked first and stops the run |
| B3 diff | Replays the package history up to `--through` in a shadow database and diffs it against the **live** database. A statement a `deviations[].expectDiff` entry of `platform.lock` declares is allowed; any other refuses |
| B4 indexes | Asserts every raw-SQL index of the package (up to `--through`) and of the lock's `rawSqlIndexes` in `pg_indexes`, name and definition |
| B5 act | `--apply` only. Installs each migration that has no directory (a byte copy placed right after its package predecessor, so a fresh database applies the history in package order), runs `prisma migrate resolve --applied` for those at or below `--through`, and writes `platform.lock` last |
| B6 verify | `prisma migrate status`, `platform db check` and the ledger comparison |

`--through <NNNN>` names the platform migration the database equals (default: the newest). Below the newest is partial adoption: the rest is installed, and `prisma migrate deploy` applies it. `--force-remap` allows `--apply` over a lock that already has entries. `--shadow-database-url` supplies the empty database the replay needs (default: a throwaway one is created next to the live one and dropped). There is no `--force`. It never creates, drops or alters a database object: the only write to the database is `migrate resolve --applied`, through the app's `scripts/prisma-env.js`. Exit code 0 when clean, 1 on a refusal or a failed verification, 2 on a usage error.

A migration that changes a package-owned table is authored in the base app and promoted into the package; see [Authoring a platform migration](../../docs/DEVELOPMENT.md#authoring-a-platform-migration). Only one pull request labelled `pp:migration` may be open at a time; a second one waits, rebases, deletes its local directory and re-runs `prisma migrate dev --create-only` and `platform db promote`, so its directory gets a newer timestamp.

## Troubleshooting

Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages). Composer errors print `file:line: CODE: message`.

| Symptom | Cause | Fix |
|---|---|---|
| `platform: @marinoscar/platform-db is not built` | The `platform` command runs `dist/` | `npm run build:packages` from the repository root |
| `db:compose:check` fails in CI | A fragment changed without re-composing, or a generated file was edited by hand | `npm run db:compose --workspace=api` and commit the result |
| `Seed catalog .../permissions.json cannot be read` | `readSeedSnapshot` was pointed at a folder without the committed catalogs | Run the app's catalog scripts and commit `prisma/catalog/` |
| A new permission is not granted after `prisma:seed` | The catalog is stale, so the registry's grant never reached the seed (the log prints `⊘ Skipped grant with no matching row`) | Regenerate the catalogs and re-run the seed |
| `NOT_EXTENSIBLE` | The model is not marked `// @extensible` by its owner | Use a side table keyed by the platform id, or file a seam request |
| `UNKNOWN_MODEL` | No fragment declares the model | Check the spelling; the model must exist in a platform or app fragment |
| `FIELD_COLLISION` | The field name already exists on the model or in an earlier `extend` | Rename the back-relation field |
| `EXTEND_SCALAR_FIELD`, `EXTEND_OWNING_RELATION`, `EXTEND_BLOCK_ATTRIBUTE` | The `extend` block would change the platform's table | Keep the column or index on your own model; the block holds back-relation fields only |
| `EXTEND_UNKNOWN_TYPE` | The field's type is no model | Declare the model in a fragment |
| `DUPLICATE_MODEL` | A model or enum is declared in two fragments | Declare it once; add relations to a platform model with `extend model` |
| `DUPLICATE_BASE` | A second `generator` of the same name or a second `datasource` | Provide a `base.prisma` in the app's fragments instead (it replaces the package's) |
| `MALFORMED` | A header or footer is not `prisma format` shaped | Put `<kind> <Name> {` on one line at column 0 and end the block with `}` alone at column 0 |
| `UNLISTED_RAW_INDEX` (tripwire) | A migration creates a partial or expression index that `raw-sql-indexes.json` does not list | Add it to `raw-sql-indexes.json` with a reason, its table and a design document |
| `LISTED_INDEX_NOT_FOUND`, `LISTED_INDEX_MISMATCH` (tripwire) | A listed index is not left by the migrations, is no longer partial, or its table, uniqueness or `createdIn` is wrong | Restore the migration, or correct the list entry |
| `FRAGMENT_DECLARES_RAW_INDEX` (tripwire) | A fragment has `@@unique`, `@@index` or `@unique` under a raw-SQL index's name or on its key columns | Remove it: Prisma would build a full index, and the drift is intentional |
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

`platform db baseline` refuses with a code, and prints the report first ([the runbook](../../docs/runbooks/database-baseline.md) has the fix for each):

| Code | Meaning | Fix |
|---|---|---|
| `LEDGER_FAILED_ROW` | `_prisma_migrations` has a row that never finished or was rolled back, with no later successful run | Resolve it with `prisma migrate resolve --rolled-back` or `--applied` after checking the database (runbook section 8) |
| `LEDGER_ROW_MISSING`, `LEDGER_CHECKSUM_MISMATCH` | A mapped directory is not recorded as applied, or its file was edited after it was | Lower `--through`, or restore the file from Git |
| `DIFF_BLOCKING` | The live database differs from the package history up to `--through` in a statement no deviation declares | Write a forward migration, declare it under `deviations` in `platform.lock` (the statement as printed), or lower `--through` |
| `INDEX_MISSING`, `INDEX_DEFINITION_DIFFERS` | A raw-SQL index is missing or lost its `WHERE` clause (Prisma's diff cannot see this) | Re-create it from the definition printed, in a forward migration |
| `LOCK_NOT_EMPTY` | `platform.lock` already has entries | `--force-remap`, after reading the dry run |
| `PLACEMENT_IMPOSSIBLE` | The directories cannot sort in package order | Rename an app directory the database has not applied, or re-map |
| `MAP_INVALID` | `--map` is not valid, or names a directory another migration already matches exactly | Fix the file |
| `THROUGH_UNKNOWN`, `PACKAGE_FILE_MISMATCH` | `--through` names no migration, or a package file does not match its manifest hash | Use `22`, `0022` or `platform:0022_slug`; reinstall the package |
| `RESOLVE_FAILED` | `prisma migrate resolve --applied` failed; the directory created for that step was removed and no lock was written | Read Prisma's message (`P3008` means the directory is already recorded); fix and re-run, the migrations already resolved are mapped by hash |

`permission denied to create database` means the role cannot create the throwaway shadow database: pass `--shadow-database-url`. `P3005` on `migrate deploy` means the database was never managed by Prisma Migrate: the baseline records every migration up to `--through` with `migrate resolve --applied`, which creates the ledger.

`platform db drift` prints `SCHEMA_DRIFT` with the SQL that is in the schema but in no migration (add a migration), `INDEX_MISSING` or `INDEX_DEFINITION_DIFFERS` for a raw-SQL index that was dropped or re-created without its `WHERE` clause. `Error: You must set datasource.shadowDatabaseUrl` means `prisma.config.ts` does not pass `process.env.SHADOW_DATABASE_URL` through.

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md): the fragment layout, the `extend model` syntax and the rule table (D1, D2)

- [ADR 0002](../../docs/adr/0002-database-packaging-and-rls.md): why migrations are installed with app-local timestamps and a lock (D3)
- [Authoring a platform migration](../../docs/DEVELOPMENT.md#authoring-a-platform-migration): `migrate dev --create-only`, `promote`, and the one-open-`pp:migration`-PR rule
- [`seed` slice README](src/seed/README.md): `seedPlatform`, input building, the never-delete rule and the app seed hook
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Making Database Changes](../../docs/DEVELOPMENT.md#making-database-changes): the schema editing workflow
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands

