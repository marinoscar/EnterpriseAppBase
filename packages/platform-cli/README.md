# @marinoscar/platform-cli

Command and TUI building blocks for an app's own command-line client: Commander commands and ink components an app registers in its CLI. ESM with `sideEffects: false`; runs on Node 20 or later.

## Purpose and scope

Commander commands and ink components of the platform's CLI slices. It does not own the app's binary name, its program definition or its configuration file location.

Status: version `0.0.0`, unpublished. Slices are subpath exports (`@marinoscar/platform-cli/<slice>`), each with its own README: `core` (the CLI's command and env-spec fragment registries) and `telemetry` (the node span relay and the telemetry env-spec fragment). The root export is still only the package name (`PLATFORM_PACKAGE`).

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

Pick the slice you need and follow its README:

| Subpath | Contents | README |
|---|---|---|
| `@marinoscar/platform-cli/core` | `registerCliCommand`, `registerEnvSpecFragment` and the env-key metadata helpers | [core](src/core/README.md) |
| `@marinoscar/platform-cli/telemetry` | The worker node's span relay and `telemetryEnvSpecFragment` | [telemetry](src/telemetry/README.md) |

```ts
import { registerCliCommand } from '@marinoscar/platform-cli/core';

registerCliCommand((program) => program.command('hello').action(() => console.log('hello')));
```

## Configuration

None at package level. The registries take no options; `NodeSpanRelayOptions` is in the [telemetry README](src/telemetry/README.md#configuration).

## Extension-point catalog

None. The root entry point exports only `PLATFORM_PACKAGE`; the extension points are catalogued per slice, in the [core README](src/core/README.md#extension-point-catalog).

## Data

None. The CLI holds no data model; it calls the API.

## Permissions and settings

None yet. Commands document the API permissions they need as they are extracted.

## UI

None. Terminal output only; the ink components are listed in each slice's README.

## Infra

None. The package ships no deployment configuration and reads no environment variable; `telemetryEnvSpecFragment` annotates keys of the app's `.env.example` (see the [telemetry README](src/telemetry/README.md#infra)).

## Observability

The telemetry slice's node span relay is a worker's only span source; see the [telemetry README](src/telemetry/README.md#observability).

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
