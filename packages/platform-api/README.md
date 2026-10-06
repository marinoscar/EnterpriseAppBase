# @marinoscar/platform-api

The NestJS side of the platform: dynamic modules (one subpath export per slice, for example `@marinoscar/platform-api/<slice>`) that an app imports into its own `AppModule` and extends through options, registries and injection tokens. CommonJS, compiled with `tsc` so decorator metadata (`design:paramtypes`) survives for Nest dependency injection.

## Purpose and scope

Dynamic modules, services, guards and registries of the platform's API slices. It does not own the app's composition root, its product identity or its own feature modules.

Status: pre-release (version `0.0.0`). The root export is only the package name (`PLATFORM_PACKAGE`); the slices are subpath exports, each with its own README:

- `@marinoscar/platform-api/core`: the bottom of the slice graph, code only: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`), the principal and scope contract (`Principal`, `Scope`, `SystemActor`, ADR 0001), the exception filter and its exceptions (`HttpExceptionFilter`, `ErrorDto`, `withVerbatimErrorBody`, `DatabaseSeedException`), the secret cipher (`encryptSecret`, `decryptSecret`, `userCredentialPurpose`, `verifyEncryptionKeyAtStartup`) and the OpenAPI tag registry (`openApiTags`). [README](src/core/README.md).
- `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`, the `cron-enqueue-only` suite). [README](src/testing/README.md).
- `@marinoscar/platform-api/doctor`: the admin Doctor, `GET /api/admin/doctor` (`DoctorModule.forRoot({ host })`, `DoctorCheckRegistry`, the check contract). The first packaged slice (#696). [README](src/doctor/README.md).

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
| `@nestjs/swagger` | `^11.2.5` |
| `@opentelemetry/api` | `^1.9.1` |
| `@prisma/client` | `^7.8.0` |
| `fastify` | `^5` |
| `nestjs-zod` | `^5.4.0` |
| `reflect-metadata` | `^0.2.2` |
| `rxjs` | `^7.8.1` |
| `zod` | `^4.4.3` |

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

None at the package level. Each slice documents its own options: `DoctorModule.forRoot()` in the [doctor README](src/doctor/README.md#configuration), `PlatformHostModule.forRoot()` in the [core README](src/core/README.md#host-ports), the harness in the [testing README](src/testing/README.md#configuration).

## Extension-point catalog

None. The root export is only the package name; the extension points live in the slice catalogs ([core](src/core/README.md#extension-point-catalog), [testing](src/testing/README.md#extension-point-catalog), [doctor](src/doctor/README.md#extension-point-catalog)).

## Data

None yet. A slice that owns models documents them here and in its own README; the schema fragments and migrations ship in `@marinoscar/platform-db`.

## Permissions and settings

The `doctor` slice requires `system_settings:read` by default and declares no permission of its own ([README](src/doctor/README.md#permissions-and-settings)). Other slices declare theirs in their own README as they are extracted.

## UI

None. Pages and settings cards live in `@marinoscar/platform-web`.

## Infra

Compose, nginx and collector configuration live in `@marinoscar/platform-infra`. The one environment variable the package reads is `SECRETS_ENCRYPTION_KEY`, read by the `core` slice's secret cipher (see the [core README](src/core/README.md#configuration)).

## Observability

The `doctor` slice logs one `warn` line when a check throws; `core` logs one `debug` line when it freezes the static registries, one line per handled error and the encryption-key startup check ([core README](src/core/README.md#observability)). Packaged code logs through Nest's `Logger`, which the app routes to its own logger. Other slices document theirs as they are extracted.

## Security notes

Every packaged controller takes the app's auth decorators through the host access port (`definePlatformHost`) rather than ship its own, and every `forRoot` refuses to build one without a host, so a packaged route is never public. The one route so far, `GET /api/admin/doctor`, is read-only and requires `system_settings:read` by default. The `core` slice also holds the secret cipher and the exception filter; their key handling, the module-scope key cache (install exactly one copy of the package) and the error-body rules are in the [core README](src/core/README.md#security-notes).

## Conformance suite

The harness is the `testing` slice: `runPlatformConformance()` from `@marinoscar/platform-api/testing` runs the platform's suites in any app, starting with `cron-enqueue-only`. See the [testing README](src/testing/README.md#conformance-suite).

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

## Troubleshooting

None yet. Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
