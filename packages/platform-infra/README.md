# @marinoscar/platform-infra

Deployment configuration shipped as files, plus the small ESM API that orders and renders them: the platform's Compose fragments (`compose/`), its nginx configuration (`nginx/`), its env templates (`env/`) and the telemetry slice's collector and GreptimeDB files (`telemetry/`). An app never references them from `node_modules`: `platform-infra sync` materialises them into the app's `infra/`, rendered with the app's identity, and the app changes the platform through overlay files, never by editing a generated one. The reference app (`apps/`, `infra/` in this repository) and the CLI's deploy (`apps/cli`) consume it.

## Purpose and scope

What the package owns:

- the Compose files `base`, `dev`, `devdb`, `prod`, `vps` (with the stack agent), `worker`, `worker.build` and `test`, and the order Compose applies them in per mode (`composeFilesForMode()`), with the app's overlays last;
- `postgres-init/10-application-role.sh`, the executable init script `devdb` and `test` mount at `/docker-entrypoint-initdb.d`: it creates the ordinary (`NOSUPERUSER NOBYPASSRLS`) role the API runs as, so row-level security applies to it;
- `nginx.conf` with four include points, the two CSP maps and the `platform/` snippets (`security-headers.conf`, `sse-proxy.conf`);
- the platform's environment variables (`env/base.env.example`) and the worker's (`env/worker.env.example`);
- identity rendering: the app's CLI name, env prefix, service name, worker image and test database names written into those files (`deriveInfraIdentity()`, `renderInfraText()`);
- the `platform-infra sync` command and its lock.

What it does not own: the app's overlays (`infra/compose/app.*.compose.yml`, `infra/nginx/app.d/`, `infra/compose/app.env.example`, `infra/otel/app-collector.yaml`), its `.env`, its Dockerfiles and images, and `apps/stack-agent` (still an app workspace; the `vps` fragment builds it from `apps/stack-agent/Dockerfile`). A Helm chart is deferred.

Slices, each a subpath export with its own README:

- [`@marinoscar/platform-infra/telemetry`](src/telemetry/README.md): the collector and GreptimeDB compose fragments, the platform collector config, the app-owned collector overlay and their typed manifest.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-infra
```

No peer dependencies: the package needs nothing installed beside it.

## Quick start

```bash
npx platform-infra sync           # render every fragment into infra/, write infra/platform-infra.lock.json
npx platform-infra sync --check   # CI: fail when a generated file differs from the package or the lock
```

In this repository the root script is `npm run platform:infra:sync` (it runs the built `dist/`, so `npm run build:packages` comes first). Then start the stack exactly as before, from `infra/compose`:

```bash
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up
```

The order of the `-f` files, with the app's overlays last, comes from the package:

```ts
import { readdirSync } from 'node:fs';
import { composeFilesForMode } from '@marinoscar/platform-infra';

