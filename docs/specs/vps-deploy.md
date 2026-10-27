# VPS Deployment (`appctl deploy`)

> **Status:** shipped · **Code:** `packages/platform-cli/src/engine/deploy/`, `packages/platform-cli/src/engine/commands/deploy.ts`, `packages/platform-cli/src/engine/tui/screens/deploy.tsx`, `infra/compose/vps.compose.yml`, `apps/api/src/about/`, `apps/web/src/pages/Admin/AboutPage.tsx` · **API:** `GET /api/admin/about` (see `/api/docs`) · **Admin UI:** `/admin/settings/about` · **Runbooks:** [deploy-to-vps.md](../runbooks/deploy-to-vps.md), [deployment-info.md](../runbooks/deployment-info.md) · **Command reference:** [apps/cli/README.md](../../apps/cli/README.md#deploying-to-a-server)

`appctl deploy` installs, updates, inspects and removes this application on a
Linux server with Docker. The operator runs it on the server itself. It clones
the fork, writes `.env` through a wizard generated from `.env.example`, builds
images, migrates and seeds an external PostgreSQL database, starts the stack
on a loopback port, and publishes it through a shared host reverse proxy that
terminates TLS. It leaves a state file and a deployment document behind, which
the admin About page reads.

## 1. Purpose

- **What it is.** The only deployment tool in this repository. There is no
  separate deploy script or Ansible playbook, and there should not be one.
  A fork deploys itself: nothing about the repository URL or product name is
  hard-coded.
- **What it is not.**
  - Not a remote orchestrator: the CLI contains no SSH client.
  - Not a registry-based deploy: images are built on the server; nothing pulls
    from GHCR.
  - Not a database host: PostgreSQL is always external.
  - No automatic rollback of a failed `update`.
- **Problem it solves.** A team that forks the template gets a repeatable,
  resumable, idempotent path from "a VPS with Docker" to "served over HTTPS at
  a real domain", with several applications able to share one server.

## 2. How it works

### Design decisions in force

| Decision | Meaning | Rules out |
|---|---|---|
| Runs on the VPS | The operator SSHes in with their own credentials and runs `appctl` there | An SSH library in the CLI, laptop-driven orchestration, managing SSH keys |
| Git + build | `git clone`/`fetch` and `docker compose build` on the server, every time | Pulling pre-built images |
| TLS by a shared host proxy | One nginx + certbot stack at `/opt/infra/proxy`, outside this repository, serves every app on the box. The app binds `127.0.0.1` only | Per-app port 443, per-app certbot timers |
| External PostgreSQL | `POSTGRES_*` point at a server the operator provides. There is no `db` service in any production compose file | The CLI managing database volumes, backups or upgrades |
| A state document written by the CLI | The CLI records what it deployed (`.appctl-deploy.json`) and publishes `deploy-info/info.json`, which the API reads through a read-only bind mount | A second deployment registry, the API guessing its own provenance |

### Commands

| Subcommand | Does |
|---|---|
| `doctor` | Runs the prerequisite checks; exits `6` (`PRECONDITION`) on any required failure |
| `install` | Full pipeline on a new deployment directory |
| `update` | Brings an existing deployment to the latest revision of its ref |
| `status` | Containers, local and external health, migrations, certificate |
| `list` | Every deployment under the apps root |
| `about` | Prints `deploy-info/info.json` from disk (never asks the API) |
| `certs` | Inspects or renews the certificate (`--renew`, `--force`, `--staging`) |
| `uninstall` | Removes a deployment, after a read-only inventory (`--dry-run` shows it) |

Flags per subcommand are in [apps/cli/README.md](../../apps/cli/README.md#deploying-to-a-server).
Every subcommand keeps the CLI's two rules: human output on stderr, `--json`
on stdout only, and failure is a non-zero exit.

### Layout on the server

```
/opt/infra/proxy/                 # shared proxy (not in this repo)
  docker-compose.yml, conf.d/<domain>.conf, webroot/, letsencrypt/
/opt/infra/apps/<app-name>/       # one deployment (DEFAULT_APPS_ROOT)
  repo/                           # the CLI's own clone of the fork
    infra/compose/.env            # written here today (legacy location)
  .env                            # preferred by readers when present
  .appctl-deploy.json             # deploy state (0600, atomic write)
  deploy-info/info.json           # the document the API reads
  logs/<run>.log, <run>.jsonl     # run journal
```

`.env` is written at `repo/infra/compose/.env`. `resolveEnvPath` already
prefers `<root>/.env` when it exists, in anticipation of moving it out of the
checkout.

### Locating a deployment

`layout.ts`'s `locateApp` resolves which deployment a command acts on, in five
ranks:

1. an explicit `--root`;
2. an explicit `--name` (under `--apps-root`, default `/opt/infra/apps`);
3. the deployment the current directory is inside (bounded by the apps root);
4. the sole installed deployment;
5. otherwise **refuse, naming every candidate**. It never picks one.

`DEPLOY_ROOT` is written into `.env` by the CLI and is deliberately absent from
`.env.example`. It marks a deployment this CLI wrote, so enumeration can skip a
foreign application sharing the apps root. Two forks of this template on one
host are still ambiguous; rank 3 is what resolves that in practice.

### Deployment evidence and adoption

A deployment **is** a git checkout at `<root>/repo` **and** a readable `.env`
(`deployment-evidence.ts`, `isDeployment`). The state file is not required.
`layout.ts` and `update.ts` share that predicate. When the state file is
missing, `update` **adopts** the deployment (`adopt.ts`): it rebuilds a record
from the checkout's origin and ref and the `.env`'s `APP_BIND_PORT`, sets
`adoptedAt`, and invents nothing else.

### Install pipeline

Each step is idempotent. A failed run records `completedSteps` and
`lastFailedStep`; `--resume` continues from the failed step. `install` refuses
a directory that already holds a deployment unless `--reinstall` or `--resume`
is passed.

| Step | Does |
|---|---|
| `preflight` | Required doctor checks (skippable with `--skip-doctor`) |
| `checkout` | Clone or fetch the repo at `--ref`. For a private GitHub HTTPS URL with `gh` logged in, runs `gh auth setup-git` first |
| `environment` | The env wizard, or answers from `--answer`/`--answers-file`; a free host port for every published-port variable nobody set (see Free ports for the variables the CLI writes) |
| `validate-environment` | Formats, database reachability and credentials, OAuth probe |
| `stack-ports` | `stack-ports-free` against the final checkout and `.env`, before anything is built or started; not skippable (see Every host port the stack publishes) |
| `ensure-database` | Create the database if it is the only thing missing (see below) |
| `version` | Choose, write and commit the release version (see below) |
| `build` | `docker compose -f base -f prod -f vps build` (`--no-cache` available) |
| `migrate` | `docker compose run --rm --no-deps api npm run prisma:migrate` |
| `seed` | `… npm run prisma:seed` (idempotent upserts; `--skip-seed` to skip) |
| `start` | `up -d` |
| `health` | Poll `http://127.0.0.1:<port>/api/health/ready` |
| `deploy-info` | Write `deploy-info/info.json` (first write, at the health gate) |
| `proxy-bootstrap` | Create the shared proxy if absent (asks, or `--bootstrap-proxy`) |
| `publish` | Render the vhost, issue the certificate, validate, reload (`--skip-proxy` to skip) |
| `renewal` | Schedule renewal unless something already owns it (`--skip-renewal`) |
| `verify` | Containers, local ready and frontend, pending migrations (`prisma migrate status`), external HTTPS, OAuth smoke |
| `publish-version` | Push the version commit (last; a failed push is a warning) |

`/api/health/ready` passes against an empty, unmigrated database. Only the
`migrate` step's exit code and `verify`'s migration status prove migrations
ran.

### Update pipeline

`preflight`, `fetch`, `environment-drift`, `stack-ports` (the same check, with the
new revision's files and the healed `.env`, before `database-role` and every other
step that can touch a container), `ensure-database`, `version`,
`build`, `migrate`, `seed`, `restart`, `edge-config`, `health`, `deploy-info`,
`publish`, `renewal`, `verify`, `publish-version`.

- `fetch` compares the ref's SHA with the recorded `commitSha`. Unchanged and
  no `--force`: report "up to date" and do nothing, except `edge-config`.
- `edge-config` runs on every update, changed or not: it compares the
  `sha256sum` of `nginx.conf` and `csp.conf` inside the running nginx with the
  checkout's and recreates only nginx on a mismatch (single-file bind mounts
  pin the old inode after `git` replaces the file). `restart` recreates nginx
  rather than restarting it for the same reason.
- `environment-drift` finds `.env.example` keys missing from `.env`. It prompts
  for just those keys, or fails under `--non-interactive`.
- The seed re-runs by default, so new permissions and roles reach existing
  installs.
- There is no automatic rollback. The previous SHA is recorded
  (`previousSha`) for a manual `git checkout` and re-run.

### Environment wizard

- **`env-spec.ts`** parses `infra/compose/.env.example` at run time: banners
  become sections, comments above a key become its help, an active `KEY=value`
  is a required-shape entry, a commented `# KEY=value` is optional, and
  trailing inline comments are stripped from values.
- **`env-metadata.ts`** plus the registered env-spec fragments are the only
  hard-coded lists (the telemetry keys are `telemetryEnvSpecFragment` in
  `@marinoscar/platform-cli/telemetry`, #706; `metadataFor` reads both, and a
  key has one owner): `secret` (masked input,
  redacted in logs), `generate` (`randomBytes(32)` in-process for
  `JWT_SECRET`, `COOKIE_SECRET`, `SECRETS_ENCRYPTION_KEY`), validators (32-char
  minimum; `SECRETS_ENCRYPTION_KEY` must decode to 32 bytes), `derivedFrom`
  (`APP_URL` and `GOOGLE_CALLBACK_URL` from the one domain question),
  `essential` (prompted by default), and optional `group`s such as
  `observability` and `email`, opted into with `--group`.
- `--all` reviews every key. A key a fork adds to `.env.example` with no
  metadata entry is still prompted as plain text.
- `.env` is written with mode `0600` via a temp file and rename.

### Doctor checks

Registered in `packages/platform-cli/src/engine/deploy/checks/`, one module per area, shared by
`doctor` and the pipelines' `preflight`:

| Area | Check ids |
|---|---|
| Host | `docker-installed`, `docker-daemon`, `docker-compose-v2`, `git-installed`, `node-version`, `disk-space`, `memory`, `bind-port-free` |
| Compose project | `bind-port-owner` (required; also in the `update` preflight), `stray-compose-stack` (recommended, `doctor` only) |
| Stack ports | `stack-ports-free` (required; also in the `update` preflight, and asked again by the `stack-ports` step of both pipelines) |
| Source | `gh-installed`, `gh-authenticated` |
| Database | `database-reachable`, `database-credentials`, `database-exists`, `database-role-ordinary`, `database-privileges`, `database-ssl`, `database-create-privilege` |
| DNS | `dns-resolves`, `dns-points-here` |
| Proxy and TLS | `proxy-root`, `proxy-conf-writable`, `acme-webroot`, `certbot-installed`, `proxy-container`, `proxy-config-valid`, `certificate-present`, `certificate-validity`, `certificate-renewal`, `certificate-renewal-paths`, `certificate-served` |

`bind-port-free` and app checks recognise the deployment's own containers by
`CheckContext.composeProject` (`DeployCheckContext.composeProject` for
`registerDeployCheck`), the deployment's compose project: the recorded one, or, for a
deployment installed before the project was recorded, the one Docker reports
(see Compose project name), `compose` only when Docker cannot say. Use it, not
`basename(deployRoot)`, and fall back to the folder name only when it is
absent (optional on `DeployCheckContext`; absent before any state exists).

`certbot-installed` is required only when the proxy runs on the host. DNS and
TLS checks run when `--domain` is given.

### Shared proxy and TLS

- **`ProxyRuntime`** (`proxy.ts`) makes the proxy's shape explicit:
  `mode: 'container' | 'host'`, the container name (default `proxy-nginx`),
  and the certificate and webroot paths **as nginx sees them**
  (`/etc/letsencrypt`, `/var/www/certbot` in container mode). Resolution order:
  `--proxy-mode`/`--proxy-container`; the deployment's recorded values;
  `docker inspect` finding the container; a host `nginx -v`; otherwise
  container mode.
- **Publishing** renders `conf.d/<domain>.conf` (HTTP-01 challenge location,
  redirect to HTTPS, `proxy_pass http://127.0.0.1:<APP_BIND_PORT>`, and
  `X-Forwarded-Proto` set at this outermost hop, and the unbuffered streaming
  locations: the platform's three SSE paths plus the app's declared
  `streamPaths`, [runbook §6.3](../runbooks/deploy-to-vps.md#63-stream-an-app-route-through-the-host-proxy)),
  issues the certificate with
  certbot's **webroot** method (the dockerised `certbot/certbot:latest` in
  container mode), runs `nginx -t` (inside the container in container mode),
  and reloads only if validation passed. Any failure restores the previous
  vhost, so one app cannot take down its neighbours. Vhosts carry a
  `# Managed by appctl deploy` sentinel; uninstall never removes one without it.
- **Renewal ownership** (`renewal.ts`, `detectRenewalOwner`): a central script,
  then a systemd `certbot.timer`, then another direct cron line, then this
  CLI's own `/etc/cron.d/<cli>-certbot-renew`, then none. Only `none` makes the
  CLI install its twice-daily entry (`17 3,15 * * *`), which renews **and
  reloads** the proxy. In container mode, a host mechanism that does not touch
  the proxy's `letsencrypt/` mount is reported but not counted as the owner.
- `certs --renew` renews within 30 days of expiry (`RENEW_WITHIN_DAYS`).
- **Bootstrapped proxy main config** (`proxy-bootstrap.ts`,
  `renderProxyMainConfig`, #684). A proxy that `install` creates gets a
  managed `nginx/nginx.conf`, mounted read-only over the image's
  `/etc/nginx/nginx.conf`, and a `nofile` ulimit of 65536 in its
  `compose.yml`. It is the stock `nginx:alpine` file (user, log paths, `pid`,
  `mime.types`, the `conf.d/*.conf` include every vhost relies on) with
  `worker_rlimit_nofile 65536` and `worker_connections 16384`, the same
  limits as the application's own `infra/nginx/nginx.conf`. Why: the shared
  proxy is the first hop for every application's SSE streams on the host,
  each stream holds two connections for its lifetime, and the stock 1024
  saturates a worker at about 500 streams. The post-start `nginx -t` check
  validates it with everything else. Only new proxies get it; an existing
  proxy is never rewritten, and the runbook gives the manual steps
  ([deploy-to-vps.md §9.1](../runbooks/deploy-to-vps.md#91-connection-limits-for-streaming-sse)).

### Database creation

`ensureDatabase` (`database.ts`) creates the database only when the server is
reachable, the credentials work, and the only problem is that the database does
not exist (`3D000`). It asks first, or needs `--create-database` under
`--non-interactive`, because a typo in `POSTGRES_DB` looks exactly like a
missing database. It only ever issues `CREATE DATABASE "<name>"` on the
`postgres` maintenance database, with the name checked against
`^[A-Za-z_][A-Za-z0-9_$]*$` and the password passed via `PGPASSWORD`.

### The application database role

`ensureApplicationRole` (`app-role.ts`, #980) is the one implementation of
"detect, offer, provision, transfer", called by install's `environment` step
(between the wizard and the `.env` write) and by update's `database-role` step.
The required check `database-role-ordinary` (`rolsuper` / `rolbypassrls` of
`current_user`) gates `validate-environment`, the `ensure-database` re-verify and
`doctor`: row-level security is skipped for a superuser or a `BYPASSRLS` role, so
an API running as one isolates no organization from another.

- **The administrative login is used once and kept in memory.** It is the login
  the operator entered at the `POSTGRES_USER` prompt when that login is
  privileged, or `--admin-user` with its password from
  `<PREFIX>DB_ADMIN_PASSWORD` or the answers key `DB_ADMIN_PASSWORD` (never a
  flag). The answers keys `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD` and `APP_DB_USER`
  are removed from the answers before the environment is built, so none can
  reach `.env`; the journal's redactor learns the administrator's password
  before any line is written.
- **The role** is `LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB`, then `CREATEROLE`
  and `ALTER ROLE ... SET createrole_self_grant = 'inherit, set'`, as separate
  statements so a provider that refuses one is reported for what it is and
  accepted only with `--allow-reduced-role`. The name passes the same
  conservative grammar as a database name and is double-quoted.
- **The password** is `randomBytes(32)` base64url, generated, never prompted,
  and reaches the server as a SCRAM-SHA-256 verifier on `psql -f -`'s stdin
  (`runPsqlScript`; `runCommand` gained `input`), so it is in neither argv nor
  the server's statement log. A test pins the verifier against the RFC 7677
  example. `.env` (0600) is the only place the password is stored.
- **Idempotent, and never a takeover.** A role that exists and whose recorded
  credentials authenticate (against the application database) is reused
  untouched. A new password is set only for `--rotate-app-password` or an
  interactive yes that names the role: a role that exists and that nothing on
  record opens may be another deployment's (staging and production of one fork
  share `<repo>_app`), so it is refused, not reset. A check that could not be
  made (pg_hba, revoked CONNECT, timeout) is never read as a wrong password. An
  existing role that is itself a superuser is never altered or used.
- **The password is set last.** Role, attributes and ownership first; then the
  new login is written to `.env` (the caller's `CredentialStore`), then `ALTER
  ROLE ... PASSWORD`, then the role logs in once. A failure at the ALTER puts
  `.env` back; one after it keeps the password the server has, unless `.env`
  held another login, which is restored. The generated password and verifier
  reach the journal's redactor (`onSecrets`) before any statement carries them.
- **Ownership** of an existing database moves with `ALTER DATABASE`, `ALTER
  SCHEMA public` and a `DO` block of `ALTER ... OWNER TO` over tables, views,
  materialized views, foreign tables, unlinked sequences, enum types and
  functions (extension-owned objects skipped), in one transaction. There is no
  `REASSIGN OWNED BY`: it also moves objects in other databases and cluster
  objects. Consent (`--transfer-ownership` or a prompt, after a backup
  recommendation) is taken before anything is mutated.
- **update warns, install refuses.** Not consented is a refusal in install (it
  will not start an API as a superuser unasked) and a warning in update (an
  unattended update must not begin failing on a deployment that predates this);
  on an unchanged revision the step runs only when a role flag is passed.
  `--allow-superuser` is recorded in the state (`allowSuperuser` and the
  `allowSuperuserLogin` it applies to) so doctor reports the choice as a
  warning; doctor stays read-only, and the record is dropped by install/update
  once the login is an ordinary role and ignored for any other login.

### OAuth probe

`oauth-check.ts`, run in `validate-environment` and again in `verify`:

1. **Shape:** `GOOGLE_CLIENT_ID` matches
   `^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$`.
2. **Callback:** `GOOGLE_CALLBACK_URL` is exactly
   `https://<domain>/api/auth/google/callback`.
3. **Live probe:** a POST to `https://oauth2.googleapis.com/token` with a
   deliberately invalid code. `invalid_grant` is a **pass** (Google accepted the
   client before rejecting the code). `invalid_client`, `unauthorized_client`
   and `redirect_uri_mismatch` fail. Anything else (timeout, egress blocked) is
   a warning.

`--skip-oauth-check` skips the live probe and downgrades a malformed id to a
warning, for test deployments with dummy credentials.

### Deploy-time version bump

The `version` step asks for (or takes `--app-version`) the release version,
writes it into the manifests the app chose (`createCli({ deploy: {
versionedManifests } })`, default the four of `app-version.ts`'s
`VERSIONED_MANIFESTS`: `apps/api`, `apps/web`, `apps/cli`, `packages/shared`)
and the lockfile's workspace entries of those same paths, **textually**, and
commits in the same step. **The first listed manifest is the version source**:
the current version, and so the suggested bump and the forward-only check, are
read from it. A manifest the app left out is neither read nor written, and its
lockfile entry is byte for byte unchanged; an app whose CLI keeps its own
version (recorded as `appctlVersion` in the state, in the deploy-info and in
the User-Agent) leaves `apps/cli/package.json` out. The list is validated when
the CLI is built (non-empty, repository-relative `package.json` paths under a
directory, no `..`, no duplicates). The step's journal line names the files
written (`wrote 1.2.3 to apps/api/package.json, ... and committed`).
`publish-version` pushes it last, as
`git push origin HEAD:refs/heads/<ref>`, never with `--force` and never
retried. A failed push is a warning and the local commit is rolled back, so the
clone always ends at `origin/<ref>`. `--no-version-bump` deploys the current
version with no write, commit or push.

### Compose project name

Recorded at install (`composeProject`, the deployment directory's basename)
and passed as `-p` on every call; never re-derived. A deployment whose state
records none (or only the legacy `compose`) is confirmed against Docker before
`update`, `status` and `doctor` (and the TUI doctor): the engine reads
`com.docker.compose.project` off the containers whose
`com.docker.compose.project.working_dir` is inside the deploy root. A folder can
hold containers of two projects (the live stack and the leftovers of the legacy
`compose`), so the project is picked by the strongest evidence, in order: the
project whose container publishes the bind port (running containers first; a
stopped leftover is configured to publish it too), the only project with a
running container, the only project. The project found is recorded when the
state has none or the legacy `compose` (the previous state file is kept once as
`.appctl-deploy.json.bak`, `0600`). When nothing separates the projects the
record is kept and a warning names them and the state file. A recorded
non-legacy project is never overwritten, but a warning is printed when another
project holds the bind port. `install --resume` and `--reinstall` reconcile the
same way before their first compose or check call; `uninstall` and
`deploy about` do not, and a failed `install` records only a name it chose or
Docker named. Only when Docker cannot say does a state with no record fall back
to `compose`.

The required check `bind-port-owner` (`update` and `install` preflight, and
`doctor`) is the backstop: any container, in any state, that publishes the bind
port under a project other than the one the run passes to `-p` fails the run
before anything is built, naming both projects, the `composeProject` fix in the
state file and the command that removes the leftovers. A stopped leftover
inside the deploy root only warns when a running container of the run's own
project holds the port. `stray-compose-stack`
only warns, in `doctor`, about containers of another project started from the
deploy root. Neither removes anything. Renaming an existing project would
start a second stack on the same port.

#### Every host port the stack publishes

`bind-port-owner` covers the bind port only. The stack publishes others
(`vps.telemetry.compose.yml`: greptimedb on `127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}`,
a default every app on the host shares), and `up -d` recreates web, api and
nginx before it reaches the service whose port is taken: `Bind for
127.0.0.1:14003 failed: port is already allocated`, with the new nginx not
started. The required check `stack-ports-free` (`update` and `install`
preflight, and `doctor`) asks compose itself which ports the stack publishes,
`docker compose -p <project> -f ... config --format json` run in the checkout's
compose directory with the process environment, exactly the invocation `up -d`
gets (the rendered output carries every secret; it is parsed in memory and
never logged), then fails when, for any published port:

- a container of a compose project other than the run's, or no project, in any
  state, is configured to publish it on an overlapping address and protocol; a
  stopped one only warns while a running container of the run's own project
  holds the same port (Docker allocates a port only to a running container);
- a process outside Docker listens on it (a loopback bind probe, TCP on
  `127.0.0.1` or every interface, and only when no running container accounts
  for the listener).

Containers of the run's own project are fine; they are recreated. The failure
names the port, the service, the holder and the fix: `set <VAR>=<free port> in
<deployRoot>/repo/infra/compose/.env` where `<VAR>` is derived from the `ports:`
lists of the compose files (the entry that evaluates to the rendered port;
`!override` and `!reset` are honoured), or, when a literal fixes the port, the
overlay to change; for a leftover started from the deploy folder, the
`composeProject` fix and the removal command. The bind port's container
question stays with `bind-port-owner` (one message per port); the listener
probe covers it too. A stack that cannot be rendered fails with compose's error
(a missing required variable adds the key and the CLI-version hint); Docker
unreachable skips. Nothing is mutated.

The preflight sees the checkout and `.env` as they are before the run changes
them, and install's runs before there is a checkout, so a render failure there
(`CheckContext.environmentPending`) is deferred and both pipelines run the
`stack-ports` step with the final files: update after `environment-drift` and
before `database-role` (the first step that can recreate a container), install
after `validate-environment` and before `ensure-database`. The step runs the
same check, cannot be skipped by `--skip-doctor`, `--force` or `--resume` (a
resumed install drops it from the completed set), and stops the run before any
container is stopped, built or recreated.

The preflight sees the `.env` as it is before the run writes it, so one case is
deferred as well: while the environment is pending, a clash on a port whose
variable the existing `.env` does not set (it renders the compose default) is not
a verdict, because the environment step (install) or `environment-drift` (update)
gives such a key a free port (next section). The check passes with a note naming
the key, and the `stack-ports` step judges the final file. A key the `.env` has,
a `.env` that does not exist, `doctor` and the `stack-ports` step itself are not
deferred.

The stack agent's telemetry `compose up` (`apps/stack-agent`) is outside this
check.

#### Free ports for the variables the CLI writes

Every app gets `APP_BIND_PORT=3535` and `GREPTIME_BIND_PG_PORT=14003` from the
compose files, so a second app on a host used to be stopped by the check above
and the operator edited `.env` by hand. When the CLI is about to write a value
for a published-port variable it picks a free one (`free-ports.ts`):

- The variables are derived from the compose files in the checkout
  (`publishedPortVariables`: a `ports:` entry whose published side is exactly one
  `${VAR:-default}`, with `!override` and `!reset` honoured), restricted to keys
  the `.env.example` declares. An overlay that publishes a new port is covered
  without a list.
- **Free** means no container in any state is configured to publish the port on
  an overlapping address and protocol (the source `stack-ports-free` uses; the
  run's own project is ignored, its containers are recreated), nothing listens on
  it (the loopback bind probe of `bind-port-free`, TCP on `127.0.0.1` or every
  interface), and no other variable of the run has it. When Docker cannot be
  asked the search is probe-only.
- The search starts at the template default and walks upward, at most 200 ports
  and never above 65535, so a lone app keeps `3535` and `14003` and prints
  nothing extra. When none is free the run stops with an error naming the
  variable and the range.
- A pick that moved is printed and journaled with its holder:
  `GREPTIME_BIND_PG_PORT=14013 (14003 is held by evopath-greptimedb-1)`.

**An existing value is never moved.** A deployed app's port may be wired into an
SSH tunnel, a BI tool or a firewall rule, and a quiet change would break it. So:

| Run | Decides |
|---|---|
| `install`, fresh | Every published-port variable the answers do not give. |
| `install --reinstall` / `--resume` over an existing `.env` | Only the keys the `.env` lacks. A key it has keeps its value, and `stack-ports-free` reports a clash on it with the fix. |
| `update` (`environment-drift`) | Only the keys the drift step is adding (the telemetry ports on a deployment created before they existed). |

`APP_BIND_PORT` is decided before the preflight, because the bind port is read
by the preflight, the state, `deploy-info`, the vhost and the health probe. When
`--port` is passed it is kept, and a taken port still fails the preflight
(`bind-port-free`, `bind-port-owner`). Without `--port` (the command reads
commander's value source; the install TUI treats an untouched default for a new
deployment the same way) a fresh install walks up from `3535`, a deployment whose
`.env` already has `APP_BIND_PORT` keeps it, and the chosen number is the one
written to `.env`, recorded as `bindPort` in the state and `deploy-info` and
proxied by the vhost. With `--all` the environment wizard shows a picked value as
the default to accept or change.
### Run journal

Every run writes `<root>/logs/<run>.log` and `.jsonl` (argv, cwd, exit code,
duration, output) in a `0700` directory, keeping the newest 10 runs. Every
value marked `secret`, typed or generated, is replaced by a placeholder before
anything is written. Redaction is a literal match against known values, so a
fork's new secret needs a `secret: true` metadata entry.

### Deploy state

`<root>/.appctl-deploy.json`, never `~/.appctl/config.json` (which `appctl
login` rewrites whole). Version `2` (`DEPLOY_STATE_VERSION`). A v1 file is
upgraded in place (`history: []`, `host`/`proxy` absent); an unknown version is
refused with the remedy.

| Field group | Fields |
|---|---|
| Source | `repoUrl`, `ref`, `commitSha`, `previousSha` |
| Placement | `deployRoot`, `domain`, `bindPort`, `composeProject`, `groups` |
| Proxy | `proxyRoot`, `proxyMode`, `proxyContainer`, `proxy` (domain, port, mode, container, certificate expiry) |
| Timeline | `installedAt` (never overwritten), `lastDeployedAt`, `adoptedAt`, `lastCommand`, `appctlVersion` |
| Resume | `completedSteps`, `lastOutcome`, `lastFailedStep`, `lastAttemptAt` |
| Host | `host`: hostname, OS, kernel, arch, CPUs, memory, Docker and Compose versions (each `null` if a probe fails) |
| History | `history`: successful runs only, newest first, capped at 20 |

### Deployment info and the About page

The CLI publishes what it deployed; the running application reports it.

- **The document.** `<root>/deploy-info/info.json`, written by
  `deploy-info.ts` atomically (temp file, rename). It is written **at the
  health gate** (so a run that fails later still describes a running
  deployment) and rewritten at the end of a successful run with that run's
  history entry and certificate. `schema` is `1` and stays `1`: the reader
  validates `schema` strictly and every other field leniently, so new fields
  never need a bump. `null` means "known to be absent".
- **Fields:** `app` (name, version, commitSha, ref), `installedAt`,
  `updatedAt`, `deployedBy` (cli, version), `domain`, `remote`
  (commitsBehind, checkedAt; currently `null`), `run` (completed steps,
  failedStep, outcome), `lastCommand`, `bindPort`, `proxy` (mode, container,
  certificateExpiresAt), `host` (as in state), `history` (at, command,
  commitSha, previousCommitSha, ref, durationMs, cliVersion, outcome).
- **The mount.** `vps.compose.yml` mounts `${DEPLOY_ROOT}/deploy-info` at
  `/app/deploy-info` **read-only**, and sets `DEPLOY_INFO_PATH`. The directory
  is mounted, not the file, so an atomic rename is visible without a restart.
  Install creates the directory before `up`, or Docker would create it
  root-owned.
- **The API.** `apps/api/src/about/` serves `GET /api/admin/about`
  (`system_settings:read`, no permission of its own). It always answers `200`:
  `deployInfoStatus` is `ok`, `absent` or `invalid` (with `deployInfoPath` and
  `deployInfoError`), alongside the API's own `api.version`, a live `runtime`
  block (`processStartedAt`, `nodeVersion`, `environment`) and a database
  liveness check. `runtime` describes the process now; the document describes
  the server as last deployed. The two are never merged.
- **The UI.** The About card at `/admin/settings/about` (Operations group).
  `/admin/settings/deployment` redirects there; it is one destination, not two.
- **The CLI.** `appctl deploy about` reads the same file from disk, so it works
  while the app is down and needs no login.

What the page shows, and how to re-point the mount, is in
[deployment-info.md](../runbooks/deployment-info.md).

### Removing a deployment

`uninstall` builds a read-only inventory first (`planUninstall`), then removes
the stack (`down -v`), its vhost, and `repo/`, `logs/`, `deploy-info/`,
`.env` and the state file. It never touches shared
infrastructure: the Docker network, the proxy container, the TLS certificate,
or the renewal cron entry.

Destructive extras each need their own flag **and** the resource's real name
typed back:

- `--purge-storage --confirm-bucket <name>` runs
  `npm run storage:purge` inside the built `api` image before teardown, because
  only the running application can decrypt the runtime-configured storage
  credential. A purge that does not happen stops the uninstall. It deletes
  only objects under the registered storage key prefixes
  (`packages/platform-api/src/storage/storage-key-prefix.registry.ts`, platform and app).
- `--drop-database --confirm-database <name>`: after `down -v`, drops the
  database via `psql` in a throwaway `postgres:16-alpine` container
  (`--network host`, password by name, `PGSSLMODE=require` when
  `POSTGRES_SSL=true`, `PGCONNECT_TIMEOUT=5`), terminating only that
  database's own backends if it is busy. A failed drop stops the uninstall
  and keeps the checkout, `.env`, vhost and state so the same command can be
  re-run; the role must own the database, or be superuser. A database inside
  the compose stack itself (the `devdb` overlay, `POSTGRES_HOST=db`) cannot
  be dropped this way, since `down -v` removes its volume first.

### CLI and TUI seam

`install.ts`/`update.ts` never write to the terminal. They report through
`DeployHooks` (step start and result, log lines, progress).
`commands/deploy.ts` renders them to stderr; `tui/screens/deploy.tsx` renders
the same callbacks as React state, inside a bounded `ScrollBox`. Subprocesses
run through `executor.ts`: argv only, `shell: false`, a timeout, streamed and
ANSI-stripped output, and an `AbortSignal`.

### Exit codes

`0` OK, `1` failure, `2` usage, `3` API, `4` network, `5` auth, `6`
`PRECONDITION` (a required check failed before anything destructive ran).
Defined in `packages/platform-cli/src/engine/errors.ts`.

## 3. Configuration and permissions

### Environment variables

- `APP_BIND_PORT` — loopback port nginx publishes on (default `3535`); the
  proxy forwards to it. In `.env.example`.
- `DEPLOY_ROOT` — written by the CLI only; locates `deploy-info/` for the bind
  mount and marks a CLI-written `.env`. Never in `.env.example`.
- `DEPLOY_INFO_PATH` — where the API reads the document (default
  `/app/deploy-info/info.json`, set by `vps.compose.yml`).

Everything else comes from `infra/compose/.env.example`; see the wizard above.

### Compose overlay

`infra/compose/vps.compose.yml`, layered after `base` and `prod`:

- `nginx.ports: !override ["127.0.0.1:${APP_BIND_PORT:-3535}:80"]`. The
  `!override` tag replaces the inherited list; a plain `ports:` would merge and
  keep `0.0.0.0:3535`.
- The read-only `deploy-info` bind mount and `DEPLOY_INFO_PATH` on `api`.
- `json-file` log rotation (10 MB × 3) on `nginx`, `api` and `web`.

When the `observability` group is recorded for the deployment,
`composeFilesFor` (`packages/platform-cli/src/engine/deploy/compose-files.ts`) also layers
`telemetry.compose.yml` (before the VPS files, so it inherits their
hardening) and `vps.telemetry.compose.yml` last (so its `ports: !override`
is the final word): the OTel Collector publishes no host port at all, and
GreptimeDB's PostgreSQL wire port is published on
`127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}` only. See
[specs/telemetry.md](telemetry.md) and the
[telemetry runbook](../runbooks/telemetry.md).

### Where the fragments come from, and app overlays

Every platform file of the stack (the compose files, `infra/nginx/` and
`infra/compose/.env.example`) is generated from
[`@marinoscar/platform-infra`](../../packages/platform-infra/README.md) by
`npm run platform:infra:sync` and **committed**: the deploy clones the app and
runs Compose from `repo/infra/compose` with no `npm ci` first, so a file only
in `node_modules/` would not exist there. The sync renders the app identity
(CLI name, env prefix, service name) into the files and records the version,
the identity and a sha256 per file in `infra/platform-infra.lock.json`; CI's
`npm run platform:infra:sync -- --check` fails on a hand edit or a stale lock.
Relative paths (`context: ../..`, `../nginx/...`) keep resolving against
`infra/compose`, exactly as before.

The full file list, from `composeFilesFor()` (which takes the order from the
package's `composeFilesForMode('vps')`):

```text
base, prod, telemetry, vps, vps.telemetry, then app overlays sorted by name
```

An app never edits a platform file. It adds `infra/compose/app.<name>.compose.yml`
(every mode built on `base`) or `app.<scope>.<name>.compose.yml` (`prod`: prod
and VPS; `vps`: VPS only), which the deploy finds in the checkout and applies
after every platform file, so it wins: other memory limits
(`deploy.resources.limits.memory`), an extra service, or the stack agent
switched off (`stack-agent: { profiles: ["disabled"] }`). A file ending in
`.example.compose.yml` is never applied. nginx routes go in
`infra/nginx/app.d/locations/` (an SSE route is one
`include /etc/nginx/platform/sse-proxy.conf;`), the `Permissions-Policy` in
`infra/nginx/app.d/permissions-policy.conf`. A changed `app.d/` file needs
nginx recreated (`up -d --force-recreate nginx`): the update's edge-config
check compares `nginx.conf` and `csp.conf` only.

### Permissions and API

| Method + route | Purpose | Permission |
|---|---|---|
| `GET /api/admin/about` | API version, deployment document, runtime, database liveness | `system_settings:read` |

## 4. Extending it in a fork

- **New environment variables.** Add an app variable to
  `infra/compose/app.env.example` (a platform one to
  `packages/platform-infra/env/base.env.example`) and run
  `npm run platform:infra:sync`, which writes `infra/compose/.env.example`; the
  wizard picks them up. Add an `env-metadata.ts` entry for anything secret
  (`secret: true`), generated, derived, essential or grouped, or register an
  env-spec fragment for a set of keys that belongs together
  (`registerEnvSpecFragment` in `apps/cli/src/app.ts`; see
  [the CLI README](../../apps/cli/README.md#extending-the-cli-from-an-app)). Never add a
  commented `# KEY=value` example line that is not a real optional key: the
  parser treats it as a declaration.
- **A different stack.** Add an `infra/compose/app.*.compose.yml` overlay
  (above); never edit a generated compose or nginx file.
- **A new doctor check.** Add it to the matching module in `checks/` and to
  its registry export; `doctor` and `preflight` both read it.
- **A new pipeline step.** Add it to `install.ts` and/or `update.ts`. Make it
  idempotent, since `--resume` re-enters after the last completed step.
- **A new About field.** Add it to the document builder in
  `packages/platform-cli/src/engine/deploy/deploy-info.ts` and to the reader
  (`apps/api/src/about/deploy-info.ts`) and DTO. Do not bump `schema`.
- **Different hosting.** Not a CLI flag. A registry-based deploy
  (`deploy.yml` already builds images) would be a new mode that skips `build`.

## 5. Guardrails

| Guardrail | Enforces |
|---|---|
| `.github/workflows/deploy-e2e.yml` | Real Docker, a real PostgreSQL service, a fake VPS layout: unattended `install`, the version bump rolled back (not left ahead of origin), the document reaching the running container, `update` twice with nothing moved and no image rebuilt, journal redaction, `status` healthy. Runs on changes to `apps/cli/**`, `infra/compose/**` or the Dockerfiles, and nightly |
| `.github/workflows/deploy.yml` | Not this CLI: tag-triggered build and push of the `api`, `web`, `worker` and `stack-agent` images to GHCR, through the reusable `images.yml` (signed, with an SBOM; [runbook](../runbooks/container-images.md)). Its staging/production deploy jobs are `echo` stubs. Kept separate from `deploy-e2e.yml` on purpose |
| `packages/platform-cli/src/engine/deploy/testing/fake-vps.test.ts` | Pipelines against a simulated server |
| `packages/platform-cli/src/engine/deploy/install.test.ts`, `install-hardening.test.ts`, `update.test.ts`, `update-publish.test.ts`, `version-step.test.ts` | Step order, resume, adoption, version push rules |
| `packages/platform-cli/src/engine/deploy/layout.test.ts`, `deployment-evidence.test.ts`, `adopt.test.ts`, `compose-project.test.ts` | Five ranks, the evidence predicate, adoption, recorded project names |
| `packages/platform-cli/src/engine/deploy/proxy.test.ts`, `proxy-certs.test.ts`, `proxy-bootstrap.test.ts`, `renewal.test.ts`, `checks/tls.test.ts` | Container vs host paths, validate-then-reload, rollback, renewal ownership, the bootstrapped proxy's main config and ulimit |
| `apps/api/test/nginx-connection-limits.spec.ts` | The application nginx's `worker_connections`, `worker_rlimit_nofile` and the `nofile` ulimits on `nginx` and `api` move together |
| `packages/platform-cli/src/engine/deploy/env-spec.test.ts`, `env-wizard.test.ts`, `journal.test.ts`, `journal-hook.test.ts` | `.env.example` parsing, wizard behaviour, redaction |
| `packages/platform-cli/src/engine/deploy/database.test.ts`, `oauth-check.test.ts`, `uninstall.test.ts`, `state.test.ts`, `deploy-info.test.ts` | Database creation rules, OAuth classification, uninstall confirmations, state upgrade, document shape |
| `apps/api/src/about/deploy-info.spec.ts`, `apps/api/test/about/deploy-info-contract.spec.ts`, `apps/api/test/about/about.integration.spec.ts` | Lenient reader, CLI/API contract, the endpoint and its permission |
| `apps/web/src/__tests__/pages/Admin/AboutPage.test.tsx`, `apps/web/src/__tests__/hooks/useAbout.test.ts` | The About page's states |

## 6. Design decisions

- **Run on the server, no SSH client.** Reuses the operator's authenticated
  session; no key handling, and laptop network flakiness cannot break a deploy.
- **Build on the server, not pull from GHCR.** No registry credentials on the
  server and no compose file using `image:`. A `--from-registry` mode is the
  natural later addition.
- **Shared host proxy, not per-app TLS.** A second app on the box is normal;
  only one process can own port 443 and one renewal schedule.
- **External PostgreSQL.** Keeps the CLI's blast radius to the stateless tier.
- **Wizard generated from `.env.example`.** A hard-coded list goes stale the
  day a fork edits the file. An essential subset plus `--all` keeps the common
  path short.
- **State in its own file.** `~/.appctl/config.json` is rewritten whole by
  `appctl login`.
- **Evidence, not bookkeeping.** A lost state file must not make a live
  deployment "uninstalled". Adoption invents nothing (no `installedAt` from
  `mtime`).
- **Ambiguity refuses.** No tiebreak at rank 5; the marker cannot tell "ours,
  older" from "not ours".
- **Recorded compose project name.** Re-deriving would start a parallel stack.
- **Typed resource names for destructive extras**, never a shared word like
  `DELETE`: dropping a database is not consent to empty a bucket.
- **Storage purge inside the api image.** The CLI cannot import `apps/api`
  (`rootDir: ./src`) and cannot decrypt the credential.
- **Prompt before `CREATE DATABASE`.** A typo would otherwise migrate into a
  new empty database.
- **`invalid_grant` is a pass.** Google validates the client before the code.
- **Act on the existing renewal owner.** A second renewer races and spends a
  shared Let's Encrypt budget.
- **Extend the About page, not a new Deployment page.** One destination
  gaining content (Settings UI rule 2); no new permission.
- **`schema` stays `1`.** A bump would make every running API report `invalid`
  the moment a newer CLI writes the file.
- **Version at deploy time.** Accepted costs: the running commit is not the one
  CI built (bounded to version fields), and the server can push. Push last,
  never force, never retry.
- **No automatic rollback.** Reverting a migration needs a human.
- **Proxy connection limits at creation only.** A bootstrapped proxy ships
  raised limits; an existing one is left alone, because it serves other
  applications and a rewrite plus recreate would drop their connections. The
  runbook documents the manual change for container and host mode.

## 7. Verification

On a disposable VPS with Docker, DNS pointing at it, and an external
PostgreSQL:

1. Build the CLI in a checkout of your fork (`npm run build --workspace=cli`,
   see [apps/cli/README.md](../../apps/cli/README.md)), then:
   ```bash
   appctl deploy doctor --domain app.example.com
   ```
   Expect every required check to pass, or exit `6` with a remedy.
2. Install with Let's Encrypt staging first:
   ```bash
   appctl deploy install --domain app.example.com --staging
   ```
   Watch each step report; `verify` should show containers up, ready, frontend
   up, no pending migrations, external HTTPS.
3. Check the binding: `docker compose -f base.compose.yml -f prod.compose.yml
   -f vps.compose.yml config` (in `repo/infra/compose`) shows one `nginx` port
   with `host_ip: 127.0.0.1`.
4. `appctl deploy status` and `appctl deploy about` agree with the About page
   at `/admin/settings/about` (`deployInfoStatus: "ok"`).
5. `appctl deploy update`: with no new commits it reports "up to date" and
   rebuilds nothing.
6. `grep` a known secret value in `<root>/logs/*.log`: no match.
7. `appctl deploy uninstall --dry-run` lists what would go and what is kept.
8. Tests: `npm test --workspace=cli -- --run`; the `Deploy E2E` workflow for
   the full pipeline against real Docker.

The operator procedure, prerequisites and troubleshooting are in
[deploy-to-vps.md](../runbooks/deploy-to-vps.md).

## History

- Epic #168: the `appctl deploy` command family, `vps.compose.yml`, the TUI
  screen, and the infra fixes it needed (`env_file` on `api`, loopback bind,
  password URL-encoding in the database URL builder).
- Epic #397 (#398–#405): multi-app layout and five-rank resolution, evidence
  and adoption, `uninstall`, recorded compose project names, deploy-info and
  the About page (#401), deploy-time versioning (#405); #407 added the Deploy
  E2E workflow.
- Epic #388 (#389–#393): `ProxyRuntime` container/host split (#389); renewal
  ownership, the database-creation prompt, the OAuth probe and new doctor
  checks (#390–#392); deploy state v2 carried by the About page (#392).
- #522: `--drop-database` drops the database after the stack stops.
