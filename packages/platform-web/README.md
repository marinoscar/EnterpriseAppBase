# @marinoscar/platform-web

The React side of the platform: pages, components and hooks built on MUI, exposed one subpath per slice. ESM with `sideEffects: false`; it loads in plain Node ESM as well as through a bundler.

## Purpose and scope

Pages, components, hooks and settings-page descriptors of the platform's web slices. It does not own the app's router, theme or settings registries; the app binds the package's descriptors into its own.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-web/<slice>`) in later releases of the platform program, each with its own README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-web
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@emotion/react` | `^11.14.0` |
| `@emotion/styled` | `^11.14.1` |
| `@mui/icons-material` | `^9.1.0` |
| `@mui/material` | `^9.1.0` |
| `react` | `^19.2.7` |
| `react-dom` | `^19.2.7` |
| `react-router-dom` | `^7.17.0` |

## Quick start

None. Scaffold only (version `0.0.0`): the package exports nothing but its own name, `PLATFORM_PACKAGE`, so there is nothing to set up yet.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

## Data

None. The browser holds no data model; it reads and writes through the API.

## Permissions and settings

None yet. Each slice documents the permissions its pages require (the exact strings the API enforces) as it is extracted.

## UI

None yet. Each slice lists its pages, registry entries, slots and theme tokens in its own README.

## Infra

None. The package ships no deployment configuration and reads no environment variable.

## Observability

None yet. Each slice documents what it reports as it is extracted.

## Security notes

Nothing is exported yet. Pages never hold an API key and never call an AI provider from the browser; authorization stays in the API.

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
