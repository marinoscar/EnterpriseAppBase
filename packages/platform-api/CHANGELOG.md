# @marinoscar/platform-api

## 0.1.0-next.3

### Minor Changes

- 76fb492: Export `deriveSigningKey(purpose)` from `@marinoscar/platform-api/core`: a 32-byte HMAC key derived from `SECRETS_ENCRYPTION_KEY` under the permanent label `enterpriseappbase:signing-key:v1:`, byte-identical to the app-side copy it replaces (#822).
- 55a3402: Add the support bundle: `@marinoscar/platform-contract/doctor` (`supportBundleSchema`), `GET <doctor path>/support-bundle` with `SupportBundleRegistry`, `SupportBundleService`, redaction rules v1 and the built-in `meta`, `doctor` and `egress` sections in `@marinoscar/platform-api/doctor`, and the "Download support bundle" button and `useSupportBundleDownload` hook in `@marinoscar/platform-web/doctor` (plus the optional `PlatformApiClient.getBlob`).
- f1fff88: Add the `telemetry` slice (`@marinoscar/platform-api/telemetry` and `/telemetry/testing`): `TelemetryModule.forRoot({ host, imports, ... })` with host ports for audit, settings, credentials, jobs, AI and app identity, the metric-group registry, the `VERDICT_POLICY` token with configurable verdict thresholds, and the five telemetry Doctor checks.

### Patch Changes

- Updated dependencies [738d71c]
- Updated dependencies [55a3402]
- Updated dependencies [bd9ad6f]
  - @marinoscar/platform-contract@0.1.0-next.3

## 0.1.0-next.2

### Minor Changes

- fd29180: Add `@marinoscar/platform-contract/doctor`, the first contract slice (#701): the Doctor's report, row, status and query schemas, their types and the zod-free status constants. `platform-api`'s Doctor DTOs now wrap these schemas and `platform-web`'s Doctor takes its types from them; both re-export the old names (`DOCTOR_STATUS_ORDER` and `DoctorReportQuery` in `platform-web` are deprecated aliases). No wire or OpenAPI change. Sets the contract conventions (slice layout, zod-free constants, import rules, `schema` catalog kind).
- c41df57: Doctor slice: add the egress inventory (`EgressRegistry`, `EgressContributor`, `EgressDependency`, `classifyHost`) and the `network.egress` air-gap readiness check (`NetworkEgressDoctorCheck`, graded by `DEPLOYMENT_NETWORK_SOURCE`); `network` joins `PLATFORM_DOCTOR_CATEGORIES`.
- a2db925: Add the `otel-core` slice: `@marinoscar/platform-api/otel-core/sdk` (the Nest-free `initializeOtel()` bootstrap, the runtime `telemetryGate` and its gated exporters, the service-name and instance-id resolvers) and `@marinoscar/platform-api/otel-core` (the `MetricsHostService` metrics host and `OtelMetricsModule`, the app-metric name registry, label bounding, the gauge-provider seam, `registerRequestSpanAttributes` and `@Trace()`).
- ab888f5: Scoped data access in `@marinoscar/platform-api/core` (the user-owned data registry, `forUser`/`userScopeExtension`, `asSystem`, `ScopedAccessError`; schema-independent via `@prisma/client/extension`) and the `userOwnedData` conformance suite in `@marinoscar/platform-api/testing`.

### Patch Changes

- Updated dependencies [fd29180]
  - @marinoscar/platform-contract@0.1.0-next.2

## 0.1.0-next.1

### Minor Changes

- 1ca1ff0: core: add the principal and scope types, HttpExceptionFilter with ErrorDto and its exceptions, the secret cipher with verifyEncryptionKeyAtStartup, and the openApiTags registry.

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

### Patch Changes

- 9bc1ed1: Declare `fastify` as an optional peer: npm no longer auto-installs a second fastify beside the exact version `@nestjs/platform-fastify` pins in a consumer app (found by the consumer smoke).
