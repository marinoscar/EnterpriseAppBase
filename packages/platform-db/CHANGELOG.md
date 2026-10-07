# @marinoscar/platform-db

## 0.1.0-next.2

### Minor Changes

- c91cf7b: Add the `@marinoscar/platform-db/seed` slice: `seedPlatform(prisma, input)` upserts the platform's roles, permissions, default grants, the `global` system settings row and the initial administrator's allowlist entry (never deleting, never overwriting an admin-edited value), with `platformSeedInputFrom` and `readSeedSnapshot` to build the input from the registries' committed catalogs.
- 9734a55: `platform db baseline`: adopt the package migration history in a database that already has its schema, without re-running a migration. Dry run by default; `--apply` maps the app's directories to the platform migrations (exact hash, comment-stripped hash, or a `--map` file), refuses on a failed `_prisma_migrations` row, a live schema difference no declared deviation explains, or a missing raw-SQL index, then writes `platform.lock` and marks the migrations that have no directory applied with `prisma migrate resolve --applied`. `--through` adopts a database that is behind. Adds `runBaseline`, `proposeMapping`, `planBaseline`, `renderReport` and `createBaselineDeps`.

### Patch Changes

- 2235f8a: `platform.lock` and `manifest.json` accept semantic versions with a prerelease or build suffix (`0.1.0-next.1`), so `platform db sync` at a prerelease package version writes a lock `parseLock` reads back. `compareVersions` orders versions by semver precedence (a prerelease is below its release, numeric identifiers compare numerically), and `nextPlatformVersion` gives a prerelease package the release it leads to. Adds `SEMVER_PATTERN`.

## 0.1.0-next.1

### Minor Changes

- 31c6b2a: Platform history v1: the base's 22 migrations ship in `migrations/` (`0001_initial` to `0022_add_retention_created_at_indexes`, byte-identical to the app copies) with a filled `manifest.json` (an entry may list the other slices it `touches`), and the raw-SQL index list becomes the exported `RAW_SQL_INDEXES` with a tripwire (`assertRawSqlIndexes`) that fails on an unlisted partial or expression index.

### Patch Changes

- 521f3d2: Schema comments name `@marinoscar/platform-api/core` as the home of the secret cipher (comments only; no model change).

## 0.1.0-next.0

### Minor Changes

- ebaabe2: Ship the base Prisma schema as slice fragments with `// @extensible` models and `extend model`, plus the `platform db compose [--check]` composer that generates an app's `prisma/schema/` folder.
- a66fef1: First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

  - `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
  - `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
  - `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
  - `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
  - `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
  - `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.

- a630d75: Migration tooling: the `platform` bin gains `platform db sync` (byte-copy package migrations into the app's `prisma/migrations` under app-local timestamps and record them in `prisma/platform.lock`), `platform db check` (offline lock verification; `--database` also compares `_prisma_migrations` checksums), `platform db promote` (turn an app-generated migration into a package migration) and `platform db drift` (migration history vs schema through a shadow database, plus the raw-SQL index assertion). Adds the `PlatformLock` and manifest models, `planSync`, `applySync`, `checkLock`, `checkLedger`, `promote` and `raw-sql-indexes.json`.
