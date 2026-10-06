# @marinoscar/platform-infra

Deployment configuration shipped as files: Compose fragments (`compose/`), nginx configuration (`nginx/`) and OpenTelemetry collector configuration (`otel/`), layered by an app with its own overlays. `infraFile('compose/<file>')` returns the absolute path of a shipped file, for `docker compose -f`.

## Purpose and scope

Compose fragments, nginx and collector configuration of the platform, plus `infraFile()` to locate them. It does not own the app's own overlays, `.env` or images.

Status: scaffold only (version `0.0.0`). The package builds, packs and loads, and exports `infraFile()` and its own name (`PLATFORM_PACKAGE`). Slices arrive as subpath exports (`@marinoscar/platform-infra/<slice>`) in later releases of the platform program, each with its own README.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-infra
```

No peer dependencies: the package needs nothing installed beside it.

## Quick start

```ts
import { infraFile } from '@marinoscar/platform-infra';

const base = infraFile('compose/base.compose.yml'); // absolute path for docker compose -f
```

The fragments themselves arrive with the infra slices; until then `compose/` is empty.

## Configuration

None. No slice is exported yet, so there is no `forRoot()` or other option to set.

## Extension-point catalog

None. Nothing the package exports is an extension point yet; each slice adds its rows (`Name`, `Kind`, `Signature`, `When to use`, `Stability`, `Example`) when it is extracted.

## Data

None. The package holds configuration files, not data.

## Permissions and settings

None. Configuration files declare no permission or setting.

## UI

None. The package renders nothing.

## Infra

Scaffold only: `compose/`, `nginx/` and `otel/` are empty. `infraFile(relativePath)` (`@stability experimental`) returns the absolute path of a shipped file and throws on an empty, absolute or escaping path. No environment variable is read.

## Observability

None. The package emits nothing at run time.

## Security notes

`infraFile()` refuses absolute paths and any path that resolves outside the package root, so a caller cannot use it to read arbitrary files.

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
