# Runbook: Run Worker Nodes

Use this to run machines that execute the application's background jobs
remotely: one machine by hand, or a fleet in containers. Audience: operators
with an account holding `nodes:read` and `nodes:write`. The design and its
rejected alternatives are [`docs/specs/worker-nodes.md`](../specs/worker-nodes.md);
every `appctl node` flag is in
[`apps/cli/README.md`, "Running a worker node"](../../apps/cli/README.md#running-a-worker-node).

Source of truth for every claim below:

- `packages/platform-cli/src/engine/commands/node.ts` — the `appctl node` subcommands and flags.
- `docs/platform-adoption/worker-node-harvest.md` — the fork-versus-platform comparison behind sections 9 to 11.
- `packages/platform-cli/src/engine/node/` — the engine, `capabilities.ts` (the startup self-test),
  `install-deps.ts`, `worker-env.ts` (every `APPCTL_*` variable).
- `packages/platform-cli/src/engine/tui/screens/node.tsx` — the interactive dashboard.
- `infra/compose/worker.compose.yml`, `worker.build.compose.yml`,
  `.env.worker.example` — the container fleet.
- `apps/api/src/nodes/` — registration, claim, lease and the per-job secret
  broker the server side runs.

---

## 1. Before you start

A worker node is a machine running `appctl node start` that claims jobs from the application's
queue, runs them locally, and submits results. The **same handler code** runs
on the API server or on a node — a node is an option, never a requirement, and
a deployment with no nodes at all still executes every job type it enqueues.

Nodes coordinate through nothing but the database. Two workers never receive
the same job because the claim is a `FOR UPDATE SKIP LOCKED` on one table, so
you scale by starting more of them and configuring none of them to know about
the others.

### 1.1 Prerequisites

| Requirement | Why |
|---|---|
| Node.js 20+ | The CLI's runtime floor |
| Outbound HTTPS to the application | The only network access a node needs — no inbound ports, ever |
| An account with `nodes:read` and `nodes:write` | To enroll and register |

A worker needs **no persisted** database access, no VPN, and no inbound
firewall rule. It downloads and uploads job data through short-lived presigned
URLs the server issues, so it never holds storage credentials at all, ever.
The one exception on the database side is `db.backup.run` (below): if your
fleet is going to take database backups, the node needs a **network route**
to PostgreSQL, and the credential it uses to connect is brokered per job, held
in memory only, and never written to disk (section 5.1).

## 2. Which procedure you want

- **One or two machines you log into**: section 3.
- **More than one or two workers**: containers, section 4.

Both then use sections 5 to 8 (capabilities, dependencies, memory, daily
operation).

## 3. Run a worker on one machine

```bash
# 1. Enroll — device login, then mint a node credential for this machine.
appctl node enroll

# 2. Register — create (or re-attach to) this machine's row in the fleet.
appctl node register --concurrency 4

# 3. Check everything before committing to it.
appctl node doctor

# 4. Run it.
appctl node start --daemon
```

Step 3 is worth not skipping. `doctor` reports three independent things an
operator routinely conflates, and a failure in one never masks the others:

- **This machine** — runtime, capabilities for the advertised job types, and
  whether the state directory is writable.
- **The server** — reachable, credential accepted, permissions present. It
  distinguishes *cannot reach the server* from *reached it and was refused*,
  which look identical in a stack trace and have entirely different fixes.
- **The worker** — whether a daemon is actually running here.

### 3.1 Survive a reboot

```bash
appctl node service install
loginctl enable-linger $USER      # ← do not skip this
```

This writes a systemd **user** unit — no root needed, and a worker has no
reason to run as root. Two details in the generated unit matter:

**`Restart=on-failure` is not decoration.** The memory watchdog exits
*deliberately* when the heap crosses its threshold, after draining cleanly and
writing a snapshot. Without a supervisor that successful drain leaves the
worker down — a self-healing mechanism turned into an outage.

**`loginctl enable-linger` is the step people miss.** Without it a user unit
stops when your last session ends, so a worker on a box you SSH into dies when
you log out. That reads as a crash and is actually policy.

`service install` on Windows or macOS, or on a Linux box with no per-user
systemd, prints guidance rather than a stack trace — including how to enable
systemd on WSL 2.

## 4. Run a fleet in containers

Containers are the recommended shape for more than one or two workers.

```bash
cd infra/compose
cp .env.worker.example .env.worker      # server URL + node credential
docker compose --env-file .env.worker -f worker.compose.yml up -d --scale worker=4
```

That is the whole configuration. Only `APPCTL_SERVER_URL` and `APPCTL_TOKEN`
are required: with no config file the worker builds its settings from the
environment and starts. Each replica registers as its own node, named after
its container hostname (which Docker makes unique), and the replicas
load-balance through the server's `FOR UPDATE SKIP LOCKED` claim, so two
replicas never receive the same job. Every variable either file may set is in
the generated table in
[`apps/cli/README.md`, "Worker environment variables"](../../apps/cli/README.md#worker-environment-variables).

> **Leave `APPCTL_NODE_NAME` and `APPCTL_NODE_ID` empty when scaling.** Setting
> either makes every replica reattach to the same node row, and the server's
> per-node claim cap is then shared between processes that each believe they
> own it.

| Setting | Why it is there |
|---|---|
| `restart: unless-stopped` | The memory valve exits deliberately; without this a clean drain leaves the worker down |
| `stop_grace_period: 300s` | Long enough for a real drain before Docker escalates to `SIGKILL`; a job killed mid-flight waits out its lease before it is retried anywhere |
| Exec-form `ENTRYPOINT` | Shell form wraps PID 1 in `/bin/sh -c`, which does not forward `SIGTERM` — the drain would never run |
| A volume at `/var/lib/worker` | State survives a restart, so a replica re-attaches instead of leaking a node row |

If the container cannot write its config file back (a read-only home is
common), the worker warns and keeps going.

The worker makes only **outbound** connections: no ports, no inbound firewall
rule, and no database access.

To build the image from a checkout instead of pulling it:

```bash
docker compose -f worker.compose.yml -f worker.build.compose.yml up --build
```

### 4.0 The worker variables follow your CLI name

`infra/compose/worker.compose.yml` and `.env.worker.example` are generated
from `@marinoscar/platform-infra` by `npm run platform:infra:sync`, with every
variable rendered from the app's CLI name: `appctl` gives the `APPCTL_*` names
used in this runbook, a fork whose CLI is `evopathcli` gets `EVOPATHCLI_*`.
The names always match what the worker reads (`ENV_PREFIX` in
`apps/cli/src/branding.ts`; `packages/platform-cli/src/engine/node/worker-env.test.ts` checks
both files). After renaming the CLI, run the sync and commit the result; never
edit either file by hand (CI's `platform:infra:sync -- --check` fails).

### 4.1 The published worker image

CI publishes `ghcr.io/<owner>/<repo>-worker` (owner and repository name
lower-cased) beside the api, web and stack-agent images, from
`.github/workflows/images.yml`: on every app release tag (`v*`, the same tag
conventions as the api and web images) and on every platform release
(`<version>`, `next`, `sha-<short sha>`). `worker.compose.yml` defaults to the
placeholder `ghcr.io/OWNER/REPO-worker:latest` on purpose, so a fork never
silently runs another repository's image: set `WORKER_IMAGE` in `.env.worker`.
(An app can render its own default into both files instead, with `workerImage`
in the identity file the sync reads; see the
[platform-infra README](../../packages/platform-infra/README.md#identity-placeholders).)

```bash
# .env.worker: a release, or for production the digest you verified
WORKER_IMAGE=ghcr.io/<owner>/<repo>-worker:<version>
WORKER_IMAGE=ghcr.io/<owner>/<repo>-worker@sha256:<digest>
```

Every pushed digest is signed keyless with cosign and carries an SBOM and
provenance. Verify before you scale a fleet onto it (`REPO` is `<owner>/<repo>`
as GitHub spells it, case included):

```bash
cosign verify ghcr.io/<owner>/<repo>-worker@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp "^https://github.com/${REPO}/\.github/workflows/images\.yml@"
```

An app built on the `@marinoscar/platform-*` packages pins the worker to the
same version as its packages. Tags, channels, the SBOM and that pinning are in
[container-images.md](container-images.md).

## 5. Capabilities and the startup self-test

The worst failure a worker has is starting successfully and then failing every
job it claims: it looks healthy to every orchestrator and dashboard while
draining the queue into the failed pile, and each failure charges the job an
attempt.

So a headless worker probes its capabilities at startup and compares them
against what its eligible job types declare:

- A missing **required** capability → **hard exit** (code `70`), naming the
  capability and the type. In a container that is a visible crash-loop with a
  clear reason, which is strictly better than a node quietly failing
  everything.
- A missing **degradable** capability → warn and continue.

The template's example job type hashes a stream and needs nothing native. The
one entry that is real is the database backup:

| Type | Required | Degradable |
|---|---|---|
| `db.backup.run` | `pg_dump` | `psql` |

A node without `pg_dump` therefore never declares `db.backup.run` — which
matters more for this type than for any other, because it is configured never
to retry: a claim it cannot fulfil is a backup that simply did not happen.
`psql` is degradable because it is used only to read the server version and the
newest applied migration; without it the backup is taken, uploaded and verified
with those two audit fields left `null`.

A node also needs a **network route** to the database, which nothing on this
machine can check for you at startup. `appctl node doctor --db-host
db.internal:5432` probes it, as a warning rather than a failure — see
"Health checks, dependencies and running as a service" in [`apps/cli/README.md`](../../apps/cli/README.md#running-a-worker-node).

Beyond those, the **structure** is the deliverable, and it is the documented
place a fork declares that its `video.transcode` type needs `ffmpeg`.

### 5.1 Take database backups on a node

`db.backup.run` needing a real PostgreSQL connection — not a presigned URL —
is the one place a worker node's "no persisted database access" rule (above)
gets an exception rather than an exemption. Three things an operator turning
this on needs to know, none of them a code change:

1. **The connection is per job, not per node.** A node never holds a database
   password in its config file or its state directory. When it holds a
   `db.backup.run` job it calls `POST /api/nodes/{id}/jobs/{jobId}/secret`, gets one
   short-lived credential back, holds it in memory for the life of that job,
   and drops it. `packages/platform-cli/src/engine/node/executors/db-backup-run.test.ts` asserts
   this statically — the executor imports no config writer at all.
2. **Two independent switches, both off by default, must both be on** before
   any node is ever offered the job type: `nodes.jobSecretBrokerEnabled` ("may
   this deployment broker credentials to nodes at all?") and
   `databaseBackup.nodeOffloadEnabled` ("may *this* workload leave the API
   server?"). They are separate on purpose — a deployment can trust its fleet
   with credentials in general while still keeping backups on the server, or
   vice versa. Both live in the admin UI, not in an environment variable.
3. **The database role this API connects as needs `CREATEROLE`** to mint the
   short-lived, read-only role each backup job uses. `GET
   /api/admin/db-backup/node-credential-preflight` tells you, without
   changing anything, whether it already has that grant — and if it does not
   (the ordinary case on managed PostgreSQL, where the application role is
   deliberately not a superuser), it hands back a paste-ready `ALTER ROLE …
   CREATEROLE;` (or a dedicated minter role, the least-privilege option) in
   its response rather than failing. Run one of those once, as whatever
   account administers your database. Auditing issued roles and cleaning up
   an orphan by hand is [`docs/runbooks/node-job-secrets.md`](../runbooks/node-job-secrets.md).

Until all three are true, `db.backup.run` runs on the API server. Nothing
about turning this on is required to take backups at all.

### 5.2 Declare a requirement in a fork

An app declares what its job types need with registrations made before the
node starts (the module that holds `createCli({ nodeExecutors })` is the natural
place), all from `@marinoscar/platform-cli/node`:

```ts
registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
registerCapabilityProbe(moduleCapability('sharp'));
registerCapabilityProbe(httpServiceCapability({ id: 'ocr', env: 'APP_OCR_URL', path: '/status' }));

registerJobRequirement('app.transcode', {
  required: [binaryCapability('ffmpeg')],
  degradable: [binaryCapability('exiftool')],
});
registerJobRequirement('app.ocr', { required: ['service:ocr'], degradable: ['module:sharp'] });
```

Three kinds of key, one rule:

| Key | Probe | Notes |
|---|---|---|
| `binary:<name>` | `which` (plus a version banner with `versionArgs`) | Registered automatically by `registerJobRequirement` |
| `module:<name>` | `require.resolve`, never an import | A `module:` key in a requirement registers its own probe; an `operational` check separates installed from working |
| `service:<id>` | a bounded HTTP `GET` (3 s) | The URL is read from the named env var at probe time; a 2xx is available, another HTTP answer is *installed*, no answer is *missing* |

**Installed is not operational.** A module that resolves but fails its check, or
a service that answers HTTP 500, is reported as *installed but not operational*.
It is not in the satisfied set, so a **required** one stops the node at startup
(exit `70`) exactly like a missing one, with a message that says which it is;
a degradable one only warns. `node doctor` lists every module and service with
its state under "Modules and services registered for app job types", and the
same results ride the heartbeat capability summary to the fleet page. Cheap
presence probes are refreshed on each heartbeat (a sidecar that goes away shows
up without a restart); expensive results are cached for their `cacheMs`.

### 5.3 Model files

A job type that needs a large file (OCR data, a network) declares it with
`registerModelArtifact({ id, fileName, sha256, bytes, url, requiredBy, targetSubdir? })`.
The app owns the URL and the checksum, so fleet agreement on versions comes from
the app release, not from a server call.

```bash
appctl node models status     # verify the files on disk, no download
appctl node models pull       # download what is missing or corrupt
appctl node models pull --ids ocr-eng --force
```

- Files live in `<state dir>/models`, or in `<PREFIX>MODELS_DIR` (point it at
  the directory a container image bakes the files into: a valid file already
  there is left alone, nothing is downloaded).
- A pull streams to `<file>.partial`, **resumes** an interrupted download with a
  `Range` request, checks the size and the sha256, and renames into place
  atomically. A file that fails its sha256 is deleted and not retried.
- At startup the node verifies every declared file. A job type whose model is
  missing or corrupt is **not advertised** (the node stays healthy for
  everything else; this is not a hard exit). The log and `node doctor` name the
  file and the withheld types. Run `node models pull`, then restart the worker.
- Only the origin and path of a download URL are ever logged.

## 6. Install dependencies

```bash
appctl node install-deps --dry-run          # print the plan, change nothing
appctl node install-deps                    # the platform's steps, then the app's
appctl node install-deps --only models      # one or more steps, comma-separated
```

The package ships two generic steps (the state directory, the Node.js version).
Everything else is the app's: it registers its own steps with
`registerInstallStep({ id, label, supported, detect, install, requiresSudo?, order?, after? })`.
Registered steps run after the defaults, sorted by `order` (or placed right
after another step with `after`). Each step reports `skipped | installed |
failed | unsupported`; `detect` runs in `--dry-run` and `install` never does.

Helpers for steps, none with a product baked in:

- `ensureAptPackages(names, ctx)` installs only the Debian-family packages that
  are missing, with one `apt-get install -y`.
- `runWithSudoAnnounced(command, args, ctx)` prints the command before running
  it (as root already, without `sudo`) and never runs it in `--dry-run`.
- `ensureDockerContainer({ name, image, args, verify }, ctx)` creates or starts a
  sidecar container and polls `verify` (20 checks, 2 s apart) until it answers.

A step that needs `sudo` sets `requiresSudo: true`, so the plan names it before
any step runs. Declaring a model (5.3) adds the `models` step by itself.

## 7. Memory and native threads

Four mechanisms, all on by default, all with one thing in common: they assume
a supervisor is watching.

**Heap ceiling.** The worker re-execs itself once at startup with a RAM-aware
`--max-old-space-size`, because Node's default old-space limit is low for a
machine dedicated to being a worker. The original process becomes a
signal-forwarding shim, so a container `SIGTERM` still reaches the worker and
still drains. An explicit `APPCTL_HEAP_LIMIT_MB` is honoured above 8192 MB (it
is floored at 512 MB, never capped); `APPCTL_HEAP_LIMIT_MB=0` disables the
re-exec when a cgroup or a PaaS already manages memory, because a second opinion
there is worse than none.

**Native threads.** Image and codec libraries (libvips and the like) keep their
own thread pools and caches outside the V8 heap, so a heap ceiling does not
bound them. `APPCTL_NATIVE_THREADS` is the one cap every app shares: a positive
whole number, defaulting to half the cores clamped to 1 to 4. An app applies it
by registering a runtime hook (`registerWorkerRuntimeHook`), which runs once per
worker start, after the heap re-exec and before the first claim, in daemon and
foreground mode alike. A hook receives `{ concurrency, cores, nativeThreads,
env }`; a hook that throws aborts the start with a `WorkerRuntimeHookError`
naming it, rather than letting the worker claim jobs unconfigured. Operators do
not register hooks; they only set the number.

**The watchdog** samples memory and, once the samples span a real window,
reports a least-squares growth trend in MB/hour. That trend is the difference
between "it died" and "it was climbing 40 MB/hour for six hours". It is read
from the heartbeat vitals (section 8.2), not from the log: the watchdog logs
only when the valve fires. `APPCTL_MEMORY_WATCHDOG=false` turns off sampling,
the trend and the valve together.

**The pre-OOM valve** fires once when `heapUsed / heapLimit` crosses the
threshold (default `0.9`, `APPCTL_MEMORY_THRESHOLD`, clamped to 0.5 to 0.99):
snapshot, log, drain, exit. The drain is bounded at 60 seconds, so one wedged
job cannot keep a leaking process alive until the kernel kills it; the worker
exits when the drain finishes or the bound passes, whichever is first. The exit
code is `71` unless the app chose another with `createCli({ node: {
memoryValveExitCode } })` (an integer from 64 to 113). The valve can be turned
off while sampling continues, but only by an app-registered legacy alias
(section 9: a legacy fraction of `0`); the canonical variable always arms it.

> ⚠️ **The valve requires a supervisor.** It exits deliberately after a clean
> drain. Without a restart policy, a *successful* drain leaves the worker down:
> a self-healing mechanism turned into an outage.

### 7.1 Supervisor settings

| Supervisor | Setting | Why |
|---|---|---|
| systemd | `Restart=on-failure`, `RestartForceExitStatus=71`, `TimeoutStopSec=300` | `appctl node service install` writes all three; the exit status follows the app's `memoryValveExitCode`. Reinstall the unit (`appctl node service install`) after upgrading an old one |
| Docker Compose | `restart: unless-stopped`, and a `stop_grace_period` at least as long as your longest job | Any non-zero exit restarts, so the valve code needs no entry. Keep the grace period or a rolling update kills jobs mid-run |
| Anything that keys an alert on a number | Read the valve code from the startup line (7.4), or pin it with `memoryValveExitCode` | Do not hard-code `71` in an alert if an app may have changed it |

### 7.2 Diagnose a leak

```bash
appctl node heap-snapshot     # asks the LIVE daemon
```

Ask the running worker, not a fresh one. Restarting to attach a diagnostic flag
discards exactly the accumulated state that names the retainer, which is also
why the valve writes its snapshot *before* draining rather than after.

Snapshots land in `<state dir>/heap-snapshots`, newest five kept, and are
skipped with a clear reason when free disk is under 1.5x the live heap: a
snapshot must never be the thing that fills the volume. Open one in Chrome
DevTools, Memory, Load. `APPCTL_HEAP_SNAPSHOTS=false` disables all three
snapshot paths (the valve, the IPC command and the near-limit one).

### 7.3 Exit codes

| Exit code | Meaning |
|---|---|
| `0` | Clean stop |
| `1` | Unclassified failure or configuration error |
| `2` | Bad usage |
| `3` to `6` | The server answered non-2xx (3), was unreachable (4), rejected the credential (5), or a prerequisite was not met (6) |
| `70` | A required capability for an advertised job type is missing, or present but not operational |
| `71` | The pre-OOM valve fired. Restart it. Configurable per app (64 to 113) |

### 7.4 The startup line and the vitals that show pressure

Every start logs one `worker started` line carrying `nodeId`, `name`,
`concurrency`, `types`, `headless`, `heapLimitMb`, `nativeThreads`,
`valveExitCode`, `valve` (`armed`, `off (sampling only)` or `off (watchdog
disabled)`) and, when any legacy name supplied a value, `envAliases` as
`LEGACY->CANONICAL` pairs. Read it first when a worker behaves differently from
its peers. The heartbeat vitals (section 8.2) carry the live heap numbers and
the growth trend.

## 8. Day-to-day operation

```bash
appctl node status              # live snapshot from the running worker
appctl node logs --follow       # attach to the daemon's event stream
appctl node set-concurrency 8   # applies live; persists either way
appctl node stop
```

Attaching is **read-only** and passive: inspecting a worker never perturbs it,
and detaching leaves it running untouched.

In a real terminal, `appctl` with no arguments opens the interactive menu;
**Worker node (this machine)** offers a live dashboard (status, concurrency,
job types, totals, heartbeat age, active jobs and the event stream),
`doctor`, the log, `register` and `enroll`. With no worker running, press `s`
to start a detached one and attach.

Press `e` instead to run the worker **inside the terminal** (embedded mode).
Use it for a quick look, a laptop or a demo, not for sustained work: an
interactive process cannot restart itself with a bigger heap, so it keeps
Node's default limit, and the memory valve (section 7), which exits the
process after a clean drain and relies on a supervisor to restart it, closes
the whole screen with it. Leaving the screen stops the worker (without
deregistering it). The embedded worker still hosts the daemon socket, so
another terminal can attach to it while the screen is open. The **Jobs queue**
screen is separate: it polls the server for the queue's counts and estimates
and needs the `jobs:read` permission; without it the screen says so.

### 8.1 What lands in the logs

JSONL under `<state dir>/logs/node.log`, one rollover generation at 5 MiB,
written synchronously so the lines immediately before a crash survive it.

**Secrets are redacted before anything reaches disk** — tokens, API keys,
passwords, and presigned storage URLs — recursively, through nested objects and
arrays. That last one matters: a presigned URL is a bearer capability over an
object, and log files are things people attach to issues.

### 8.2 Vitals on the heartbeat

Every heartbeat (every 15 s, and immediately after a concurrency change)
carries a `vitals` snapshot of the worker process, so an administrator can spot
a node that is alive but unwell before it stops heartbeating:

| Field | What it is |
|---|---|
| `cpuPercent` | Process CPU since the previous heartbeat; `100` is one full core, so a busy multi-core worker can exceed it |
| `rssBytes`, `heapUsedBytes`, `heapLimitBytes` | Process memory and the V8 heap ceiling (the same numbers the memory watchdog in §7 acts on) |
| `eventLoopDelayP99Ms` | p99 event-loop delay since the previous heartbeat; a high value means something is blocking the worker |
| `stateDirFreeBytes`, `stateDirTotalBytes` | The filesystem holding the state directory (`APPCTL_STATE_DIR`) |
| `slotsUsed`, `slotsTotal` | Jobs running now / the current concurrency |
| `uptimeSeconds` | How long this worker process has been running |
| `counters` | Totals since the process started: `claims`, `emptyPolls`, `claimFailures`, `succeeded`, `failed`, `rateLimited`, `leaseRenewals`, `leaseRenewFailures`, `heartbeatFailures`, and `watchdogTrips` (0 or 1: the valve exits the process) |
| `cliVersion`, `nodeVersion` | The `appctl` and Node.js versions |

The counters reset on every restart. Each field is best-effort: one the worker
cannot read (for example the disk figures on an unusual filesystem) is simply
left out, and nothing about collecting vitals can stop a heartbeat. There is
nothing to configure.

**Where to see them.** The server stores the latest snapshot on the node's row:
`GET /api/admin/nodes` and `GET /api/admin/nodes/{id}` (`nodes:read`) return it
as `lastVitals`, stamped with the server's own `lastVitalsAt`. Vitals are for
display only; no scheduling decision reads them.

**Against an older server.** A server that predates vitals may refuse the
unknown `vitals` key with a `400`. The worker then resends that heartbeat
without vitals, stops sending them for the rest of the process, and logs one
warning (`server refused heartbeat vitals; not sending them again this
process`). The node stays online; upgrade the server and restart the worker to
get vitals back.

### 8.2.1 Laptops, battery and node events

A worker on a laptop also reports the machine's host vitals (system CPU,
memory, load), its power state (AC or battery, charge, charging) and a few
events. The worker sends them only after the server advertised
`node_host_vitals`; against an older server it sends plain vitals. Every probe
is best-effort: one that cannot read the machine is left out, and a failed
probe never delays a heartbeat. The probe reads `/sys/class/power_supply` on
Linux, `pmset -g batt` on macOS and `Win32_Battery` through PowerShell on
Windows (2 s timeout each, cached for 30 s). A desktop without a battery
reports no battery charge.

| Event | Severity | Meaning |
|---|---|---|
| `power.source_changed` | warning on battery, else info | The machine switched between AC and battery |
| `power.battery_low` | warning | On battery, below 20 % |
| `power.battery_critical` | critical | On battery, below 10 %; the machine may stop soon |
| `power.battery_recovered` | info | Charge climbed 5 points above the threshold, or AC returned |
| `node.sleep_resumed` | info | The machine woke from sleep; `gapSeconds` says for how long it was silent |
| `node.disk_low` | warning | The state directory has less than 5 % free (re-arms above 10 %) |

A node that starts on a low battery announces nothing until the state changes.
Events queue on the worker (200 at most) while the server is unreachable.

**What to do.**

- **A laptop worker keeps going offline.** Look for `node.sleep_resumed` just before the gap. Disable sleep while on AC power, or accept that the node is offline during sleep: held jobs return through the lease reaper.
- **`power.battery_critical`.** Plug the machine in or stop the worker cleanly; the dashboard verdict is already degraded at 10 % or less on battery.
- **`node.disk_low`.** Free space in `APPCTL_STATE_DIR` before the next job downloads its input.

**Where to see them.** The Worker Nodes page shows the power badge and, in a
node's vitals dialog, the Host machine section and the events timeline. The
routes are `GET /api/nodes/{id}/events` (your own node) and
`GET /api/admin/nodes/{id}/events` (any node), both `nodes:read`.

**Limits and retention.** The server accepts at most 120 events per node per
hour and drops the rest. It replaces a reported time older than 24 hours or
more than 5 minutes ahead with the time it received the event. The daily
`nodes.node_events_purge` job deletes events older than 30 days; a fork changes
that with `NodesModule.forRoot({ nodeEventsRetentionDays })`.

**Test it without unplugging a laptop (test-only).** Set
`PLATFORM_NODE_POWER_FIXTURE` to the path of a JSON file before starting the
worker. Every power read then returns that file's content instead of probing,
and the file is re-read each time. Edit it to flip the state:

```bash
echo '{"source":"battery","batteryPercent":8,"charging":false}' > /tmp/power.json
PLATFORM_NODE_POWER_FIXTURE=/tmp/power.json appctl node start
echo '{"source":"ac","batteryPercent":60,"charging":true}' > /tmp/power.json
```

The first read is the baseline. The next changes produce the events above
within a heartbeat or two. This variable is for tests only; never set it in
production.

### 8.3 Job spans sent to the server

After each job settles, the worker sends the server the timing of the job's
phases. The server records them as trace spans under the request that queued
the job, so a trace in the explorer shows the node's work next to the
server's:

| Span | Covers | Attributes |
|---|---|---|
| `job.download` | Fetching the input object (types with an input) | `bytes` |
| `job.secret` | Obtaining the job's brokered credential (e.g. `db.backup.run`) | none |
| `job.execute` | Running the job | `attempt` |
| `job.upload` | The streamed upload (`db.backup.run`) | `bytes` |
| `job.submit` | Posting the result, or reporting the failure | none |

Each span holds only a start time, a duration, `ok`/`error`, and the numbers
above. A failed phase adds the error's class name, plus an HTTP status or
system error code (`MissingJobInputError`, `ApiError.409`,
`Error.ECONNREFUSED`). It never carries the error message, a URL, a path or
the credential. The server takes the node's identity from the authenticated
route, not from anything the worker sends.

Sending is best-effort and never delays or fails a job. Spans wait in a
bounded in-memory queue (500 spans, oldest dropped first) and go out in
batches of up to 50. A refused batch (`400`, `403`, `429`) or a network error
is dropped silently. There is nothing to configure.

**Against an older server.** A server without the relay answers `404`. The
worker then stops sending spans for the rest of the process and logs one
warning (`server has no span relay (older API); not sending job spans again
this process`). Jobs are unaffected; upgrade the server and restart the worker
to get node spans.

**Spans missing from a trace.** The server keeps spans only for a job the node
holds, or settled in the last 10 minutes, on the same API replica that
recorded the settle. A batch is refused when a span ends more than five minutes
in the future by the server's clock (a worker clock running ahead) or started
more than 24 hours ago, and when one node sends more than 60 batches or 1000
spans a minute. Check the worker's clock (NTP) first. Tracing must also be on at the
server (`OTEL_ENABLED`); see [telemetry.md](telemetry.md).

## 9. Legacy env names

A fleet that predates the platform engine sets its own variable names in compose
files and units. An app can name them once, with `registerWorkerEnvAlias(key,
legacyName)` or `createCli({ node: { envAliases } })`, and the fleet keeps
working while you rename at your own pace.

- A legacy name is read only when the canonical one is unset or empty. The
  canonical name always wins.
- One deprecation line is logged per alias in use, and the startup line lists
  them (7.4). The generated variable table in
  [`apps/cli/README.md`](../../apps/cli/README.md#running-a-worker-node) shows
  the aliases an app registered.
- The token (`APPCTL_TOKEN`) and the re-exec latch (`APPCTL_HEAP_TUNED`) can
  never be aliased: a secret is not read from a second, unaudited name.
- A legacy valve fraction of `0` turns the valve **off** while sampling
  continues; a value outside 0 to 1 is ignored. (The canonical variable would
  clamp `0` to 0.5, so a carried-over `0` must not be a plain rename.)
- Values are copied verbatim otherwise; the usual parsing applies.

Remove the aliases once the last compose file and unit use the canonical names;
the deprecation lines tell you whether any still do.

## 10. Streaming inputs

A job type declares how its executor reads the input object: `none`,
`download` (the engine streams it to a temp file) or `url`. In `url` mode the
engine downloads nothing and hands the executor a presigned URL, so a tool that
range-seeks the object (ffmpeg, ffprobe) reads only the bytes around each seek
point: a multi-GB video costs megabytes of transfer and no scratch disk.

What an operator should know:

- The URL expires with the lease. The executor asks for a fresh one
  (`refreshInputUrl`) when a long job outlives it; there is nothing to configure.
- **Faststart caveat.** Seeking needs the container's index near the start of
  the file. A non-faststart MP4 keeps its index at the tail, so a streaming read
  can fetch far more than expected or fail. Such an executor is expected to fall
  back to downloading inside `execute`; if a fleet shows high egress for a
  `url`-mode type, check the source files before the node.
- The presigned URL is a bearer capability. It is never logged by the engine and
  must not be logged, put in a span attribute or passed to a process whose
  stderr is captured. Only `job.input_mode = url` belongs in telemetry.

## 11. Move a forked worker onto the platform engine

For an app that forked the worker-node CLI (its own `node` command, daemon,
watchdog and install steps) and now wants the platform engine. The line-by-line
comparison is the [harvest report](../platform-adoption/worker-node-harvest.md);
this is the order of work. Code-side steps are in
[docs/ADOPTING-THE-PLATFORM.md](../ADOPTING-THE-PLATFORM.md#step-5-jobs-and-nodes).

1. **Executors.** Register each job type with `registerNodeExecutor` and its
   needs with `registerJobRequirement` (`binary:`, `module:`, `service:` keys).
   Pick `input: 'none' | 'download' | 'url'` per type. A type whose executor
   needs a provider key on the node stays server-only: the platform does not
   broker AI keys to nodes.
2. **Probes, steps and models.** Move app probes to `registerCapabilityProbe`
   (`moduleCapability`, `httpServiceCapability`), install steps to
   `registerInstallStep`, and model files to `registerModelArtifact` (sections
   5.3 and 6). Probes and steps may be asynchronous.
3. **Runtime tuning.** Replace the app's own libvips setup with a
   `registerWorkerRuntimeHook` that applies `ctx.nativeThreads`.
4. **Variable names.** Map the old names with `registerWorkerEnvAlias`:

   | Old variable (typical fork) | Platform variable | Note |
   |---|---|---|
   | `<APP>_URL` | `<PREFIX>SERVER_URL` | Not a suffix rename |
   | `<APP>_TOKEN`, `_NODE_ID`, `_NODE_NAME`, `_CONCURRENCY`, `_POLL_INTERVAL_MS`, `_HEADLESS`, `_STATE_DIR` | same suffix under `<PREFIX>` | No alias needed when the prefix matches the CLI name |
   | `<APP>_ELIGIBLE_TYPES` | `<PREFIX>ELIGIBLE_TYPES` | Comma-separated |
   | `<APP>_MAX_OLD_SPACE_MB` | `<PREFIX>HEAP_LIMIT_MB` | `0` disables the re-exec; above 8192 is honoured |
   | `<APP>_HEAP_RESTART_FRACTION` | `<PREFIX>MEMORY_THRESHOLD` | A legacy `0` means valve off, sampling on |
   | `<APP>_HEAP_SNAPSHOT` | `<PREFIX>HEAP_SNAPSHOTS` | Off disables all three paths |
   | `<APP>_MEMWATCH` | `<PREFIX>MEMORY_WATCHDOG` | Off disables sampling and the valve |
   | `<APP>_SHARP_CONCURRENCY` | `<PREFIX>NATIVE_THREADS` | Default half the cores, 1 to 4 |
   | `MODELS_DIR` | `<PREFIX>MODELS_DIR` | Unset means `<state dir>/models` |

   Variables that belong to an app's own compute (a sidecar URL, a session
   recycle count) are not worker variables; the app's executors and probes read
   them.
5. **Exit codes.** The platform uses distinct codes where a fork often used `1`:

   | Condition | Typical fork | Platform |
   |---|---|---|
   | Clean stop | 0 | 0 |
   | Config or unclassified failure | 1 | 1 |
   | Bad usage | 1 | 2 |
   | Server non-2xx / unreachable / credential rejected / prerequisite | 1 | 3 / 4 / 5 / 6 |
   | Required capability missing or not operational | 1 | 70 |
   | Memory valve | often 75 | 71, or the app's `memoryValveExitCode` |

   Both valve codes are non-zero, so a `Restart=on-failure` or `restart:
   unless-stopped` supervisor restarts on either. Only an alert or script that
   matches the number needs updating, or set `memoryValveExitCode` to the old
   value.
6. **Node identity.** Re-attach keys on the node name. A fork whose default name
   was `worker-<host>` registers a new row under the platform default (`<host>`)
   and leaves a stale offline one. Set `<PREFIX>NODE_NAME` (or `NODE_ID`)
   explicitly in the compose file and unit before switching.
7. **Supervisor files.** Regenerate the systemd unit (`appctl node service
   install`) so it gains `--headless`, `TimeoutStopSec=300` and
   `RestartForceExitStatus=`. Re-run `platform:infra:sync` for the compose
   bundle.
8. **Verify.** `appctl node doctor` shows every capability with its state;
   `appctl node models status` checks the model files; the `worker started`
   line (7.4) should show the heap limit, thread cap and the aliases in use.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `A worker is already running here (pid N)` | A live daemon holds this state directory | `appctl node stop`, or use a different `APPCTL_STATE_DIR` |
| Starts, then exits with code `70` | An advertised job type is missing a required capability | The message names both — install it, or drop the type from `--types` |
| `doctor` says reachable but refused (401) | The credential was revoked or belongs to another server | `appctl node enroll` again |
| `doctor` says refused (403) | The account lacks `nodes:read`/`nodes:write` | Ask an administrator to grant them |
| `doctor` says 404 on `/api/nodes` | The server predates worker nodes | Upgrade the server |
| The node shows online in the admin UI but does nothing | It has no executor for any advertised type | `appctl node status` lists what it can actually run |
| Jobs fail immediately with a rate-limit message | A provider is throttling | Nothing to do — the server defers those without charging an attempt |
| Exits `71` and restarts repeatedly | The pre-OOM valve is firing: the heap keeps crossing the threshold | Read the trend in the vitals, take a `node heap-snapshot` between restarts, raise `APPCTL_HEAP_LIMIT_MB` only if the host has the RAM; see section 7 |
| A job type is missing from the fleet page | A model it needs is missing or corrupt | `appctl node models status`, then `models pull` and restart |
| The worker vanishes when you log out | No systemd lingering | `loginctl enable-linger $USER` |

## Summary checklist

**One machine**

- [ ] `appctl node enroll` stored a `nod_` credential
- [ ] `appctl node register` created or reattached the node (it says which)
- [ ] `appctl node doctor` reports this machine, the server and the worker
      without failures
- [ ] `appctl node start --daemon` running, or `appctl node service install`
      plus `loginctl enable-linger $USER`

**A container fleet**

- [ ] `.env.worker` sets `APPCTL_SERVER_URL` and `APPCTL_TOKEN`, and leaves
      `APPCTL_NODE_NAME`/`APPCTL_NODE_ID` empty
- [ ] `restart: unless-stopped` and `stop_grace_period` kept in
      `worker.compose.yml`
- [ ] Nodes appear at `/admin/settings/workers`
- [ ] `WORKER_IMAGE` pinned to a release or a verified digest, not the
      placeholder default

**Database backups on a node (optional)**

- [ ] `pg_dump` on the node's `PATH`, and a network route to PostgreSQL
      (`appctl node doctor --db-host <host:port>`)
- [ ] `nodes.jobSecretBrokerEnabled` and `databaseBackup.nodeOffloadEnabled`
      both on, and the node-credential pre-flight answers `ok`
      ([`node-job-secrets.md`](../runbooks/node-job-secrets.md))
