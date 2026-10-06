# @marinoscar/platform-api

The NestJS side of the platform: dynamic modules (one subpath export per slice, for example `@marinoscar/platform-api/<slice>`) that an app imports into its own `AppModule` and extends through options, registries and injection tokens. CommonJS, compiled with `tsc` so decorator metadata (`design:paramtypes`) survives for Nest dependency injection.

## Purpose and scope

Dynamic modules, services, guards and registries of the platform's API slices. It does not own the app's composition root, its product identity or its own feature modules.

Status: pre-release (version `0.0.0`). The root export is only the package name (`PLATFORM_PACKAGE`); the slices are subpath exports, each with its own README:

- `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`). [README](src/core/README.md).
- `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`, the `cron-enqueue-only` suite). [README](src/testing/README.md).

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

Declare a registry with `defineRegistry` from `@marinoscar/platform-api/core`; see the [core README](src/core/README.md).

## Configuration

None. The package has no `forRoot()`; each slice documents its own options (the harness options are in the [testing README](src/testing/README.md#configuration)).

## Extension-point catalog

None. The root export is only the package name; the extension points live in the slice catalogs ([core](src/core/README.md#extension-point-catalog), [testing](src/testing/README.md#extension-point-catalog)).

## Data

None yet. A slice that owns models documents them here and in its own README; the schema fragments and migrations ship in `@marinoscar/platform-db`.

## Permissions and settings

None yet. Each slice declares its permissions and settings in its own README as it is extracted.

## UI

None. Pages and settings cards live in `@marinoscar/platform-web`.

## Infra

None. Compose, nginx and collector configuration live in `@marinoscar/platform-infra`; this package reads no environment variable yet.

## Observability

None yet. Each slice documents the logs, metrics and spans it emits as it is extracted.

## Security notes

Nothing is exported yet, so there is no route or guard to secure. Every packaged controller will take the app's auth decorators through the host ports rather than ship its own.

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
