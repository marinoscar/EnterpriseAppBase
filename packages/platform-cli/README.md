# @marinoscar/platform-cli

Command and TUI building blocks for an app's own command-line client: Commander commands and ink components an app registers in its CLI. ESM with `sideEffects: false`; runs on Node 20 or later.

## Purpose and scope

Commander commands and ink components of the platform's CLI slices. It does not own the app's binary name, its program definition or its configuration file location.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-cli/<slice>`) in later releases of the platform program, each with its own README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-cli
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `commander` | `^14.0.2` |
| `ink` | `^7.1.1` |
| `react` | `^19.2.8` |

## Quick start

None. Scaffold only (version `0.0.0`): the package exports nothing but its own name, `PLATFORM_PACKAGE`, so there is nothing to set up yet.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

## Data

None. The CLI holds no data model; it calls the API.

## Permissions and settings

None yet. Commands document the API permissions they need as they are extracted.

## UI

None. Terminal output only; the ink components are listed in each slice's README.

## Infra

None. The package ships no deployment configuration and reads no environment variable yet.

## Observability

None yet. Commands document their output and exit codes as they are extracted.

## Security notes

Nothing is exported yet. Commands never print or persist a credential beyond the app's own configuration file.

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
