# @marinoscar/platform-web

## 0.1.0-next.2

### Minor Changes

- fd29180: Add `@marinoscar/platform-contract/doctor`, the first contract slice (#701): the Doctor's report, row, status and query schemas, their types and the zod-free status constants. `platform-api`'s Doctor DTOs now wrap these schemas and `platform-web`'s Doctor takes its types from them; both re-export the old names (`DOCTOR_STATUS_ORDER` and `DoctorReportQuery` in `platform-web` are deprecated aliases). No wire or OpenAPI change. Sets the contract conventions (slice layout, zod-free constants, import rules, `schema` catalog kind).

### Patch Changes

- Updated dependencies [fd29180]
  - @marinoscar/platform-contract@0.1.0-next.2

## 0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 385e12f: Add the Doctor slice (`@marinoscar/platform-api/doctor`, `@marinoscar/platform-web/doctor/headless` and `/doctor/ui`), host ports in `core` (`definePlatformHost`, `PlatformHostModule`, `PlatformHostProvider`, `PlatformApiClient`) and in-memory test hosts in `testing`.
- a66fef1: First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

  - `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
  - `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
  - `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
  - `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
  - `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
  - `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.
