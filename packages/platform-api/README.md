# @marinoscar/platform-api

The NestJS side of the platform: dynamic modules (one subpath export per slice, for example `@marinoscar/platform-api/<slice>`) that an app imports into its own `AppModule` and extends through options, registries and injection tokens. CommonJS, compiled with `tsc` so decorator metadata (`design:paramtypes`) survives for Nest dependency injection.

## Purpose and scope

Dynamic modules, services, guards and registries of the platform's API slices. It does not own the app's composition root, its product identity or its own feature modules.

Status: pre-release (version `0.0.0`). The root export is only the package name (`PLATFORM_PACKAGE`); the slices are subpath exports, each with its own README:

- `@marinoscar/platform-api/core`: the bottom of the slice graph, code only: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`), the principal and scope contract (`Principal`, `Scope`, `SystemActor`, ADR 0001), the exception filter and its exceptions (`HttpExceptionFilter`, `ErrorDto`, `withVerbatimErrorBody`, `DatabaseSeedException`), the secret cipher (`encryptSecret`, `decryptSecret`, `userCredentialPurpose`, `deriveSigningKey`, `verifyEncryptionKeyAtStartup`) and the OpenAPI tag registry (`openApiTags`), and scoped data access (`userOwnedModelRegistry`, `forUser`, `userScopeExtension`, `asSystem`, `ScopedAccessError`; schema-independent, #699). [README](src/core/README.md).
- `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`, the `cron-enqueue-only` and `user-owned-data` suites, and the small Prisma schema reader behind the latter). [README](src/testing/README.md).
- `@marinoscar/platform-api/doctor`: the admin Doctor, `GET /api/admin/doctor` (`DoctorModule.forRoot({ host })`, `DoctorCheckRegistry`, the check contract). The first packaged slice (#696). [README](src/doctor/README.md).
- `@marinoscar/platform-api/otel-core` and `@marinoscar/platform-api/otel-core/sdk`: the emitting half of telemetry (#700): `initializeOtel` (the Nest-free SDK bootstrap, loaded first), the runtime export gate `telemetryGate`, the metrics host `MetricsHostService` with the app-metric name registry and the gauge-provider seam, `registerRequestSpanAttributes` and `@Trace()`. [README](src/otel-core/README.md).
- `@marinoscar/platform-api/identity` and `@marinoscar/platform-api/identity/testing`: identity (#727): `IdentityModule.forRoot()`, the route-access decorators and guards (`@Auth`, `@Public`, `@CurrentUser`, `@CurrentPrincipal`, `JwtAuthGuard`), sessions and refresh tokens, personal access tokens, worker-node credentials, the device flow, users, the allowlist, organizations and tenancy, the sign-in provider registry, the `identity.*` events and the host ports identity reaches the app through; the test login, the stub host and the `identity` conformance suite. [README](src/identity/README.md).
- `@marinoscar/platform-api/settings` and `@marinoscar/platform-api/settings/testing`: settings (#733): `SettingsModule.forRoot()`, the system and user namespace registries and their composition, `SystemSettingsService`, `UserSettingsService`, the org layer (`OrgSettingsService`, `/api/org-settings`), `SettingsResolver` (system, then org, then user) and `SystemSettingsRowStore`; the `settings` conformance suite. [README](src/settings/README.md).
- `@marinoscar/platform-api/credentials` and `@marinoscar/platform-api/credentials/testing`: the encrypted credential stores (#735): the deployment's (`CredentialsService`), a user's own (`UserCredentialsService`) and an organization's (`OrgCredentialsService`, `org_credentials` under row-level security), `UserCredentialResolver` (user, then org, then deployment), the purpose registries `registerCredentialPurpose` and `registerUserCredentialPurpose`, and the `credentials` conformance suite. [README](src/credentials/README.md).
- `@marinoscar/platform-api/onboarding` and `@marinoscar/platform-api/onboarding/testing`: onboarding (#745): `OnboardingModule.forRoot()`, the step, fact, ordering and activation-milestone registries, the platform steps (storage, email, access, AI, Web Push, backups, the org invite; profile, notifications), `GET /api/onboarding` (derived, read-only) and `GET /api/admin/onboarding/metrics` (aggregates only), the `onboarding` user-settings namespace and `extendOnboardingSettings`; the `onboarding` conformance suite. [README](src/onboarding/README.md).
- `@marinoscar/platform-api/email` and `@marinoscar/platform-api/email/testing`: outgoing email (#737): `EmailModule.forRoot()`, the SES and SMTP transports with inline attachments, the `email` settings row and `/api/email-settings`, the template registry (`registerEmailTemplate`, `EmailTemplateDataMap` augmentation, overrides), the layout theme and brand-mark slot, the safe-HTML helpers and the `email` conformance suite. [README](src/email/README.md).

The `core` slice also holds the **host ports** (#696: `definePlatformHost`, `AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, `PLATFORM_PRISMA`, `PlatformHostModule`), the one mechanism every packaged slice uses to reach app-owned capabilities, with test doubles in `testing`. [Host ports](src/core/README.md#host-ports).

More slices arrive in later releases of the platform program.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-api
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@nestjs/common` | `^11.1.12` |
| `@nestjs/core` | `^11.1.12` |
| `@nestjs/event-emitter` | `^3.0.1` (identity) |
| `@nestjs/jwt` | `^11.0.2` (identity) |
| `@nestjs/passport` | `^11.0.5` (identity) |
| `@nestjs/swagger` | `^11.2.5` |
| `@opentelemetry/api` | `^1.9.1` |
| `@prisma/client` | `^7.8.0` |
| `fastify` | `^5` |
| `nestjs-zod` | `^5.4.0` |
| `passport` | `^0.7.0` (identity) |
| `reflect-metadata` | `^0.2.2` |
| `rxjs` | `^7.8.1` |
| `zod` | `^4.4.3` |

The OpenTelemetry SDK packages the `otel-core` slice installs (`@opentelemetry/sdk-node`, the auto-instrumentations, the OTLP/HTTP exporters and their SDK siblings) are regular dependencies, not peers: only `@opentelemetry/api`, which holds the process-wide providers, must be a single shared copy.

## Quick start

Run the platform's conformance suites from a spec of your own (the reference app's is [`apps/api/test/jobs/cron-enqueue-only.spec.ts`](../../apps/api/test/jobs/cron-enqueue-only.spec.ts)):

```ts
import { join } from 'node:path';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: { cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 8 } },
});
```

Declare a registry with `defineRegistry`, register the exception filter and validate the encryption key at bootstrap with `@marinoscar/platform-api/core`; see the [core README](src/core/README.md#quick-start).

## Configuration

None at the package level. Each slice documents its own options: `DoctorModule.forRoot()` in the [doctor README](src/doctor/README.md#configuration), `initializeOtel()` and `OtelMetricsModule` in the [otel-core README](src/otel-core/README.md#configuration), `PlatformHostModule.forRoot()` in the [core README](src/core/README.md#host-ports), the harness in the [testing README](src/testing/README.md#configuration).

## Extension-point catalog

None. The root export is only the package name; the extension points live in the slice catalogs ([core](src/core/README.md#extension-point-catalog), [testing](src/testing/README.md#extension-point-catalog), [doctor](src/doctor/README.md#extension-point-catalog), [otel-core](src/otel-core/README.md#extension-point-catalog)).

## Data

None yet. A slice that owns models documents them here and in its own README; the schema fragments and migrations ship in `@marinoscar/platform-db`.

## Permissions and settings

The `doctor` slice requires `system_settings:read` by default and declares no permission of its own ([README](src/doctor/README.md#permissions-and-settings)). Other slices declare theirs in their own README as they are extracted.

## UI

None. Pages and settings cards live in `@marinoscar/platform-web`.

## Infra

Compose, nginx and collector configuration live in `@marinoscar/platform-infra`. The package reads `SECRETS_ENCRYPTION_KEY` (the `core` slice's secret cipher, see the [core README](src/core/README.md#configuration)) and, in the `otel-core` slice, the existing OpenTelemetry variables (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_DEBUG`); it exports OTLP/HTTP to the collector ([otel-core README](src/otel-core/README.md#infra)) and adds no variable.

## Observability

The `doctor` slice logs one `warn` line when a check throws; `core` logs one `debug` line when it freezes the static registries, one line per handled error and the encryption-key startup check ([core README](src/core/README.md#observability)). Packaged code logs through Nest's `Logger`, which the app routes to its own logger. `otel-core` installs the OpenTelemetry SDK (when `OTEL_ENABLED=true`) and exports only what its runtime gate lets through ([README](src/otel-core/README.md#observability)). Other slices document theirs as they are extracted.

## Security notes

Every packaged controller takes the app's auth decorators through the host access port (`definePlatformHost`) rather than ship its own, and every `forRoot` refuses to build one without a host, so a packaged route is never public. The one route so far, `GET /api/admin/doctor`, is read-only and requires `system_settings:read` by default. The `core` slice also holds the secret cipher and the exception filter; their key handling, the module-scope key cache (install exactly one copy of the package) and the error-body rules are in the [core README](src/core/README.md#security-notes).

## Conformance suite

The harness is the `testing` slice: `runPlatformConformance()` from `@marinoscar/platform-api/testing` runs the platform's suites in any app: `cron-enqueue-only` and `user-owned-data`. See the [testing README](src/testing/README.md#conformance-suite).

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

## Troubleshooting

None yet. Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
