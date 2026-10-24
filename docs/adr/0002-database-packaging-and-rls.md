# 0002. Database packaging and row-level security

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** platform owner
- **Tracking:** issue #708 (PP-5.1), epic #664, program #659
- **Promotes:** decision-log entries P5 (package migrations are installed into each app's own history, with a baseline procedure) and P7 (RLS on `org_id`, plus app policy inside an org) of the [platform packages spec](../specs/platform-packages.md#decision-log)
- **Evidence:** the spike scripts under [`spike/`](../../spike/README.md) and their recorded transcripts in [`spike/results/`](../../spike/results/). Prisma 7.9.1, PostgreSQL 16.14, PgBouncer 1.22.0, Node 22.

## Verdict

**GO.** Every question Q1 to Q5 passed with the recommended option, so the tooling stories (#709 to #713) and the RLS story (#725) can proceed with the contracts below. Q6 (RDS Proxy pinning) cannot be measured without an AWS account; it does **not** block the verdict, and until it is measured the assumption is **PgBouncer on ECS** (see [Q6](#q6-rds-proxy-pinning-unmeasured)).

| Technique | Call | One-line reason |
|---|---|---|
| Multi-file Prisma schema (a folder of slice files) | **GO** | `generate`, `migrate dev/deploy/diff/resolve`, the `npm run prisma:*` scripts and the Dockerfile all work; the client differs only in declaration order |
| Composed models by `extend model` fragments (option 1) | **GO** | Typed relations and `include` survive on `User`, `Job` and `StorageObject`; the real schema decomposes and recomposes to an empty `migrate diff` |
| Plain `userId` plus a raw-SQL foreign key (option 2) | **NO-GO** | Loses `include`, nested writes and relation filters, and creates real drift: Prisma wants to drop the hand-written key |
| Install package migrations into the app history, with a lock | **GO** | A byte copy keeps Prisma's checksum; the naming rule orders package and app migrations correctly; the lock catches edits Prisma ignores |
| Baseline an existing database with `migrate resolve --applied` | **GO** | Works on a fork, a partial fork, a database Prisma never managed and a restored-backup rehearsal, with one addition: a catalogue check for the raw-SQL indexes, which Prisma's diff cannot see |
| RLS by transaction-local `set_config`, bypass option **A** (`FORCE` plus a transaction-local bypass flag set only by a separate system client) | **GO** | Fail-closed, no new role, no new environment variable, survives PgBouncer in transaction mode, works for the in-API dump, the minted per-job role and `pg_restore` |
| Bypass option **B** (`ENABLE` without `FORCE`, `SET LOCAL ROLE`) | **NO-GO** | Unscoped code sees every org's rows: it fails open |
| Bypass option **C** (a `BYPASSRLS` login) | **NO-GO as the default** | A new deployment secret; the per-job role broker cannot mint such a role; RDS support is unmeasured. It stays the documented fallback if A proves unusable on a managed provider |
| RDS Proxy pinning | **Unmeasured** | Manual check: [rds-proxy-rls-check.md](../runbooks/rds-proxy-rls-check.md). Fallback assumed: PgBouncer on ECS |

Four findings changed the design relative to the issue and the spec, and are the reason the contracts below differ from them:

1. **Prisma 7.9 does not report the four raw-SQL indexes as drift at all** (nor RLS state). The "allowed-drift list" therefore cannot be a filter over `migrate diff` output; it is a **positive catalogue assertion** over `pg_indexes` ([Q4](#q4-baseline-on-a-database-copy)).
2. **`pg_dump --enable-row-security` without the bypass option exits 0 and writes an archive with zero rows.** A silent empty backup is the failure mode to design against ([Q5](#q5-row-level-security-with-prisma-and-a-pooler)).
3. **A parallel `pg_restore -j N` fails on a `FORCE`d table** unless `--enable-row-security` is passed, and the application restores with `-j` ([Q5](#q5-row-level-security-with-prisma-and-a-pooler)).
4. **RLS is inert for a superuser or `BYPASSRLS` role, and every Compose file in this repository connects as the `postgres` superuser** (`POSTGRES_USER=postgres`). RLS can only be real once the application connects as an ordinary role ([Consequences](#consequences)).

## Context

The identity wave (#665) and every app baseline (EvoPath #747, kvox #757, MemoriaHub #770) depend on six database questions that had no answer in code. The [spec](../specs/platform-packages.md#data-migrations-and-seeds) leaned towards a composed `User` model and left the rest open.

- `apps/api/prisma/schema.prisma` declares 31 models and 10 enums. `model User` carries 25 back-relation fields, one for every model that references a user. Prisma requires the field on both sides of a relation and cannot extend a model across files, so once `User` ships in `@marinoscar/platform-db`, an app that adds `Workout.userId` would have to edit a model it does not own. The same holds for `Job` and `StorageObject`.
- The API is on `prisma` and `@prisma/client` 7.9.1 with `@prisma/adapter-pg`, a `prisma.config.ts` that reads `DATABASE_URL` (built from `POSTGRES_*` by `scripts/prisma-env.js`), and 22 migration directories (21 when the issue was written; #681 added `20261006120000_add_retention_created_at_indexes`, plain `created_at` indexes, while the spike ran, and the scripts count the history rather than assume it).
- Prisma stores a checksum of each applied `migration.sql`; the order of migration directories is lexicographic by name.
- The database backup and restore paths constrain RLS: `buildPgDumpArgs` passes `--no-owner --no-acl`, worker nodes dump through a minted SELECT-only role (`pg-job-role.broker.ts`), restore replays with `pg_restore -j`, and cluster-admin work already uses a connection Prisma does not pool (`admin-connection.util.ts`).

The spec's RLS constraints are binding and this ADR keeps them: settings are **transaction-local**, and cross-org system work uses a **separate bypass connection**.

## Decision

### D1. The schema is a folder; two config lines change

`apps/api/prisma.config.ts` gains `schema` and an explicit `migrations.path`:

```ts
export default defineConfig({
  schema: 'prisma/schema',                       // a FOLDER of *.prisma files
  datasource: { url: process.env.DATABASE_URL as string },
  migrations: {
    path: 'prisma/migrations',                   // MUST be explicit with a folder
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
```

- Without `schema`, a folder is **not** found ("Could not find Prisma Schema"). The path is resolved relative to the config file, not the working directory.
- With a schema folder, the **default** migrations directory becomes `<schema folder>/migrations`, not the sibling `prisma/migrations`. Without `migrations.path` the CLI reports `No migration found in prisma/migrations` (the label is misleading) on a database whose history is intact. Set it explicitly.
- `generator` and `datasource` are declared **once**, in `base.prisma`. A second `generator` of the same name in a slice file is rejected by Prisma (`P1012`).
- The `npm run prisma:*` scripts in `apps/api/package.json` and `scripts/prisma-env.js` are **unchanged**. The Dockerfile is **unchanged**: it copies `apps/api/prisma` (which now carries the generated folder) and `prisma.config.ts`, and the dummy-URL `npx prisma generate` works.
- `prisma migrate dev` no longer accepts `--skip-seed` in Prisma 7 (seeding is not automatic), so no script may pass it.

### D2. Fragment layout and the `extend model` syntax (the contract for #709)

**Layout**

```
packages/platform-db/schema/                 platform-owned fragments (hand-edited)
  base.prisma                                generator + datasource, the only place
  identity.prisma  jobs.prisma  ai.prisma  notifications.prisma
  storage.prisma   db-backup.prisma  settings.prisma  credentials.prisma
apps/<app>/prisma/fragments/*.prisma         app models and `extend model` blocks (hand-edited)
apps/<app>/prisma/schema/*.prisma            GENERATED and COMMITTED
  platform.<slice>.prisma                    one per package fragment
  app.<fragment>.prisma                      one per app fragment (a fragment of pure `extend` blocks has no output file)
apps/<app>/prisma.config.ts                  schema: 'prisma/schema', migrations.path: 'prisma/migrations'
```

The slices and the models they own are the spec's table ("Model ownership follows slices"); enums travel with their owning model. An app fragment named `base.prisma` **replaces** the package's `base.prisma` (the only way an app changes the generator's `output` or `previewFeatures`); any other duplicate `generator` or a second `datasource` is an error.

**Syntax.** Fragments are `prisma format`-shaped: a block header is `<kind> <Name> {` on one line at column 0, and the block ends with `}` alone at column 0. The only non-Prisma syntax is:

```prisma
// @extensible              <- in the comment run directly above the model, written by its OWNER
model User { ... }

extend model User {         <- in any fragment, package or app
  workouts Workout[]        <- back-relation fields only
}
```

**Rules (each violation is a composer error with a stable code and a `file:line` message):**

| Code | Rejected input |
|---|---|
| `NOT_EXTENSIBLE` | `extend` of a model whose owner did not mark it `// @extensible` |
| `UNKNOWN_MODEL` | `extend` of a model no fragment declares |
| `FIELD_COLLISION` | A field name that already exists on the model or in an earlier `extend` (the message names both sources) |
| `EXTEND_SCALAR_FIELD` | A field of scalar or enum type (that adds a column: it is a declared deviation in the lock, not an extension) |
| `EXTEND_OWNING_RELATION` | A relation field with `fields: [...]` (it would add a foreign key column to the package's table) |
| `EXTEND_BLOCK_ATTRIBUTE` | `@@index`, `@@map` and so on inside an `extend` block |
| `EXTEND_UNKNOWN_TYPE` | A field whose type is no model |
| `DUPLICATE_MODEL` | A model or enum declared (not extended) in two fragments |
| `DUPLICATE_BASE` | Two `generator` blocks of the same name, or two `datasource` blocks |
| `MALFORMED` | A header or footer that is not `prisma format` shaped |

**Composition.** Package fragments load first (alphabetically), then app fragments (alphabetically). Each `extend` block's fields are appended to the target model **before its first `@@` line**, grouped per source under a `// composed from <origin>:<file>` comment, with the fields' own comments kept verbatim. Every output file starts with:

```
// GENERATED by platform db compose — do not edit
// source: package:identity.prisma
```

The composer is plain Node ESM with **no Prisma runtime dependency** (the Docker build and CI run `prisma generate` without it). `platform db compose --check` writes nothing and fails when any generated file differs byte for byte from a fresh compose (the same pattern as `openapi:dump`).

**Generated files are committed.** The Dockerfile and CI run `prisma generate` without the composer; a CI step runs `--check` so they cannot go stale. The composer must run before `generate` in the developer loop.

**The composer does not generate back-relations.** The slice that owns the foreign key declares the relation, in its own fragment, with an explicit `extend`. (`prisma format` *does* add a missing back-relation, but by rewriting the package-owned file in place with a Prisma-chosen name, so it is rejected as the mechanism; a "suggest the extend block" command is a possible convenience.)

**Extensible models.** A back-relation is only ever added to a model its owner marked. Marked in `@marinoscar/platform-db` v1:

| Model | Why |
|---|---|
| `User` | 17 of the 25 back-relations leave identity for the 7 slices that own the foreign keys (settings 2, storage 1, credentials 2, notifications 4, jobs 2, db-backup 2, ai 4); every app adds more |
| `Job` | `database_backup_runs.job_id` is owned by db-backup (`Job.backupRun`); apps add job-linked tables |
| `StorageObject` | The spec lists it among the package-owned models an app points at; no base table references it yet |

`Organization` and `Group` are marked `// @extensible` in the migration that creates them (#721, #729). Everything else is closed. Opening another model is a one-line, minor-version package change reached through a seam request, never an app edit.

### D3. Migration install, naming and `platform.lock` (the contract for #710)

**Package history.** `packages/platform-db/migrations/NNNN_slug/migration.sql`: one **linear**, immutable history, `NNNN` a four-digit sequence, `slug` lower-case with underscores. The base's 22 migrations become `0001` to `0022` and keep the slug of their legacy directory (`20260124223146_initial` is `0001_initial`, `20260930120000_add_job_trace_context` is `0021_add_job_trace_context`, `20261006120000_add_retention_created_at_indexes` is `0022_add_retention_created_at_indexes`). The origin id is `platform:` plus the directory name, for example `platform:0001_initial`.

The unit of installation is the whole linear history. **Slice opt-out is not supported in v1**: `database_backup_runs.job_id` references `jobs`, and the composed `User` extends across every slice. (This supersedes "Install order follows each slice's `requires`".)

**Install (`platform db sync`).**

1. Read `prisma/platform.lock`. Refuse if the package history has a gap relative to the lock.
2. For each package migration not in the lock, in order, create `prisma/migrations/<localTimestamp>_<slug>/migration.sql` as a **byte copy**. Never rewrite, re-encode or add a header: Prisma's checksum covers comments and whitespace.
3. Append the lock entry. A second run installs nothing.

**The naming rule.** Let `L` be the greatest 14-digit timestamp among **every** timestamped directory already in the app history (installed or app-authored). Let `base = max(now_utc_second, L + 1 second)`. The i-th migration installed by one run (0-based) gets timestamp `base + i seconds`, formatted `YYYYMMDDHHMMSS`. A `--timestamp` override exists for tests. Consequences: an installed migration always sorts after everything already in the history and after its predecessors, even under clock skew.

Why the rule is required (observed): `prisma migrate deploy` silently applies a directory that sorts **before** applied ones, as that database's last migration; a fresh database applies it **first**. The two histories diverge. Ordering by construction avoids it.

**`prisma/platform.lock`** (JSON, committed):

```json
{
  "lockVersion": 1,
  "platformVersion": "1.0.0",
  "migrations": [
    {
      "originId": "platform:0001_initial",
      "localDir": "20260124223146_initial",
      "sha256": "755688a7d01e70c97f497efdbd5a72adecf9404ba20fc5fc15c748c2bb7d0d2e",
      "since": "1.0.0"
    },
    {
      "originId": "platform:0021_add_job_trace_context",
      "localDir": "20260930120000_add_job_trace_context",
      "sha256": "…package file…",
      "since": "1.0.0",
      "localSha256": "…app file…",
      "note": "comment-only difference (issue references renumbered per repository)"
    }
  ],
  "deviations": [
    {
      "id": "evopath:push_subscriptions.platform",
      "reason": "why the app alters a package-owned table",
      "expectDiff": ["ALTER TABLE \"push_subscriptions\" ADD COLUMN \"platform\" TEXT;"]
    }
  ],
  "rawSqlIndexes": [
    { "name": "app_x_active_idx", "definition": "CREATE UNIQUE INDEX app_x_active_idx ON public.app_x USING btree (...) WHERE (...)" }
  ]
}
```

| Field | Rule |
|---|---|
| `lockVersion` | `1`. A reader refuses a higher value |
| `platformVersion` | The package version the history was last synced to |
| `migrations[]` | Package order. One entry per installed or mapped package migration |
| `originId` | `platform:` plus the package directory |
| `localDir` | The app's directory name. It may differ from the package's slug (a rename), which is why a rename needs no special field |
| `sha256` | Lower-case hex SHA-256 of the **package** file's bytes. This is also what Prisma stores in `_prisma_migrations.checksum` for a byte copy (verified) |
| `since` | The platform version that introduced the migration for this app |
| `localSha256`, `note` | Present **only** for a comment-only divergence: the SHA-256 of the app's file. Any further edit is still caught |
| `deviations[]` | Declared alterations of package-owned tables. `expectDiff` lists the **normalised** statements `migrate diff` is expected to print for them (normalise by removing `"public".` and collapsing whitespace) |
| `rawSqlIndexes[]` | The app's own raw-SQL index allow-list (name plus `pg_indexes.indexdef`); the package's list ships in `packages/platform-db/raw-sql-indexes.json` |

**`platform db check`** (offline, in CI): fails when a package file's hash differs from the lock (a released migration was rewritten), when an installed file differs from the lock's `localSha256 ?? sha256`, or when a named local directory is missing. A `--database` mode additionally compares `_prisma_migrations.checksum` with the local files. **This check is not redundant with Prisma**: `migrate deploy` and `migrate status` do **not** complain about an edited, already-applied migration file (observed).

**The CI drift test** is `prisma migrate diff --from-migrations <package history> --to-schema <composed folder> --exit-code` (it needs the shadow database; the `smoke` job already has Postgres). It exits 0 on a clean tree and 2 when the schema is edited without a migration (both observed), plus the raw-SQL index assertion below. It needs **no** allow-list for the raw-SQL indexes.

### D4. Baseline steps and the allowed-drift list (the contract for #711)

An existing database adopts the package history without re-running it. `platform db baseline --through <NNNN> [--dry-run]`, where `<NNNN>` is the platform migration the database claims to equal:

| Step | Action | Refuse when |
|---|---|---|
| B1 Map | For each package migration, find a local directory by exact SHA-256 (a rename of the directory is irrelevant), else by a comment- and whitespace-stripped SHA-256 (record `localSha256`), else **unmapped**. Report app-only directories as app history | never; it only reports |
| B2 Ledger | Each mapped directory must be a finished, not-rolled-back row of `_prisma_migrations` whose checksum equals the local file | a row is missing, unfinished, or has a different checksum |
| B3 Diff | Replay the package history up to `--through` in the shadow database and diff it against the **live** database: `prisma migrate diff --from-migrations <replay> --to-config-datasource --script`. Remove statements matching a declared `deviations[].expectDiff` | any statement remains |
| B4 Indexes | Compare the live `pg_indexes` rows for the package's and the app's `rawSqlIndexes` (name **and** definition) | one is missing or differs |
| B5 Act | For an unmapped migration `<= --through`: install it (see placement below) and run `prisma migrate resolve --applied <localDir>`. For one `> --through`: install only; `migrate deploy` applies it | `resolve` fails |
| B6 Verify | `migrate status` says up to date, `migrate deploy` is a no-op, `platform db check` passes, a second `--dry-run` is empty | any |

Rules learned from the experiments:

- **Rehearse on a restored backup first**: `pg_dump -Fc --no-owner --no-acl | pg_restore --no-owner --no-acl` of the live database into a scratch database, run the baseline there, then run it for real. The two runs produced the same plan. `_prisma_migrations` travels with the dump.
- **Placement.** A resolved (already-applied) migration is installed **immediately after its mapped package predecessor** (`predecessorTimestamp + 1 second`, or the next free second), not at the end of the history. Otherwise a fresh database built from the adopted history applies the app's own equivalent migration first and then the platform's, and fails with `column "trace_context" of relation "jobs" already exists` (observed). A migration `> --through` goes to the end by the naming rule.
- An app that wrote its **own equivalent** of a platform migration must have written it idempotently (`IF NOT EXISTS`); the platform's copy then runs first on a fresh database and the app's is a no-op.
- **Partial mode** is `--through` below the latest: a database at migration 15 is refused for `--through 22` (20 differing statements) and accepted for `--through 15`; migrations 16 to 22 are installed and applied by `migrate deploy`, after which the database equals the composed schema.
- A database **Prisma never managed** (schema present, no `_prisma_migrations`): `migrate deploy` fails with `P3005`; `migrate resolve --applied <dir>` per directory creates the ledger. `resolve` on an already-recorded directory fails with `P3008`, so the tool skips recorded directories.
- A baseline refuses on any unexplained live difference; there is no `--force`.

**The allowed-drift list, restated.** For Prisma 7.9, `migrate diff` of the reference database against the composed schema is **empty** (exit 0) even though `jobs_active_dedup_uniq_idx`, `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx` and `database_backup_runs_active_uniq_idx` exist. Prisma ignores partial and expression indexes and ignores RLS state in both directions. So there are exactly **two** allowances, neither a filter over diff output:

1. **`rawSqlIndexes`** (package list plus the app's): a **positive assertion** that each exists in `pg_indexes` with the recorded definition. Dropping `jobs_attempts_gt1_idx` by hand left Prisma's diff silent and was caught by this check; re-creating `jobs_active_dedup_uniq_idx` without its `WHERE` clause was caught by the definition compare.
2. **`deviations[].expectDiff`**: statements the diff is expected to print for a declared alteration of a package table.

The package's tripwire (#713) must **derive** its list from the catalogue (`pg_indexes` rows whose definition contains ` WHERE ` or an expression key) and assert it equals `raw-sql-indexes.json`, so an unlisted raw-SQL index fails the build. The query used in the spike found exactly the four the spec lists.

### D5. The RLS contract (the contract for #725)

**GUC names** (all transaction-local, always set with `set_config(name, value, true)`, never `SET` and never `set_config(..., false)`):

| GUC | Value | Set by |
|---|---|---|
| `app.org_id` | The active organisation's UUID | every scoped operation |
| `app.user_id` | The user's UUID, or `''` | every scoped operation (reserved for optional owner-based RLS on sensitive tables) |
| `app.rls_bypass` | `'on'` | **only** the system client (and migrations, below) |

A session-level value is **forbidden**: with a pooler that hands the next statement to another server connection it leaks. The spike reproduced the leak (600 cross-org rows with a pool of one; 20 through PgBouncer) as a negative control.

**One org per transaction.** The spec says RLS is "over the principal's memberships". The contract narrows that to the **single active org** of the request (the token carries it; switching org re-issues it). Memberships are enforced by the principal; a read across orgs uses the system actor. An `app.org_ids` array is rejected for now: it widens the blast radius of a bug and nothing needs it.

**The policy template.** Applied by hand-written SQL in a package migration to every org-owned table (Prisma's schema language cannot express it and its diff ignores it):

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "<table>"
  USING (
    "org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
    OR current_setting('app.rls_bypass', true) = 'on'
  );
```

- `NULLIF(..., '')` is **required**: `current_setting(name, true)` is `NULL` on a fresh connection but the **empty string** on a connection that has ever had a transaction-local value (observed); a bare `::uuid` cast of `''` errors.
- `WITH CHECK` defaults to `USING`, so inserting or moving a row into another org is refused (`42501`, `new row violates row-level security policy`).
- `FORCE` makes the owner (the application role) subject to the policy: **an unscoped client sees zero rows and cannot insert** (fail-closed; verified through `findMany`, `$queryRaw` and `create`).
- Index `org_id` as the leading column of the table's common access paths.
- **A reference between two org-owned tables is a composite foreign key** `(parent_id, org_id) -> parent(id, org_id)`, declared in Prisma as `@relation(fields: [parentId, orgId], references: [id, orgId])` (a `@@unique([id, orgId])` on the parent). Referential-integrity checks bypass RLS: with a plain foreign key org B stored a reference to org A's row, could not read it, and could use the error to probe whether a foreign id exists (observed). The composite key refuses it.
- The spec's tripwire test gains a catalogue rule: every table with an `org_id` column has `relrowsecurity`, `relforcerowsecurity` and exactly the standard policy.

**The transaction wrapper** (in `@marinoscar/platform-api`, over the Prisma client):

| Shape | Behaviour |
|---|---|
| `forScope(base, scope)` | A client extension whose `query.$allOperations` runs `base.$transaction([ set_config(app.org_id, app.user_id), query(args) ])` on one connection. Covers every model operation **and** `$queryRaw`/`$executeRaw` (verified) |
| `runInScope(base, scope, fn)` | One interactive transaction: `set_config` first, then `fn(tx)` where `tx` is the **unextended** transaction client. Use it for any unit of work of more than one statement |
| `runAsSystem(base, fn)` / `forSystem(base)` | The same two shapes for the system client, setting `app.rls_bypass` instead |

Rules: `orgId` and `userId` are validated as UUIDs before they reach SQL. `runInScope` forwards Prisma's `maxWait` and `timeout`: an interactive transaction waits only 2 s by default for a pooled connection, which many queued transactions behind a tiny pool exceed (it happened once, on a loaded machine, with a pool of one and 200 interleaved requests; the stress phases pass `maxWait: 120000`). Size the pool for the concurrency, do not rely on queueing. **Never** use a `forScope` client inside `$transaction(async tx => ...)`: its operations escape the transaction (a create followed by a throw left the row committed, observed), which is why `runInScope` hands out the plain `tx`. Raw SQL goes through the scoped client or `runInScope`; the spec's lint rule covers unscoped raw SQL.

**The bypass connection (option A).** `asSystem(actor: SystemActor)` (the type from [ADR 0001](0001-org-aware-principal-and-scope.md)) returns a client built on a **separate `PrismaClient` with its own `PrismaPg` pool**, the same database role and URL, so **no new environment variable and no new role**. Its operations set `app.rls_bypass` transaction-locally. Verified: the tenant pool and the system pool share no backend connection; the flag never survives a transaction; the tenant pool stays fail-closed after system work. The pool size is a system setting with a small default. Purge, doctor, seed, factory reset and offboarding use it. This is the same precedent as `admin-connection.util.ts`, which stays as the cluster-admin connection.

**Threat model, stated plainly.** Any SQL that runs on a connection can set any GUC, including another org's id or the bypass flag (verified). Option A defends against **missing or wrong scoping in application code**, which is the failure the spec's "about 46 `where: { userId }` sites" describe. It does **not** defend against SQL injection or arbitrary raw SQL. The same is true of any GUC-based scheme; only a per-tenant database role would change it, at the cost of option B's fail-open default. The lint rule and review are the controls for raw SQL.

**Roles.** The application role must be `NOSUPERUSER NOBYPASSRLS`, or every policy is inert (a superuser saw all rows of a `FORCE`d table, verified).

**Migrations and seeds are system work.** Under `FORCE`, a data migration that `UPDATE`s an RLS table applies "successfully" and changes **zero rows** (observed). Prisma's schema engine runs a migration **statement by statement**, so a bare `SELECT set_config('app.rls_bypass', 'on', true);` is gone before the next statement and also changes zero rows. A migration that must see every org is written:

```sql
BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);
UPDATE ...;
COMMIT;
```

(A session-level value also works there, because the schema engine's connection is its own and never a request pool; the explicit transaction is preferred.) Seed functions write org-owned rows through the system client.

**Backup and restore (verified against `buildPgDumpArgs` and `buildPgRestoreArgs`).** Both halves are required, together, everywhere:

| Invocation | Result |
|---|---|
| Today's `pg_dump` arguments as the application role | **Fails loudly**: `query would be affected by row-level security policy` |
| `pg_dump --enable-row-security`, no bypass option | **Exits 0, archive has zero rows** (silent empty backup) |
| The bypass option alone | Still fails (`row_security` stays off) |
| `pg_dump --enable-row-security` **plus** `PGOPTIONS='-c app.rls_bypass=on'` | Every row captured (60 of 60) |
| The same as the **minted per-job role** (`NOSUPERUSER NOINHERIT`, `CONNECT`, `USAGE`, `SELECT`) | Every row captured; without the flag that role sees nothing |
| `pg_restore -j 3` with only the bypass option | **Fails** in post-data (`ADD CONSTRAINT ... FOREIGN KEY` trips over the `FORCE`d table) |
| `pg_restore -j 3 --enable-row-security` **plus** the bypass option | Every row restored; policy, `ENABLE` and `FORCE` intact; the restored database enforces the policy |

So: `buildPgDumpArgs` and `buildPgRestoreArgs` both add `--enable-row-security`; every spawn adds `PGOPTIONS=-c app.rls_bypass=on` to the child's environment (merged with any existing `PGOPTIONS`, like `PGPASSWORD`, never in argv); the dump and the restore connect **directly to the database endpoint**, never through a pooler (PgBouncer 1.22 answers a client startup option with `unsupported startup parameter in options: app.rls_bypass`). `pg-job-role.broker.ts` needs **no change** to the role's attributes or grants: option C is impossible there anyway, because a `CREATEROLE` role (the broker's `app_job_minter`) cannot create or alter a role to `BYPASSRLS` (`permission denied to create role`, `permission denied to alter role`, verified). The node-side `pg_dump` adds the same argument and environment variable. The archive carries `ROW SECURITY` and `POLICY` entries and `FORCE`, so a restore re-creates the protection.

Because a missing flag produces a plausible, empty, successful backup, #725 must add: a `*.db.spec.ts` that dumps and restores an RLS table and asserts the row count, and a **Doctor check** (read-only) that compares a system-side row count of an org-owned table with a count taken over a connection carrying the startup option, failing on a mismatch.

**Pooler.** Transaction-mode pooling is supported. Through PgBouncer in `pool_mode=transaction` with **one** server connection shared by ten client connections, 200 interleaved requests for two orgs returned **zero** cross-org rows, an unscoped client was still fail-closed, and interactive transactions worked. `LISTEN` (the event bus adapter) and the dump/restore startup option need a **direct or session-mode** connection, as the spec already notes for the event bus.

**Implementation notes (#725).** D5 was implemented as written. What implementing it added:

- **The bypass flag and the dump flag are both mandatory, and the broker needed three changes the spike could not see** because it ran as a superuser or a role the spike created. On PostgreSQL 16 a non-superuser `CREATEROLE` role is given `ADMIN` but neither `INHERIT` nor `SET` on a role it creates, so it could mint a job role and then not `DROP OWNED BY` it; `ALTER ROLE app SET createrole_self_grant = 'inherit, set'` fixes that and is part of the paste-ready `guided` SQL and the dev/test init script. An `ALTER ROLE` that names `SUPERUSER`, `REPLICATION`, `CREATEDB` or `BYPASSRLS` needs that attribute itself even to switch it off, so a re-issue by a non-superuser re-asserts only `NOCREATEROLE NOINHERIT CONNECTION LIMIT`. And the minted role is now created with an explicit `NOBYPASSRLS`. None of this widens the role: it stays `SELECT`-only.
- **The application role in each environment.** The postgres image makes its `POSTGRES_USER` a superuser, so `devdb.compose.yml` and `test.compose.yml` keep the image's bootstrap login as `postgres` and create `POSTGRES_USER` (default `app`) with `infra/compose/postgres-init/10-application-role.sh`; the CI `smoke` and `deploy-e2e` jobs run the same script against their service container. The Doctor check is `db.rls_role`.
- **The db tier runs as that ordinary role.** `createDbClient()` (fixtures) carries the `app.rls_bypass` startup option, so it is the system view; the application's own `PrismaService` is built by `createDbServices()` and is subject to the policies. Isolation suites build their own database and role (`test/helpers/rls-database.helper.ts`).
- **Only four tables are isolated by RLS**: `storage_objects`, `storage_object_chunks`, `ai_runs`, `ai_usage_events`. `audit_events` has a nullable `org_id` and no policy; identity tables that reference an organization declare `orgReference` and are guarded by service code.
- **Measured cost** on 1,000 rows per organization: about one extra millisecond at p50 and 2 to 4 ms at p95 per scoped query (`test/tenancy/rls-overhead.db.spec.ts`).

### D6. Spike posture

The prototype lives under `spike/` and is never imported by the application. It is a reference, not a template: #709 to #713 and #725 implement the contracts above in `packages/platform-db`, `packages/platform-api` and the CLI.

## Results

Commands were run from the repository root against `infra/compose/test.compose.yml`-style PostgreSQL 16.14 (`127.0.0.1:5433`). Totals: **Q1 23/23, Q2 37/37, Q3 20/20, Q4 43/43, Q5 69/69** checks passed. Full transcripts are in [`spike/results/`](../../spike/results/).

### Q1. Multi-file schema (Prisma 7)

`node spike/q1-multifile.mjs`. The real schema was split into `base.prisma` plus 8 slice files; 31 models appear exactly once.

- `defineConfig({ schema: 'prisma/schema' })`: `The schemas at prisma/schema are valid`. Without the key: `Could not find Prisma Schema that is required for this command`.
- `generate` of the single file and of the folder both succeed. Six generated files differ (`index.d.ts`, `index.js`, `edge.js`, `index-browser.js`, `schema.prisma`, `package.json`), **only** by declaration order (slice files load alphabetically) and by a content-hash `name` in `package.json`: the multiset of `index.d.ts` lines is identical after normalising the `modelProps` union, trailing commas and an indentation difference; `runtimeDataModel` is deep-equal; `runtime/` and the query-compiler wasm are byte-identical.
- `prisma migrate diff --exit-code --from-schema <single file> --to-schema <folder>` prints `No difference detected.` (exit 0), in both directions.
- Migrations location: with `schema: 'prisma/schema'` and migrations at `prisma/migrations`, `migrate status` prints `No migration found in prisma/migrations`; with the directory moved to `prisma/schema/migrations` it reports `21 migrations found`. **The default follows the schema folder**, so `migrations.path` is explicit (D1).
- `npm run prisma:generate`, `prisma:migrate` (all 22 applied, `_prisma_migrations` holds 22 rows) and `prisma:migrate:dev` (`Already in sync, no schema change or pending migration was found.`; with a new model in `credentials.prisma` it created `prisma/migrations/<ts>_add_spike_probe` through the shadow database) work with the scripts copied verbatim from `apps/api/package.json`.
- The Dockerfile recipe (a copy of `prisma/` and `prisma.config.ts` only, `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy`, no `scripts/`, no `package.json`) generates successfully.
- A second `generator` block, or the same `model` in two files, is rejected by Prisma (`P1012`). So a model **cannot** be extended in plain Prisma, which is why D2 needs `extend model`.

### Q2. Composed `User` (option 1) against option 2

`node spike/q2-compose-user.mjs`.

- **Real schema, decomposed and recomposed.** The generic rule "a back-relation field whose target model lives in another slice moves into the target slice's fragment as `extend model`" moved 17 of `User`'s 25 back-relation fields into 7 slices (settings: `userSettings`, `settingsUpdates`; storage: `storageObjects`; credentials: `credentialUpdates`, `userCredentials`; notifications: `notificationDeliveries`, `notifications`, `pushSubscriptions`, `broadcastsCreated`; jobs: `workerNodes`, `nodeCredentials`; db-backup: `databaseBackupRuns`, `databaseRestores`; ai: `aiModelsUpdated`, `aiKeys`, `aiRuns`, `aiUsageEvents`) and `Job.backupRun` into db-backup: 8 `extend` blocks, 18 merged fields. Composed: 9 files. `validate` passes; every model has the same set of field lines and block attributes as the original; `migrate diff` original to composed is empty; the composed schema generates a client; compose is byte-deterministic; `--check` passes on fresh output and fails (`platform.jobs.prisma`) after a hand edit.
- **Without the composer** (the same slice files with the back-relations simply removed), `prisma validate` fails: the hard problem, demonstrated.
- **A fake app** adds `Workout` (to `User` and `StorageObject`) and `WorkoutExport` (to `Job`) with three `extend` blocks. `tsc --noEmit` type-checks `include: { workouts: true }`, `storageObject.include.workoutPhotos`, `job.include.workoutExport`, `workout.include.{user,photo}` and a nested `workouts: { create }`; an unknown include key is a type error (the check has teeth). At runtime, against the migrated database plus the diff-generated app tables (the diff contained only `CREATE TABLE "workouts"` and `"workout_exports"`, no change to a package table): `user.include.workouts`, `storageObject.include.workoutPhotos` and `onDelete: Cascade` all work.
- **Errors rejected** (all with the codes in D2): not extensible, unknown model, collision with a package field and between two apps, scalar field, owning relation, block attribute, unknown type, redeclared model, second generator, second datasource, malformed header.
- **Option 2** (`Workout.userId` plain, foreign key in raw SQL): `User.include.workouts` and `Workout.include` are both type errors (`'workouts' does not exist in type 'UserInclude'`), and once the raw foreign key exists, `migrate diff` prints `ALTER TABLE "workouts" DROP CONSTRAINT "workouts_user_id_fkey"`: the next `migrate dev` would drop it. It also gives up relation filters, nested writes and `onDelete` documentation in the schema.

### Q3. Migration install and lock

`node spike/q3-install-lock.mjs`.

- Two package migrations installed as `20261006100000_initial` and `20261006100001_add_personal_access_tokens`; a second sync installs nothing. `migrate deploy` applies both; `_prisma_migrations.migration_name` is the local directory and `_prisma_migrations.checksum` **equals** `sha256(package file)` and the checksum the base app recorded for the same bytes.
- An app migration `20261006120000_add_workouts` applies after them; a package migration installed later with the clock **behind** it (skew) is named `20261006120001_add_credentials`, sorts after it, and the apply order equals the lexicographic order: `initial -> add_personal_access_tokens -> add_workouts -> add_credentials`.
- Negative control: a directory `20260601000000_package_fixed_name` older than applied ones: `migrate deploy` applies it silently as that database's **last** migration, while a fresh database applies it **first** (`package_fixed_name -> initial -> ...` against `initial -> ... -> package_fixed_name`).
- A comment-only edit of an installed, already-applied file: `check` reports `differs from the lock`, but `migrate status` prints `Database schema is up to date!` and `migrate deploy` prints `No pending migrations to apply.` (**Prisma does not notice**). The database still holds the original checksum. Rewriting a released package file is detected as `PACKAGE file changed after release`.
- A recorded `localSha256` makes a comment-only divergence acceptable and any further edit is still caught.

### Q4. Baseline on a database copy

`node spike/q4-baseline.mjs`.

- **Intentional drift.** Reference database (the 22 package migrations): `prisma migrate diff --from-config-datasource --to-schema <composed> --script --exit-code` prints nothing and exits 0, while `pg_indexes` holds all four raw-SQL indexes. The catalogue query (partial or expression indexes) finds exactly `database_backup_runs_active_uniq_idx`, `jobs_active_dedup_uniq_idx`, `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx`. The CI drift form (`--from-migrations <package history> --to-schema <composed>`) exits 0, and exits 2 once a model is added to the schema without a migration.
- **A fork** (21 platform migrations, `add_worker_node_vitals` under another directory name, `revoke_viewer_ai_use` with an extra comment line, `add_job_trace_context` missing but its effect present through the fork's own `IF NOT EXISTS` migration, and `push_subscriptions.platform` added by hand). B1: 20 identical (one under a renamed directory), 1 comment-only, 1 unmapped; the fork-only migration is reported as app history. B2: the ledger agrees. B3 prints a single statement, `ALTER TABLE "public"."push_subscriptions" ADD COLUMN     "platform" TEXT;`, and the baseline **refuses** until the deviation is declared. With it declared the dry run is clean; the rehearsal on a `pg_dump | pg_restore` copy succeeds and produces the same plan as the real run. The resolved row carries the package file's checksum, `applied_steps_count` 0, and the data is untouched. Afterwards `migrate status` is up to date, `migrate deploy` is a no-op, `check` passes and a second dry run is empty.
- **Fresh-database replay** of the adopted history deploys and equals the composed schema (diff empty). With the baselined directory appended at the **end** instead, a fresh database fails: `column "trace_context" of relation "jobs" already exists`. Placement after the predecessor is therefore required (D4).
- **Raw-SQL index drift** is invisible to Prisma and caught by B4: a dropped `jobs_attempts_gt1_idx` leaves B3 silent and B4 reports it `MISSING`; `jobs_active_dedup_uniq_idx` re-created without its predicate is reported as differing.
- **Partial mode.** A database at 15 migrations: `--through 22` is refused with 20 differing statements (the first is `ALTER TABLE "public"."ai_models" DROP CONSTRAINT "ai_models_updated_by_user_id_fkey"`); `--through 15` passes; 16 to 21 install and `migrate deploy` applies exactly six; the result equals the composed schema.
- **Unmanaged database.** `migrate deploy` fails `P3005` (`The database schema is not empty`); `migrate resolve --applied` per directory creates `_prisma_migrations` with 22 rows and `migrate status` is up to date; resolving a recorded directory again fails `P3008`.

### Q5. Row-level security with Prisma and a pooler

`node spike/q5-rls.mjs`. The application role is a non-superuser that owns the tables (the deployment shape), the table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and the D5 policy, and the migration is applied by `migrate deploy` as that role.

- `migrate diff` of the live database against the schema is empty: Prisma ignores RLS state and policies.
- **Fail-closed.** An unscoped insert by the owner: `new row violates row-level security policy for table "spike_tenant_rows"` (`42501`). An unscoped `findMany` and `$queryRaw` return zero rows.
- **Per-operation scoping.** Through the extension: `findMany`, `count`, `aggregate`, `groupBy`, `findUnique` (another org's id gives `null`), `create` (own org works, another org is refused by `WITH CHECK`), `update`, `upsert`, `delete`, `updateMany` and `deleteMany` (zero rows across orgs), `$queryRaw` and relation `include` all behave. `current_setting('app.org_id', true)` is `null` on a new connection and `""` on a used one.
- **Interactive transactions.** `runInScope` scopes every statement of one transaction and rolls back on error; a hand-written `$transaction` plus `set_config(..., true)` works; the value does not outlive the transaction. The extended client inside `$transaction` escapes the transaction (observed).
- **Concurrency.** 200 interleaved requests (extension and `runInScope`) for two orgs: **0** cross-org rows and no short reads, against a pool of **one** connection and against a pool of 8. Negative control on the pool of one: a session-level `set_config(..., false)` leaked **600** cross-org rows.
- **PgBouncer 1.22.0**, `pool_mode=transaction`, `default_pool_size=1`, ten Prisma client connections: 200 interleaved requests, **0** cross-org rows; unscoped still sees zero; negative control leaked 20 rows. A client startup option through PgBouncer fails: `unsupported startup parameter in options: app.rls_bypass`.
- **System connection.** The system client counts all 40 rows and deletes across orgs; the tenant and system pools share no backend connection (5 and 3 backends); the flag is not left behind; the tenant pool stays fail-closed.
- **Bypass options.** *B*: unscoped code sees all 12 rows (fails open); inside `SET LOCAL ROLE` plus `set_config` it sees 5; the tenant role with no org sees none; `pg_dump` as the owner works unchanged. Costs: a `GRANT` per new table, a second role, a role switch per transaction, and `FORCE` is impossible. *C*: a `BYPASSRLS` login sees all rows and dumps with today's arguments, but a `CREATEROLE` role cannot create or alter a role to `BYPASSRLS`, and it needs a second database login (a deployment secret). Whether RDS lets its master user hold or grant `BYPASSRLS` is **unmeasured** ([runbook](../runbooks/rds-proxy-rls-check.md)). *A*: chosen.
- **Backup and restore**: the table in D5 (rows 60 of 60 and 0 of 60 are measured values).
- **Foreign keys and migrations**: the cross-org plain foreign key succeeds and the composite one is refused (`Foreign key constraint violated on the constraint: spike_leaves_node_id_org_id_fkey`); a data migration without the bypass changes 0 of 60 rows, with a bare `set_config` also 0 of 60, with `BEGIN; set_config; UPDATE; COMMIT;` 60 of 60.
- **Overhead.** Indicative only (localhost, a shared 4-CPU machine, pool of 5): an unscoped `findFirst` about 1 ms; the extension (four round trips: `BEGIN`, `set_config`, query, `COMMIT`) about 2 to 3 ms, a constant of roughly 1 to 2 ms per operation; three operations inside one `runInScope` cost little more than the three bare operations. Use the extension for single operations and `runInScope` for a unit of work.

### Q6. RDS Proxy pinning (unmeasured)

RDS Proxy cannot be exercised without an AWS account. [`docs/runbooks/rds-proxy-rls-check.md`](../runbooks/rds-proxy-rls-check.md) is a manual procedure: create RDS PostgreSQL 16 and an RDS Proxy; run the Q5 workload through it with control runs; read the `DatabaseConnectionsCurrentlySessionPinned` CloudWatch metric and the proxy log for `pinned`; record the outcome. **Until it is recorded, assume pinning may occur and plan for PgBouncer on ECS.** The decision does not depend on it: the contract uses only `set_config(..., true)` inside a transaction, which a PgBouncer in transaction mode is proven to handle. If a Proxy pins on it, the cost is connection reuse, not correctness.

## Consequences

**Adjustments to the stories this ADR feeds** (the issue comment on #708 repeats these):

- **#709 (fragments and composer).** Implement D1 and D2 exactly: `schema` plus `migrations.path` in `prisma.config.ts`, the folder layout, `// @extensible`, `extend model`, the rule table and codes, generated-file header, `--check`, committed output. The back-relation is declared by the slice that owns the foreign key, never generated. Do **not** rely on `prisma format` to add it. Update the spec sentences listed under [Supersedes](#supersedes). The spike's `lib/split-schema.mjs` is the reference decomposition of the base (8 `extend` blocks).
- **#710 (sync, lock, drift test).** Package ids are `NNNN_slug`; use the naming rule and the lock schema of D3 verbatim; add the offline `check` and a `--database` ledger mode, because Prisma does not verify applied checksums; the drift test is `migrate diff --from-migrations ... --to-schema ... --exit-code` plus the index assertion, with no allow-list for raw indexes.
- **#711 (baseline).** Implement B1 to B6, `--through`, placement after the predecessor, the rehearsal procedure, `P3005`/`P3008` handling and `deviations[].expectDiff`. The raw-SQL allow-list is an assertion over `pg_indexes`, **not** a diff filter. There is no `--force`.
- **#712 (seeds).** Seeds that write org-owned rows use the system client once #725 lands. No change before then.
- **#713 (move the base's migrations).** Package ids `0001` to `0022` (and onward as the base adds migrations) with the legacy slugs; the base app's local directory names are unchanged and mapped by the lock (`since` `1.0.0`); ship `raw-sql-indexes.json` with definitions and a tripwire that **derives** the list from the catalogue.
- **#725 (RLS in the app).** Implement D5: the GUCs, the policy template, `forScope`/`runInScope`/`asSystem`, the separate system pool, composite foreign keys, the `BEGIN; set_config; ...; COMMIT;` migration pattern, `--enable-row-security` plus `PGOPTIONS` in `buildPgDumpArgs`, `buildPgRestoreArgs` and the node-side dump, the row-count db spec and the Doctor check. **Also**: make the application role a non-superuser (`devdb.compose.yml`, `test.compose.yml` and `.env.example` all default to the `postgres` superuser, under which RLS is inert) and add a Doctor check that fails when `rolsuper` or `rolbypassrls` is true while any table has `FORCE`. The RLS `*.db.spec.ts` suites must create their own non-superuser role, as the scratch-database helper does for databases.

**Easier:** an app adds relations to platform models without editing platform files; platform migrations are byte-identical everywhere and provably so; an existing database can adopt the history on a rehearsed, refusable path; a forgotten scope returns nothing instead of leaking.

**Harder:** generated schema files must be kept current (a CI check) and `compose` runs before `generate`; migrations that touch org-owned tables are system work and need the explicit transaction pattern; every backup, restore and dump path must carry **both** the argument and the environment variable, and a missing half is silent for the dump; the application can no longer connect as a superuser.

**Forbidden:** a session-level `SET`/`set_config(..., false)` for RLS; an app declaring a model a package already declares; an app editing a platform fragment; rewriting any released migration byte; a slice-selective migration install in v1; using a `forScope` client inside `$transaction`.

## Alternatives considered

| Alternative | Why it lost |
|---|---|
| Plain `userId` with the foreign key in raw SQL (option 2) | Loses typed relations and nested writes, and Prisma then wants to drop the hand-written key on every `migrate dev` (measured) |
| Letting `prisma format` add the missing back-relations | It rewrites a package-owned file in place with a Prisma-chosen name; the edit would be lost on the next sync |
| Generating every back-relation in the composer | Hides who owns what, cannot choose relation names for two relations to one table (`databaseBackupRuns`/`databaseRestores`), and the comment blocks that explain `onDelete` choices live with the relation |
| Package migrations keeping their fixed timestamp names | They can sort before applied app migrations; a deployed database and a fresh one then apply different orders (measured) |
| One migration history per package | Prisma runs one history, and cross-package foreign keys need a global order (spec) |
| Bypass option B (`ENABLE` without `FORCE`, `SET LOCAL ROLE`) | Fails open for unscoped code (measured), needs a `GRANT` per table and a second role |
| Bypass option C (a `BYPASSRLS` login) | A second deployment secret, cannot be minted by the per-job role broker, RDS support unmeasured. Kept as the fallback |
| RLS over an array of memberships (`app.org_ids`) | Widens the blast radius of any scoping bug; nothing needs a cross-org transaction |
| Session-level `SET` for the scope | Leaks across requests behind a transaction pooler (measured: 600 and 20 rows) |
| Migrating at API startup | Rejected by the spec and by the restore safeguards |

## Supersedes

[`docs/specs/platform-packages.md`](../specs/platform-packages.md) is left unchanged by this change; #709 updates it. These sentences are superseded:

1. "composition generates the back-relations on every package-owned model, not only `User`" (Known hard problem): composition **merges explicit `extend model` blocks**; it generates nothing.
2. "**Install order** follows each slice's `requires`." (Rules): the whole linear package history is installed in package order; slice opt-out is not supported in v1.
3. "CI drift test: compose the schema from fragments, diff it against the migrations, and allow only the listed raw-SQL indexes (platform and app-contributed) and the declared deviations." (Rules): the diff is empty for the raw-SQL indexes on Prisma 7.9; they are asserted over `pg_indexes`, and deviations are expected diff statements.
4. "In packages they live in migration SQL, guarded by a tripwire test that lists the allowed indexes." (Rules): the tripwire derives the list from the catalogue and compares it to `raw-sql-indexes.json`.
5. "`pg_dump` and `pg_restore` fail on RLS-protected tables unless the connecting role can bypass RLS (`BYPASSRLS`)." (Enforcement): they fail with today's arguments, and succeed for a role that owns or can read the tables when given `--enable-row-security` and the `app.rls_bypass` startup option; no `BYPASSRLS` role is needed.
6. "Postgres row-level security (RLS) | On `org_id`, over the principal's memberships." (Enforcement): one active org per transaction.
7. "The lock format records comment-only differences" (Baseline adoption): `localSha256` and `note` on the entry; and step 3, "Only if the diff is empty, mark the mapped migrations as applied": the diff is of the replayed package history against the live database, plus the catalogue index check, with declared deviations removed.
8. The spike line "verify whether RDS Proxy pins connections" (Scaling posture) stays open; the fallback is stated as an assumption until measured.

## Open items

- RDS Proxy pinning and whether the RDS master user holds or can grant `BYPASSRLS`: unmeasured, [runbook](../runbooks/rds-proxy-rls-check.md).
- The spike ran on Node 22 and Prisma 7.9.1 (CI uses Node 24); re-run `spike/q1` to `q5` after a Prisma minor upgrade, since several findings (the raw-SQL indexes absent from `migrate diff`, the migrations default, statement-by-statement migrations) are Prisma behaviours.
- Per-org SSO, quotas and groups are out of scope here (spec "Later").

## References

- [Platform packages spec](../specs/platform-packages.md): "Data, migrations and seeds", "Tenancy and access model", "Scaling posture", "Roadmap".
- [ADR 0001](0001-org-aware-principal-and-scope.md): the principal, scope and `SystemActor` the RLS contract keys on.
- [Job queue spec](../specs/job-queue.md), [database backup spec](../specs/database-backup.md), [database restore spec](../specs/database-restore.md), [node job secrets runbook](../runbooks/node-job-secrets.md).
- Code: `apps/api/prisma.config.ts`, `apps/api/prisma/migrations/20260906120000_add_jobs/migration.sql`, `apps/api/prisma/migrations/20260907140000_add_backup_run_job_link/migration.sql`, `apps/api/src/db-backup/pg-dump.util.ts`, `apps/api/src/db-backup/pg-restore.util.ts`, `apps/api/src/db-backup/pg-job-role.broker.ts`, `apps/api/src/db-backup/admin-connection.util.ts`, `apps/api/test/helpers/scratch-database.helper.ts`.
- Issues: #708 (this spike), #709 to #713, #725, epic #664, program #659.
