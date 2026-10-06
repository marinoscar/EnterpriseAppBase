# @marinoscar/platform-api

The NestJS side of the platform: dynamic modules (one subpath export per slice, for example `@marinoscar/platform-api/<slice>`) that an app imports into its own `AppModule` and extends through options, registries and injection tokens. CommonJS, compiled with `tsc` so decorator metadata (`design:paramtypes`) survives for Nest dependency injection.

## Purpose and scope

Dynamic modules, services, guards and registries of the platform's API slices. It does not own the app's composition root, its product identity or its own feature modules.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-api/<slice>`) in later releases of the platform program, each with its own README.

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

None. Scaffold only (version `0.0.0`): the package exports nothing but its own name, `PLATFORM_PACKAGE`, so there is nothing to set up yet.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

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

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness.

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

## Troubleshooting

None yet. Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
