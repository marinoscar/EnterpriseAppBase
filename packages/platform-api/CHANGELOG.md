# @marinoscar/platform-api

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
