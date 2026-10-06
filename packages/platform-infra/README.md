# @marinoscar/platform-infra

Deployment configuration shipped as files: Compose fragments (`compose/`), nginx configuration (`nginx/`) and OpenTelemetry collector configuration (`otel/`), layered by an app with its own overlays. `infraFile('compose/<file>')` returns the absolute path of a shipped file, for `docker compose -f`.

## Purpose and scope

Compose fragments, nginx and collector configuration of the platform, plus `infraFile()` to locate them. It does not own the app's own overlays, `.env` or images.

Slices, each a subpath export with its own README:

- [`@marinoscar/platform-infra/telemetry`](src/telemetry/README.md): the collector and GreptimeDB compose fragments, the platform collector config, the app-owned collector overlay and their typed manifest.

The package also ships the `platform-infra` command (`bin/platform-infra.mjs`), which materialises the fragments into the app. Version `0.0.0`, unpublished; the base, prod, vps and worker fragments and nginx follow (#714).

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

Fragments are copied into the app and committed, never resolved from `node_modules` at deploy time (an app's VPS deploy runs `docker compose` from its cloned repository, where there is no `node_modules`):

```bash
npx platform-infra sync           # materialise every fragment into infra/, write infra/platform-infra.lock.json
npx platform-infra sync --check   # CI: fail when a generated file differs from the package or the lock
```

In this repository the root script is `npm run platform:infra:sync`.

## Configuration

No `forRoot()`. The `platform-infra sync` command takes `--check` (write nothing; exit 1 on drift) and `--root <dir>` (the app's repository root, default the current directory); see the [telemetry slice README](src/telemetry/README.md#configuration).

## Extension-point catalog

None. The root entry point exports no extension point; each slice lists its own (`telemetryInfraFragment` and the collector overlay: [telemetry slice README](src/telemetry/README.md#extension-point-catalog)).

## Data

None. The package holds configuration files, not data.

## Permissions and settings

None. Configuration files declare no permission or setting.

## UI

None. The package renders nothing.

## Infra

Slice files ship under `<slice>/` (`telemetry/compose/`, `telemetry/otel/`); the root `compose/`, `nginx/` and `otel/` folders are still empty. `infraFile(relativePath)` (`@stability experimental`) returns the absolute path of a shipped file and throws on an empty, absolute or escaping path. No environment variable is read.

Generated files start with a `# GENERATED from @marinoscar/platform-infra@<version> (<slice>)` header and are never edited in the app; `infra/platform-infra.lock.json` records the version and the sha256 of each body. App-owned files (the collector overlay `infra/otel/app-collector.yaml`) are created once from a package example and never overwritten.

## Observability

None. The package emits nothing at run time; the telemetry slice ships the collector configuration itself (see its README). `platform-infra sync` prints only the files it wrote.

## Security notes

`infraFile()` refuses absolute paths and any path that resolves outside the package root, so a caller cannot use it to read arbitrary files. `platform-infra sync` refuses any path that leaves the app root or the package, validates its whole plan before writing, and never overwrites an app-owned file.

## Conformance suite

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness.

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

## Troubleshooting

`sync --check` failures (a hand-edited generated file, a stale lock) are in the [telemetry slice README](src/telemetry/README.md#troubleshooting) and [the telemetry runbook § 12](../../docs/runbooks/telemetry.md#12-troubleshooting). Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
