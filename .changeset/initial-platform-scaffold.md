---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
"@marinoscar/platform-db": minor
"@marinoscar/platform-cli": minor
"@marinoscar/platform-infra": minor
---

First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

- `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
- `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
- `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
- `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
- `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
- `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.