const files = composeFilesForMode('vps', { telemetry: true, overlays: readdirSync('infra/compose') });
```

## Configuration

No `forRoot()`. `platform-infra sync` takes:

| Option | Meaning |
|---|---|
| `--check` | Write nothing; exit 1 when a generated file differs from the package (rendered) or from the lock. |
| `--root <dir>` | The app's repository root (default: the current directory). |
| `--identity <file>` | The app identity, relative to the root. Default `packages/shared/identity.json`; when it has no `cliName`, the single `bin` key of `apps/cli/package.json` is the CLI name. |

The identity file may carry any `InfraIdentityInput` field: `cliName` (required unless the `bin` fallback applies), `productName` (slugified for the defaults below), and explicit `envPrefix`, `serviceName`, `workerImage`, `testDatabase`, `testContainer`. No environment variable is read.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../docs/EXTENDING.md).

The exported seams, then the seams that are files and a command (below). Every row links a working use in the reference app.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `composeFilesForMode` | overlay | `(mode: ComposeMode, options?: ComposeFilesOptions) => string[]` | Build the `-f` list of a mode (dev, devdb, prod, vps, worker) with the app's overlays last, instead of hard-coding it | experimental | [an app overlay it appends](../../infra/compose/app.example.compose.yml) (called by `@marinoscar/platform-cli`'s `deploy` and `init`) |
| `appComposeOverlays` | overlay | `(names: readonly string[], mode: ComposeMode) => string[]` | Find which `app.*.compose.yml` files of a directory apply to a mode, sorted | experimental | [example overlay](../../infra/compose/app.example.compose.yml) |
| `composeInfraFragment` | overlay | `PlatformInfraFragment` | Locate the generated compose files and the app's example overlay | experimental | [example overlay](../../infra/compose/app.example.compose.yml) |
| `nginxInfraFragment` | overlay | `PlatformInfraFragment` | Locate the generated nginx files and the app-owned `app.d/` include points | experimental | [Permissions-Policy](../../infra/nginx/app.d/permissions-policy.conf) |
| `envInfraFragment` | overlay | `PlatformInfraFragment` | Locate the env templates and the app-owned `app.env.example` appended to `.env.example` | experimental | [app variables](../../infra/compose/app.env.example) |
| `deriveInfraIdentity` | option | `(input: InfraIdentityInput) => InfraIdentity` | Derive the names rendered into the files (env prefix, service name, test database) from the CLI and product names | experimental | [rendered worker file](../../infra/compose/worker.compose.yml) |

### Compose overlays

An app changes the stack with `infra/compose/app.*.compose.yml` files, appended after every platform file and sorted by file name, so an overlay always wins. `app.<name>.compose.yml` applies to every mode built on `base.compose.yml` (dev, devdb, prod, vps); `app.<scope>.<name>.compose.yml` (scope `dev`, `devdb`, `prod`, `vps` or `worker`) only to the modes whose platform files include `<scope>.compose.yml`: `app.prod.*` to prod and vps, `app.dev.*` to dev and devdb, `app.vps.*` to vps alone. A name ending in `.example.compose.yml` is never applied: the reference app's [`app.example.compose.yml`](../../infra/compose/app.example.compose.yml) is the documented example, and the reference stack runs without an overlay. The deploy (`composeFilesFor()` in [`compose-files.ts`](../../packages/platform-cli/src/engine/deploy/compose-files.ts)) and `init`'s printed start command include them. The tested fixtures: kvox's memory limits ([`app.prod.memory-limits.compose.yml`](test/fixtures/overlays/kvox/compose/app.prod.memory-limits.compose.yml)) and its stack-agent opt-out with `profiles: ["disabled"]` ([`app.vps.no-stack-agent.compose.yml`](test/fixtures/overlays/kvox/compose/app.vps.no-stack-agent.compose.yml)), rendered with `docker compose config` by [`reference-compose.test.ts`](src/reference-compose.test.ts).

### nginx include points

`nginx.conf` includes four app-owned points under `/etc/nginx/app.d/` (the app's `infra/nginx/app.d/`, mounted by `base.compose.yml`), each created by the sync:

| Include point | Level | Use |
|---|---|---|
| `app.d/http/*.conf` | `http` | maps, upstreams, rate-limit zones |
| `app.d/server/*.conf` | public `server` | server-level directives |
| `app.d/locations/*.conf` | public `server`, before `location /api` | the app's locations |
| `app.d/permissions-policy.conf` | in `platform/security-headers.conf` | the `Permissions-Policy` header; created from the platform default ([reference](../../infra/nginx/app.d/permissions-policy.conf)) |

An empty directory is valid. An app's SSE route is one location whose body is [`platform/sse-proxy.conf`](../../infra/nginx/platform/sse-proxy.conf) (unbuffered proxy to the API, 600 s timeouts, the security headers):

```nginx
location /api/coach/chat/stream { include /etc/nginx/platform/sse-proxy.conf; }
```

EvoPath's two SSE routes and its `geolocation=(self)` are the tested fixture ([`test/fixtures/overlays/evopath/nginx/app.d/`](test/fixtures/overlays/evopath/nginx/app.d/permissions-policy.conf)): `nginx -t` passes on it and every response carries the security headers ([`reference-nginx.test.ts`](src/reference-nginx.test.ts), [`nginx-app-locations.spec.ts`](../../apps/api/test/nginx-app-locations.spec.ts)).

**The CSP override.** `csp.conf` is mounted at `/etc/nginx/csp.conf` by `base.compose.yml` and replaced by `csp.dev.conf` in `dev.compose.yml`; Compose merges `volumes` by container path, so an app replaces the policy with an overlay that mounts its own file at the same path, for example `- ../nginx/app.d/csp.conf:/etc/nginx/csp.conf:ro`. Precedence follows the file order: the app overlay comes after `dev.compose.yml`, so it wins in development too (provide a dev variant in an `app.dev.*` overlay if the app's policy is strict).

### Identity placeholders

Package files carry `@@PLATFORM_<NAME>@@` placeholders, rendered before write (no `$`, so Compose never interpolates one; no `#`, so nginx and dotenv never read one as a comment). Rendering is pure and idempotent.

| Placeholder | Identity field | Reference value | Used in |
|---|---|---|---|
| `@@PLATFORM_CLI_NAME@@` | `cliName` | `appctl` | `vps` messages, worker comments |
| `@@PLATFORM_ENV_PREFIX@@` | `envPrefix` | `APPCTL_` | every worker variable (`worker.compose.yml`, `.env.worker.example`) |
| `@@PLATFORM_SERVICE_NAME@@` | `serviceName` | `<slug>-api` | `OTEL_SERVICE_NAME` default (`base.compose.yml`, `.env.example`) |
| `@@PLATFORM_WORKER_IMAGE@@` | `workerImage` | `ghcr.io/OWNER/REPO-worker:latest` | the worker's default image |
| `@@PLATFORM_TEST_DATABASE@@` | `testDatabase` | `<slug>_test` | `test.compose.yml` |
| `@@PLATFORM_TEST_CONTAINER@@` | `testContainer` | `<slug>-db-test` | `test.compose.yml` |

The identity the reference app was rendered with is recorded in [`infra/platform-infra.lock.json`](../../infra/platform-infra.lock.json).

### `platform-infra sync` and the lock

Materialises the generated files, creates each app-owned file once, and writes `infra/platform-infra.lock.json` (version, identity, sha256 of each generated body, and per fragment the generated files that are `executable`). The reference app runs `npm run platform:infra:sync` and CI fails on drift with `npm run platform:infra:sync -- --check` (the `Build & Test` job of `.github/workflows/ci.yml`). It is a command of the package's bin, not an export.

## Data

None. The package holds configuration files, not data.

## Permissions and settings

None. Configuration files declare no permission or setting.

## UI

None. The package renders nothing.

## Infra

### File order per mode

Platform fragments in the documented order, then the app overlays that apply to the mode, sorted by file name:

| Mode | Platform files | Overlays applied |
|---|---|---|
| dev | `base`, `dev`, [`telemetry`] | `app.<name>`, `app.dev.<name>` |
| devdb | `base`, `dev`, `devdb`, [`telemetry`] | `app.<name>`, `app.dev.<name>`, `app.devdb.<name>` |
| prod | `base`, `prod`, [`telemetry`] | `app.<name>`, `app.prod.<name>` |
| vps (the deploy) | `base`, `prod`, `telemetry`, `vps`, `vps.telemetry` | `app.<name>`, `app.prod.<name>`, `app.vps.<name>` |
| worker | `worker`, [`worker.build`] | `app.worker.<name>` |

The VPS files come after every file whose `ports:` they override (`ports: !override` only replaces what came before), `telemetry` adds services before them, and app overlays come last so they win. `test.compose.yml` is used on its own (`docker compose -f infra/compose/test.compose.yml up -d`, PostgreSQL on 5433).

### Where the files land

| Package | App (generated) | App-owned, created once |
|---|---|---|
| `compose/*.compose.yml` | `infra/compose/*.compose.yml` | `infra/compose/app.example.compose.yml` |
| `compose/postgres-init/10-application-role.sh` (executable) | `infra/compose/postgres-init/10-application-role.sh`, mode `0755` | |
| `nginx/nginx.conf`, `csp.conf`, `csp.dev.conf`, `platform/*` | `infra/nginx/…` | `infra/nginx/app.d/` (`permissions-policy.conf`, `http/`, `server/`, `locations/`) |
| `env/base.env.example` + the app's `app.env.example` | `infra/compose/.env.example` | `infra/compose/app.env.example` |
| `env/worker.env.example` | `infra/compose/.env.worker.example` | |
| `telemetry/**` | see the [telemetry slice](src/telemetry/README.md#infra) | `infra/otel/app-collector.yaml` |

Generated files start with a `# GENERATED from @marinoscar/platform-infra@<version> (<fragment>)` header and are never edited in the app. They are committed, because a VPS deploy runs Compose in a git checkout with no `node_modules`; Compose keeps resolving `context: ../..` and `../nginx/…` against `infra/compose`, as before.

### Executable scripts

A generated file marked `executable` in its fragment (`InfraFile.executable`; today `postgres-init/10-application-role.sh`) is a script a container runs by path, so the copy keeps what running it needs:

- **the shebang stays on line 1.** The two-line generated header goes after it, and the lock's checksum covers the body with its shebang and without the header. An executable package file without a `#!` line is refused before anything is written.
- **the mode is `0755`.** Sync writes the file with that mode and restores it when only the mode was lost (it then reports the file as written). The lock lists the file under its fragment's `executable` key, so the mode is part of what a reviewer sees in a lock diff.
- **`--check` fails on a lost executable bit**: a `chmod -x`, or a checkout of a commit that recorded the file as `100644`. It reads the owner's execute bit, the one git records. A lock whose `executable` list does not match the manifest fails as well.

Commit the mode with the file (`git add` records it; on a checkout without mode bits, such as Windows, `git update-index --chmod=+x <file>`). Windows has no executable bit, so there sync neither sets nor checks it. The package's own copy is `100755` too, and npm keeps the mode when it packs and installs, but sync does not rely on it: the manifest decides.

The `postgres-init/` directory is mounted whole, and sync removes nothing it does not generate, so an app adds its own first-start step as another script beside the platform's (`infra/compose/postgres-init/20-<name>.sh`, run in file-name order after `10-application-role.sh`). That file is the app's: sync never lists it in the lock nor checks it.

### Env fragments

`infra/compose/.env.example`, the one template the deploy wizard, `init` and Compose's `env_file` read, is `env/base.env.example` (the platform's variables, rendered) followed by the app's `infra/compose/app.env.example`. A new platform variable goes into `env/base.env.example`; an app's own into `app.env.example`, then `sync`. Never write a commented `# KEY=value` line in either: the wizard reads it as a declared variable (`packages/platform-cli/src/engine/deploy/env-spec.test.ts` checks every fragment). No environment variable exists for a runtime-configured feature (storage, AI, SMTP, Web Push).

`infraFile(relativePath)` (`@stability experimental`) returns the absolute path of a shipped file and throws on an empty, absolute or escaping path.

## Observability

None. The package emits nothing at run time; the telemetry slice ships the collector configuration itself (see its README). `platform-infra sync` prints only the files it wrote.

## Security notes

- **Header inheritance.** nginx's `add_header` replaces, never merges: a location that declares one header of its own drops every server-level one, CSP and HSTS included, with no error. The security set therefore lives in one file, `platform/security-headers.conf`, included at server level and by `platform/sse-proxy.conf`, so an app's SSE location keeps every header even when it adds one (`Cache-Control` in the EvoPath fixture). An app location that adds a header without the snippet must `include /etc/nginx/platform/security-headers.conf;`; `nginx-app-locations.spec.ts` fails otherwise.
- **The stack agent holds the Docker socket** (root-equivalent on the host). It is confined to `apps/stack-agent`: no parameters, no published port, token-gated, read-only, all capabilities dropped (see `vps.compose.yml`). An app that does not want it switches it off with an overlay (`profiles: ["disabled"]`), never by editing `vps.compose.yml`.
- `infraFile()` and `sync` refuse absolute paths and any path that leaves the package or the app root; `sync` validates its whole plan before writing, never overwrites an app-owned file, and refuses an identity value that could break the file it is rendered into (whitespace, `$`, quotes).
- The internal `stub_status` listener (port 8081) is published by no compose file; an app file must not serve it either (`nginx-app-locations.spec.ts`).

## Conformance suite

None yet. The package ships no conformance suite; its invariants run as this package's tests (`docker compose config` snapshots, `nginx -t` and served headers) and as CI's `sync --check` and pinned-image `nginx -t`.

## Upgrade notes

From the files an app copied by hand (before #714): run `npx platform-infra sync`, then move every difference from the generated files into an overlay: extra compose settings into `infra/compose/app.*.compose.yml`, nginx locations into `infra/nginx/app.d/locations/` (SSE routes through `platform/sse-proxy.conf`), the `Permissions-Policy` into `infra/nginx/app.d/permissions-policy.conf`, app variables into `infra/compose/app.env.example`. After a rename (`scripts/rename.mjs`), run the sync again: it re-renders the identity and rewrites the lock.

## Troubleshooting

- **`sync --check`: `differs from @marinoscar/platform-infra@…`.** A generated file was edited. Run `npm run platform:infra:sync`, then make the change in the overlay the message names.
- **`is not executable`.** A generated script lost its mode bit (a `chmod -x`, an editor that rewrote it, or a commit that recorded `100644`). Run `npm run platform:infra:sync`, then commit the mode change; on Windows use `git update-index --chmod=+x <file>`. Why it matters: the postgres image runs an executable `.sh` in `/docker-entrypoint-initdb.d` but *sources* one that is not, so the script's `set -eu` and `exit` act on the image's entrypoint itself. If a volume was initialised that way, check the Doctor's `db.rls_role` and recreate the volume if the role is wrong.
- **`records a different checksum`.** The lock was edited or not rewritten (for example after `scripts/rename.mjs` changed a rendered value): run the sync.
- **`is rendered with the app identity, and none was found`.** Add `packages/shared/identity.json` with `productName` and `cliName`, or pass `--identity <file>`.
- **nginx: `open() "/etc/nginx/app.d/permissions-policy.conf" failed`.** The app-owned file is missing; the sync recreates it from the platform default.
- **A changed `app.d/` file is not served.** The directory mount shows the new file at once, but nginx reads its configuration at start: recreate or reload nginx (`docker compose … up -d --force-recreate nginx`).

Collector overlay failures are in the [telemetry slice README](src/telemetry/README.md#troubleshooting). Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [VPS deploy spec](../../docs/specs/vps-deploy.md) and [runbook](../../docs/runbooks/deploy-to-vps.md): where the deploy's fragments come from and how an app adds an overlay
- [Worker nodes runbook](../../docs/runbooks/run-worker-nodes.md): the rendered worker variables
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
