# @marinoscar/platform-infra/telemetry

The telemetry infra fragment: the OpenTelemetry collector and GreptimeDB compose services, their VPS hardening, the platform collector config and the app-owned collector overlay, plus the typed manifest (`telemetryInfraFragment`) that the `platform-infra sync` command and the app CLI read. Infra layer; it depends on no other slice of the package (`packages/platform-slices.json`).

## Purpose and scope

Owns the canonical copies of three files, shipped under `telemetry/` in the package:

| Package file | Materialised to (app) | Owner |
|---|---|---|
| `telemetry/compose/telemetry.compose.yml` | `infra/compose/telemetry.compose.yml` | platform (generated) |
| `telemetry/compose/vps.telemetry.compose.yml` | `infra/compose/vps.telemetry.compose.yml` | platform (generated) |
| `telemetry/otel/otel-collector-config.yaml` | `infra/otel/otel-collector-config.yaml` | platform (generated) |
| `telemetry/otel/app-collector.example.yaml` | `infra/otel/app-collector.yaml` | app (created once, never overwritten) |

It does not own the base, prod, vps or worker compose files, nginx, or a general app compose-overlay mechanism; the stack-agent source stays in `apps/stack-agent`, and its image is published by the platform release. The API side of telemetry is `@marinoscar/platform-api/telemetry`.

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

One exported seam, and two seams that are files and a command rather than exports (below). Every row links a working use in the reference app.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `telemetryInfraFragment` | overlay | `InfraFragment` | Locate the generated files, the compose slots and the app-owned collector overlay (`collectorConfigs.app`) instead of hard-coding them | experimental | [example](../../../../apps/cli/src/deploy/compose-files.ts), [overlay](../../../../infra/otel/app-collector.yaml) |

### The collector overlay

The collector starts with `--config=/etc/otelcol/platform.yaml --config=/etc/otelcol/app.yaml`, so the app adds receivers, processors, exporters and pipelines in `infra/otel/app-collector.yaml` without editing a platform file. The reference app's file ([`app-collector.yaml`](../../../../infra/otel/app-collector.yaml)) is behaviour-neutral: comments only, so the collector runs exactly the platform configuration. **Maps merge; lists are replaced, never appended**: restating an existing pipeline's `receivers` replaces the platform's list. Add a new named pipeline (`metrics/app`) that reuses the platform's processors and exporters by name:

```yaml
receivers:
  prometheus/app:
    config:
      scrape_configs:
        - job_name: app-sidecar
          static_configs: [{ targets: ["sidecar:9464"] }]
service:
  pipelines:
    metrics/app:
      receivers: [prometheus/app]
      processors: [memory_limiter, attributes/redact, transform/promote_labels, batch]
      exporters: [otlphttp/greptime]
```

The validated fixture overlay that adds a `metrics/app` pipeline is [`test/fixtures/metrics-app.overlay.yaml`](../../test/fixtures/metrics-app.overlay.yaml): the package tests merge it over the platform file, and CI's `collector-config` job runs `otelcol validate` over the base plus every shipped overlay with the pinned collector. Steps for an operator: [runbook section 2.4](../../../../docs/runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay).

### `platform-infra sync`

Materialises the generated files and creates the app-owned overlay once. The reference app runs it through the root script `npm run platform:infra:sync` and fails CI on a hand edit with `npm run platform:infra:sync -- --check` (the `.github/workflows/ci.yml` step that runs it). It is a command of the package's bin, not an export of this slice.

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
- **Environment**: the compose files read the existing `GREPTIME_*`, `OTEL_*` and `POSTGRES_*` deployment defaults from `infra/compose/.env.example`; the fragment adds none. They are deployment defaults, never runtime features: the GreptimeDB connection an administrator saves at `/admin/settings/telemetry` replaces the reader and admin ones, and storage, AI, Web Push and SMTP have no environment variable at all.
- **Stack-agent image** (`images.stackAgent`, `experimental`, data only): `ghcr.io/marinoscar/enterpriseappbase-stack-agent`, tagged with the platform version once the platform release publishes it. A consumer without `apps/stack-agent` sets `image:` (and `build: !reset null`) for `stack-agent` in its own compose overlay after `vps.compose.yml`; the reference app keeps building from source.

## Observability

The collector config is the observability pipeline itself: OTLP in, credential-bearing attributes redacted, host, PostgreSQL, uptime, nginx and pipeline self-metrics scraped, everything exported to GreptimeDB. The sync command logs only the files it wrote.

## Security notes

`sync` refuses any path that is absolute or leaves the app root or the package, never overwrites the app-owned overlay, and validates the whole plan before writing anything. The generated compose files publish nothing on a public interface on a VPS (`vps.telemetry.compose.yml`) and require every `GREPTIME_*_PASSWORD`. Never put a secret in `app-collector.yaml`; read it from the environment.

## Conformance suite

**Check 8, infra drift**, is `platform-infra sync --check`: it fails when a generated file differs from the package or from `infra/platform-infra.lock.json`, naming the file and the fix. It runs as a CI step in the reference app (`npm run platform:infra:sync -- --check`) and in the package's own tests (`sync.test.ts`, `cli.test.ts`). The collector configuration is validated by CI's `collector-config` job (`otelcol validate` over the base plus every shipped overlay, with the image the compose file pins), and `collector-overlay.test.ts` proves the list-replacement rule. The slice's other checks (1 to 6) are the API's: [API README](../../../platform-api/src/telemetry/README.md#conformance-suite).

## Upgrade notes

1.0: first release; moved from the app with no behaviour change. After upgrading the package, run `npx platform-infra sync` and commit the files and the lock.

| Old app path | Now |
|---|---|
| `infra/compose/telemetry.compose.yml`, `infra/compose/vps.telemetry.compose.yml` | The same paths, generated from `telemetry/compose/` (do not edit; the file starts with a `GENERATED from` header) |
| `infra/otel/otel-collector-config.yaml` | The same path, generated from `telemetry/otel/otel-collector-config.yaml` |
| An app's edits to the collector configuration | `infra/otel/app-collector.yaml`, the overlay (created once by `sync`, never overwritten) |
| A hard-coded compose file order in the CLI | `telemetryInfraFragment.composeFiles` and its `slot` |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `--check` reports `differs from @marinoscar/platform-infra@<version>` | Run `npx platform-infra sync`; move a deliberate change into `infra/otel/app-collector.yaml` or a compose overlay |
| The collector exits with `read /etc/otelcol/app.yaml: is a directory` | `infra/otel/app-collector.yaml` was missing; remove the directory Docker created and re-run sync |
| A platform pipeline lost a receiver after an overlay change | Lists are replaced: move the addition into a new named pipeline |
| The telemetry stack does not start on a VPS, or GreptimeDB refuses to boot | See the [telemetry runbook](../../../../docs/runbooks/telemetry.md#12-troubleshooting) |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md): the documentation standard, the extension contract and infra layering
- [Telemetry runbook § 2](../../../../docs/runbooks/telemetry.md#2-enable-the-overlay): generated files, re-sync, the app overlay
- [Telemetry spec § 10](../../../../docs/specs/telemetry.md#10-deploying-the-stack-stack-agent): stack-agent and the image reference
- The same slice in other packages: [API](../../../platform-api/src/telemetry/README.md), [contract](../../../platform-contract/src/telemetry/README.md), [web](../../../platform-web/src/telemetry/README.md), [CLI](../../../platform-cli/src/telemetry/README.md)
