# @marinoscar/platform-contract

Zod schemas, DTOs and TypeScript types shared by `@marinoscar/platform-api` and `@marinoscar/platform-web`, so the server and the browser validate the same shapes. It is the only dual-format package: it ships CommonJS (for the API) and ESM (for the web app and the CLI) from one source, selected by the `exports` map.

## Purpose and scope

The request and response shapes of every platform slice, as Zod schemas plus the inferred types. It holds no runtime behaviour beyond validation: no NestJS, no React, no I/O.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-contract/<slice>`) in later releases of the platform program, each with its own README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-contract
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `zod` | `^4.4.3` |

## Quick start

None. Scaffold only (version `0.0.0`): the package exports nothing but its own name, `PLATFORM_PACKAGE`, so there is nothing to set up yet.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

## Data

None. The package holds schemas of HTTP payloads, not database models; models live in `@marinoscar/platform-db`.

## Permissions and settings

None. Schemas declare no permission or setting; the API slices that use them do.

## UI

None. The package renders nothing; `@marinoscar/platform-web` imports its schemas to validate forms and responses.

## Infra

None. The package ships no deployment configuration and reads no environment variable.

## Observability

None. Validation is pure; the API and web packages log and trace around it.

## Security notes

Schemas are the single source of input validation for both sides. Never loosen a schema in an app to accept a payload the API rejects; file a seam request instead.

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
