# @marinoscar/platform-db

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
