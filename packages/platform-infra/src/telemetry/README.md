# @marinoscar/platform-infra/telemetry

The telemetry infra fragment: the OpenTelemetry collector and GreptimeDB compose services, their VPS hardening, the platform collector config and the app-owned collector overlay, plus the typed manifest (`telemetryInfraFragment`) that the `platform-infra sync` command and the app CLI read. Infra layer; it depends on no other slice of the package (`packages/platform-slices.json`).

Status: stub. #707 completes this README per the Package documentation standard; the sections below already describe what ships.

## Purpose and scope

Owns the canonical copies of three files, shipped under `telemetry/` in the package:

| Package file | Materialised to (app) | Owner |
|---|---|---|
| `telemetry/compose/telemetry.compose.yml` | `infra/compose/telemetry.compose.yml` | platform (generated) |
| `telemetry/compose/vps.telemetry.compose.yml` | `infra/compose/vps.telemetry.compose.yml` | platform (generated) |
| `telemetry/otel/otel-collector-config.yaml` | `infra/otel/otel-collector-config.yaml` | platform (generated) |
| `telemetry/otel/app-collector.example.yaml` | `infra/otel/app-collector.yaml` | app (created once, never overwritten) |

It does not own the base, prod, vps or worker compose files, nginx, or the general app compose-overlay mechanism (#714); the stack-agent source stays in `apps/stack-agent`, and its image is published by the platform release (#692). The API side of telemetry is `@marinoscar/platform-api/telemetry`.

## Install and peer dependencies

Ships inside `@marinoscar/platform-infra`:

```ts
import { telemetryInfraFragment } from '@marinoscar/platform-infra/telemetry';
```

No peer dependencies. The materialised files need Docker Compose and the collector image they pin (`otel/opentelemetry-collector-contrib:0.145.0`).

## Quick start

Materialise the files into the app and commit them (a VPS deploy runs `docker compose` from the cloned repository, where there is no `node_modules`):

```bash
npx platform-infra sync            # this repository: npm run platform:infra:sync
npx platform-infra sync --check    # in CI: fails on a hand edit, naming the file and the fix
```

The reference app's CLI reads the compose file order from the manifest (`apps/cli/src/deploy/compose-files.ts`):

```ts
const after = (slot: ComposeSlot) =>
  telemetryInfraFragment.composeFiles.filter((f) => f.slot === slot).map((f) => f.file);
// base, prod, ...after('after-prod'), vps, ...after('after-vps')
```

## Configuration

`platform-infra sync` takes two options and reads no environment variable:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--check` | flag | off | Write nothing; exit 1 when a generated file differs from the package or from `infra/platform-infra.lock.json` |
| `--root <dir>` | path | current directory | The app's repository root; every materialised path is relative to it |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `telemetryInfraFragment` | overlay | `InfraFragment` | Locate the generated files, the compose slots and the app-owned collector overlay (`collectorConfigs.app`) instead of hard-coding them | experimental | [example](../../../../infra/otel/app-collector.yaml) |

The overlay itself is `infra/otel/app-collector.yaml`: the collector starts with `--config=/etc/otelcol/platform.yaml --config=/etc/otelcol/app.yaml`, so the app adds receivers, processors, exporters and pipelines there without editing a platform file. **Maps merge; lists are replaced, never appended**: restating an existing pipeline's `receivers` replaces the platform's list. Add a new named pipeline (`metrics/app`) instead; the shipped example documents the pattern, and `test/fixtures/metrics-app.overlay.yaml` is validated by CI with the pinned collector.

## Data

None. The fragment owns no tables; the telemetry store is GreptimeDB, configured at runtime (`@marinoscar/platform-api/telemetry`).

## Permissions and settings

None. Configuration files declare no permission or system setting.

## UI

None. The fragment renders nothing; the admin telemetry pages live in `@marinoscar/platform-web/telemetry`.

## Infra

- **Generated files** carry a two-line header (`# GENERATED from @marinoscar/platform-infra@<version> (telemetry) — do not edit; ...`); everything after it is the package file verbatim. `infra/platform-infra.lock.json` records the version and the sha256 of each body.
- **Compose slots** (`composeFiles`): `telemetry.compose.yml` is `after-prod`, `vps.telemetry.compose.yml` is `after-vps`. The VPS files come last because `ports: !override` only replaces what files before it published.
- **Env group**: `observability` adds the files (always on for a VPS deployment).
- **Environment**: the compose files read the existing `GREPTIME_*` and `POSTGRES_*` deployment defaults from `infra/compose/.env.example`; the fragment adds none.
- **Stack-agent image** (`images.stackAgent`, `experimental`, data only): `ghcr.io/marinoscar/enterpriseappbase-stack-agent`, tagged with the platform version once #692 publishes it. A consumer without `apps/stack-agent` sets `image:` (and `build: !reset null`) for `stack-agent` in its own compose overlay after `vps.compose.yml`; the reference app keeps building from source.

## Observability

The collector config is the observability pipeline itself: OTLP in, credential-bearing attributes redacted, host, PostgreSQL, uptime, nginx and pipeline self-metrics scraped, everything exported to GreptimeDB. The sync command logs only the files it wrote.

## Security notes

`sync` refuses any path that is absolute or leaves the app root or the package, never overwrites the app-owned overlay, and validates the whole plan before writing anything. The generated compose files publish nothing on a public interface on a VPS (`vps.telemetry.compose.yml`) and require every `GREPTIME_*_PASSWORD`. Never put a secret in `app-collector.yaml`; read it from the environment.

## Conformance suite

None yet. The package tests cover sync, `--check` and the overlay merge; CI's `collector-config` job runs `otelcol validate` over the base plus every shipped overlay. The telemetry conformance suite arrives with #707.

## Upgrade notes

None. No version has been published yet. After upgrading the package, run `npx platform-infra sync` and commit the files and the lock.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `--check` reports `differs from @marinoscar/platform-infra@<version>` | Run `npx platform-infra sync`; move a deliberate change into `infra/otel/app-collector.yaml` or a compose overlay |
| The collector exits with `read /etc/otelcol/app.yaml: is a directory` | `infra/otel/app-collector.yaml` was missing; remove the directory Docker created and re-run sync |
| A platform pipeline lost a receiver after an overlay change | Lists are replaced: move the addition into a new named pipeline |

## Links

- [Package README](../../README.md)
- [Telemetry runbook § 2](../../../../docs/runbooks/telemetry.md#2-enable-the-overlay): generated files, re-sync, the app overlay
- [Telemetry spec § 10](../../../../docs/specs/telemetry.md#10-deploying-the-stack-stack-agent): stack-agent and the image reference
- [Platform packages spec](../../../../docs/specs/platform-packages.md): slice anatomy, consumer guide (Infra)
