# @marinoscar/platform-contract

## 0.1.0-next.3

### Minor Changes

- 738d71c: Add `@marinoscar/platform-contract/telemetry` (#702): the telemetry wire shapes (config, status, explorer, connection, stack, dashboard, assistant) and the `telemetry` settings namespace as zod schemas with their inferred types, plus the zod-free limits and enums they are built from, the `/metrics` schema builders for a server with its own metric-group registry, and the settings and connection no-secret proofs. Moved from the reference app's API DTOs and web mirrors without changing a field, a limit or a rule; the generated OpenAPI document is byte-identical.
- 55a3402: Add the support bundle: `@marinoscar/platform-contract/doctor` (`supportBundleSchema`), `GET <doctor path>/support-bundle` with `SupportBundleRegistry`, `SupportBundleService`, redaction rules v1 and the built-in `meta`, `doctor` and `egress` sections in `@marinoscar/platform-api/doctor`, and the "Download support bundle" button and `useSupportBundleDownload` hook in `@marinoscar/platform-web/doctor` (plus the optional `PlatformApiClient.getBlob`).

### Patch Changes

- bd9ad6f: Add the telemetry slice (`@marinoscar/platform-web/telemetry/headless`, `/telemetry/ui` and a subpath per page): the telemetry settings page, explorer and dashboard with their client, hooks, config provider, route guard, `TelemetryWebAdapters`, `telemetryAdminCards` and the `withTelemetryTokens` theme-token contract. `PlatformApiClient` gains optional request options (`signal`, `ifMatch`), `postBlob` and `postSse`, and `PlatformApiError` an optional `details`; the test host answers all of them. The contract's telemetry README points at the web client's new home.

## 0.1.0-next.2

### Minor Changes

- fd29180: Add `@marinoscar/platform-contract/doctor`, the first contract slice (#701): the Doctor's report, row, status and query schemas, their types and the zod-free status constants. `platform-api`'s Doctor DTOs now wrap these schemas and `platform-web`'s Doctor takes its types from them; both re-export the old names (`DOCTOR_STATUS_ORDER` and `DoctorReportQuery` in `platform-web` are deprecated aliases). No wire or OpenAPI change. Sets the contract conventions (slice layout, zod-free constants, import rules, `schema` catalog kind).

## 0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- a66fef1: First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

  - `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
  - `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
  - `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
  - `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
  - `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
  - `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.
