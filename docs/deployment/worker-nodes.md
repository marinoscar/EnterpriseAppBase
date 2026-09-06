# Running worker nodes

> Operator runbook for the distributed worker fleet (epic #254, Phase 4).
> The design and its rejected alternatives live in
> [`docs/specs/worker-nodes.md`](../specs/worker-nodes.md); the command
> reference lives in [`apps/cli/README.md`](../../apps/cli/README.md). This
> file is the *how do I run one* half, and deliberately does not restate
> either.

## What a worker node is

A machine running `appctl node start` that claims jobs from the application's
queue, runs them locally, and submits results. The **same handler code** runs
on the API server or on a node — a node is an option, never a requirement, and
a deployment with no nodes at all still executes every job type it enqueues.

Nodes coordinate through nothing but the database. Two workers never receive
the same job because the claim is a `FOR UPDATE SKIP LOCKED` on one table, so
you scale by starting more of them and configuring none of them to know about
the others.

## Prerequisites

| Requirement | Why |
|---|---|
| Node.js 20+ | The CLI's runtime floor |
| Outbound HTTPS to the application | The only network access a node needs — no inbound ports, ever |
| An account with `nodes:read` and `nodes:write` | To enroll and register |

A worker needs **no** database access, no VPN, and no inbound firewall rule. It
downloads and uploads job data through short-lived presigned URLs the server
issues, so it never holds storage credentials either.

## Getting a machine running

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

## Surviving a reboot

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

## Capabilities and the startup self-test

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

This template's example job type hashes a stream and needs nothing native, so
the requirements map ships nearly empty. That is deliberate: the **structure**
is the deliverable, and it is the documented place a fork declares that its
`video.transcode` type needs `ffmpeg`.

### Declaring a requirement in a fork

In `apps/cli/src/node/capabilities.ts`:

```ts
export const PROBED_BINARIES = ['ffmpeg'];

export const JOB_TYPE_REQUIREMENTS = {
  'video.transcode': {
    required: [binaryCapability('ffmpeg')],
    degradable: [binaryCapability('exiftool')],
  },
};
```

## Installing dependencies

```bash
appctl node install-deps --dry-run   # print the plan, change nothing
appctl node install-deps
```

⚠️ **This ships as a framework, not as a set of real installs.** The template
has no native dependencies to install, and inventing some would mean a fork had
to work out which of the steps were real. What you get is the structure —
ordered steps, per-step `skipped | installed | failed | unsupported`, distro
detection, an explicit sudo announcement before anything runs, and a working
`--dry-run`. Add your own steps in `apps/cli/src/node/install-deps.ts` beside
the two generic ones.

## Memory

Three mechanisms, all on by default, all with one thing in common: they assume
a supervisor is watching.

**Heap tuning.** The worker re-execs itself once at startup with a RAM-aware
`--max-old-space-size`, because Node's default old-space limit is low for a
machine dedicated to being a worker. The original process becomes a
signal-forwarding shim, so a container `SIGTERM` still reaches the worker and
still drains. Set `APPCTL_HEAP_LIMIT_MB=0` when a cgroup or a PaaS already
manages memory — a second opinion there is worse than none.

**The watchdog** samples memory and, once the samples span a real window,
reports a least-squares growth trend in MB/hour. That trend is the difference
between "it died" and "it was climbing 40 MB/hour for six hours".

**The pre-OOM valve** fires once when `heapUsed / heapLimit` crosses the
threshold (default `0.9`): snapshot → log → drain → exit `71`.

> ⚠️ **The valve requires a supervisor.** It exits deliberately after a clean
> drain. Without `Restart=on-failure` or `restart: unless-stopped`, a
> *successful* drain leaves the worker down — a self-healing mechanism turned
> into an outage. `appctl node service install` sets this for you.

### Diagnosing a leak

```bash
appctl node heap-snapshot     # asks the LIVE daemon
```

Ask the running worker, not a fresh one. Restarting to attach a diagnostic flag
discards exactly the accumulated state that names the retainer — which is also
why the valve writes its snapshot *before* draining rather than after.

Snapshots land in `<state dir>/heap-snapshots`, newest five kept, and are
skipped with a clear reason when free disk is under 1.5× the live heap: a
snapshot must never be the thing that fills the volume. Open one in Chrome
DevTools → Memory → Load.

| Exit code | Meaning |
|---|---|
| `0` | Clean stop |
| `70` | A required capability for an advertised job type is missing |
| `71` | The pre-OOM valve fired — restart it |

## Day-to-day operation

```bash
appctl node status              # live snapshot from the running worker
appctl node logs --follow       # attach to the daemon's event stream
appctl node set-concurrency 8   # applies live; persists either way
appctl node stop
```

Attaching is **read-only** and passive: inspecting a worker never perturbs it,
and detaching leaves it running untouched.

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
| The worker vanishes when you log out | No systemd lingering | `loginctl enable-linger $USER` |

## What lands in the logs

JSONL under `<state dir>/logs/node.log`, one rollover generation at 5 MiB,
written synchronously so the lines immediately before a crash survive it.

**Secrets are redacted before anything reaches disk** — tokens, API keys,
passwords, and presigned storage URLs — recursively, through nested objects and
arrays. That last one matters: a presigned URL is a bearer capability over an
object, and log files are things people attach to issues.
