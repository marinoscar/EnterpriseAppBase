# @marinoscar/platform-db

The data layer of the platform: Prisma schema fragments (`schema/`), SQL migrations (`migrations/`) and seed functions that an app composes into its own schema and migration history. CommonJS, like the API that consumes it.

## Purpose and scope

Schema fragments, migrations and seeds of the platform's data slices. It does not run migrations against a database itself; the app's `prisma:*` scripts do.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-db/<slice>`) in later releases of the platform program, each with its own README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-db
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@prisma/client` | `^7.8.0` |
| `prisma` | `^7.8.0` |

## Quick start

None. Scaffold only (version `0.0.0`): the package exports nothing but its own name, `PLATFORM_PACKAGE`, so there is nothing to set up yet.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

## Data

None yet. `schema/` and `migrations/` are empty; each data slice documents its models, migration ids and seeds here as it is extracted.

## Permissions and settings

None. The data layer declares no permission or setting; the API slices do.

## UI

None. The package renders nothing.

## Infra

None. The package ships no deployment configuration and reads no environment variable; the database connection is the app's.

## Observability

None. The package emits nothing at run time.

## Security notes

Nothing is shipped yet. Raw-SQL partial unique indexes stay in migration SQL, never as `@@unique` (see the repository's invariants).

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
