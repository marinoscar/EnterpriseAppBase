# Worker Nodes

> Epic #254, issues #267–#279. Implements a control plane at `/api/nodes/*`,
> a `WorkerNode`/`NodeCredential` data model, a `nod_`-prefixed bearer
> credential recognised by the existing `JwtAuthGuard`, and an `appctl node
> …` command family in `apps/cli` that runs a fat worker process claiming
> jobs from the queue [Job Queue](job-queue.md) (epic #254, #255/#256/#259–#266)
> defines. See that document first — this one adds *who else* may claim a
> `pending` row, not what a row is. [Database Backup & Restore](database-backup.md)
> (epic #254, #280–#287) is unrelated to this plane entirely: a database
> backup never runs on a node, for reasons that document states on its own.

**Status: design specification for planned work. Nothing in this document
exists in the codebase yet.** There is no `apps/api/src/nodes/` module, no
`worker_nodes`/`node_credentials` tables, no `nod_` branch in
`JwtAuthGuard`, and no `apps/cli/src/node/` directory. This document is what
issues #267–#279 build against.

## Contents

1. [Security model first](#1-security-model-first)
2. [`nod_` credentials](#2-nod_-credentials)
3. [Data model](#3-data-model)
4. [Control plane](#4-control-plane)
5. [Two shared guards in the service](#5-two-shared-guards-in-the-service)
6. [Claiming, and the four job-scoped endpoints](#6-claiming-and-the-four-job-scoped-endpoints)
7. [Fleet lifecycle, and an ordering bug worth naming](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming)
8. [The CLI worker (`appctl node …`)](#8-the-cli-worker-appctl-node-)
9. [The `NodeEngine` loop is a continuous top-up pool, not a batch drain](#9-the-nodeengine-loop-is-a-continuous-top-up-pool-not-a-batch-drain)
10. [The daemon: pidfile, IPC socket, and the write-backlog guard](#10-the-daemon-pidfile-ipc-socket-and-the-write-backlog-guard)
11. [Memory hardening](#11-memory-hardening)
12. [Container image and compose](#12-container-image-and-compose)
13. [The branding guard](#13-the-branding-guard)
14. [Permissions and settings reference](#14-permissions-and-settings-reference)
15. [What was deliberately dropped, and why](#15-what-was-deliberately-dropped-and-why)
16. [Rejected alternatives](#16-rejected-alternatives)
17. [Open questions for the child issues](#17-open-questions-for-the-child-issues)

## 1. Security model first

A node has **no database access and no storage credentials.** Every fact it
needs to do its job arrives in an HTTP response from the API it registered
with, and every result it submits is validated server-side before anything
is trusted from it. This is stated first, ahead of any schema or endpoint,
because it is the constraint every other design decision in this document
either implements or exists to preserve — a node is, by construction, code
running on a machine this deployment's operator may not control tightly (a
spare desktop, a rented VPS, a laptop that goes to sleep), and the entire
design treats it as such.

Two consequences follow immediately:

- **Media and other large bytes stream directly between the node and object
  storage via short-lived presigned URLs, never proxied through the API.**
  Proxying would make the API a bandwidth bottleneck for every byte a node
  ever moves, and would double every transfer (node → API, API → storage)
  for no benefit — the node already has everything a presigned URL needs to
  talk to storage directly, and the URL itself expires quickly enough that
  handing it to an untrusted process is a bounded exposure rather than a
  standing credential.
- **A node result is never trusted as fact.** [§6](#6-claiming-and-the-four-job-scoped-endpoints)
  is explicit about this: a submitted result is validated against a
  per-type schema, and the *server* re-derives and re-applies whatever the
  job actually requires — a node's compute is a declared-intent pass, not
  an authoritative write.

## 2. `nod_` credentials

A worker node is meant to run unattended for weeks or months, on hardware
the operator may not lock down as tightly as the server it phones home to.
Authenticating that process with a Personal Access Token — this
application's existing `pat_`-prefixed bearer credential, already recognised
by `JwtAuthGuard` (`apps/api/src/auth/guards/jwt-auth.guard.ts`) — would mean
a leak of that one credential (a compromised worker machine, a config file
checked in by mistake, a container image built with the token baked in)
grants **everything the owning user can do**, admin routes included, because
a PAT carries the full permission set of the user who minted it.

The fix is a second, narrower bearer credential family: **`nod_`-prefixed**,
sha256-hashed at rest (mirroring `PersonalAccessToken`'s own hashing —
`apps/api/src/pat/pat.service.ts` — never stored or shown in plaintext after
creation), and accepted **only** on `/api/nodes/*` routes. `expiresAt` is
**nullable** — deliberately, unlike a PAT's typical short-lived posture — a
worker intended to run for a year should not die of an unscheduled expiry in
month three; the operational control over its lifetime is **revocation**,
not a timer.

### 2.1 Enforcement in `JwtAuthGuard`

The `nod_` branch sits beside the existing `pat_` branch in
`JwtAuthGuard.canActivate`
(`apps/api/src/auth/guards/jwt-auth.guard.ts:26-51`), with one
non-negotiable ordering rule: **the route allowlist is checked *before*
`validateToken` is ever called.**

```ts
if (authHeader?.startsWith('Bearer nod_')) {
  if (!isNodeRoute(request.url)) {
    throw new UnauthorizedException('Node credentials are only accepted on node routes');
  }
  const token = authHeader.slice(7);
  const user = await this.nodeCredentialService.validateToken(token);
  if (!user) {
    throw new UnauthorizedException('Invalid or expired node credential');
  }
  request.user = user;
  return true;
}
```

Rejecting on the route check first, before the credential is even looked
up, matters for a reason beyond tidiness: `validateToken` is expected to
stamp `lastUsedAt` on a successful lookup ([§3](#3-data-model)), and a
request that was never going to be allowed regardless of the credential's
validity should not leave a "used" mark on a real, valid credential just
because it was aimed at the wrong endpoint — that mark is meant to answer
"is this worker still alive," and a rejected off-route probe answering that
question is a false positive an operator debugging a stale worker should
never have to account for.

`isNodeRoute` matches **exactly** `/api/nodes` or a `/api/nodes/` prefix,
with the query string stripped before matching, so `/api/nodesX` and — this
is the case that matters — **`/api/node-credentials` do NOT match**. A
`nod_` credential cannot reach even its *own* management routes: it can be
used to do node work, and it cannot be used to mint another `nod_`
credential, list existing ones, or revoke one. That capability stays
reserved for a real user session (JWT or PAT), which is the correct owner
of "can this deployment's node fleet grow or shrink," not something a
long-lived, narrowly-scoped worker credential should ever be trusted to
decide about itself.

### 2.2 `NodeCredentialModule` is global and minimal

`NodeCredentialModule` is `@Global()`, importing only the Prisma module —
mirroring the existing `PatModule`'s own shape. `JwtAuthGuard` is
constructed once, early, and used by nearly every request in the
application; keeping its dependency graph as small as possible is what
keeps that guard fast to instantiate and easy to reason about. A module
that pulled in the rest of the nodes feature (the claim logic, the fleet
lifecycle sweep) just to satisfy the guard's need for "validate this token"
would tie the authentication fast-path to a much larger and more
frequently-changing surface than it needs to depend on.

## 3. Data model

```prisma
model WorkerNode {
  id               String     @id @default(uuid())
  name             String
  hostname         String?
  platform         String?
  cliVersion       String?
  eligibleTypes    String[]
  concurrency      Int        @default(1)
  status           NodeStatus @default(online) // online | draining | offline | disabled
  capabilities     Json?
  registeredAt     DateTime   @default(now())
  lastHeartbeatAt  DateTime?
  createdById      String
  createdBy        User       @relation(fields: [createdById], references: [id])

  @@unique([createdById, name])
}

model NodeCredential {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id])
  name         String
  tokenHash    String    @unique
  tokenPrefix  String
  expiresAt    DateTime? // nullable — see §2
  lastUsedAt   DateTime?
  createdAt    DateTime  @default(now())
  revokedAt    DateTime?
}
```

`WorkerNode`'s `@@unique([createdById, name])` is the anchor the
register-or-reattach contract in [§4](#4-control-plane) is built on: a name
is unique *per owner*, not globally, so two different users may each run a
node called `"laptop"` without collision, and one user re-registering under
a name they already own is detectably the *same* node rather than a
name clash with a stranger.

`NodeCredential` mirrors `PersonalAccessToken` almost field-for-field, minus
the duration-unit bookkeeping (`durationValue`/`durationUnit`) a PAT carries
for its typical short-lived use — a `nod_` credential's lifetime is either
"forever, until revoked" or an explicit `expiresAt` the operator set, with no
"renew for N more days" convenience built in, because the expected
lifecycle event for a worker credential is revocation (decommissioning a
machine), not periodic renewal.

**`Job.claimedByNode` is `onDelete: SetNull`, never `Cascade`.** Deleting a
`WorkerNode` row — an operator tidying up a decommissioned machine, or the
retention prune in [§7](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming)
— must **release** whatever the node had claimed, not destroy it. A job is
work this deployment still needs done; the node that happened to be running
it is incidental, and deleting the node record must never take the job down
with it. A `SetNull` FK plus the reaper in
[Job Queue §8](job-queue.md#8-hygiene-reaping-purging-and-the-temp-file-janitor)
is what turns "the node that had this job is gone" into "this job gets
reclaimed by whoever is next," automatically, with no special-cased cleanup
path.

## 4. Control plane

All routes under `/api/nodes/*`, PAT- or `nod_`-authenticated
([§2](#2-nod_-credentials)):

| Method & path | Notes |
|---|---|
| `POST /register` | Register a node. **Idempotent on `(owner, name)`.** |
| `POST /:id/deregister` | Graceful shutdown — see [§7](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming) for why this alone is not enough to track fleet health. |
| `POST /:id/heartbeat` | Liveness ping; may also refresh `status`/`capabilities`/`concurrency` live, so `set-concurrency` ([§8](#8-the-cli-worker-appctl-node-)) takes effect without a restart. |
| `POST /:id/claim` | The shared claim primitive from [Job Queue §5](job-queue.md#5-claiming-a-job), `executor: 'node'` — see [§6](#6-claiming-and-the-four-job-scoped-endpoints). |
| `POST /:id/jobs/:jobId/renew` | Extends the lease on a long-running claimed job before `leaseExpiresAt` passes. |
| `POST /:id/jobs/:jobId/result` | Submit a computed result — see [§6](#6-claiming-and-the-four-job-scoped-endpoints). |
| `POST /:id/jobs/:jobId/failure` | Report a failure, routed through the *same* terminal state machine ([Job Queue §6](job-queue.md#6-the-terminal-state-machine)) an in-process failure uses. |
| `GET /nodes` | List the caller's own nodes. |
| `GET /nodes/:id` | Get one of the caller's own nodes. |

### 4.1 Register-or-reattach

`POST /register` is idempotent per `(owner, name)`: a fresh registration
under a name the caller already owns **re-attaches** to the existing row
(refreshing `hostname`/`platform`/`cliVersion`/`eligibleTypes`/`concurrency`,
setting `status: 'online'`) rather than creating a second row for what is,
in every practical sense, the same worker restarting. This is what makes a
crash-and-restart, or a container recreated by its orchestrator with an
unchanged name, invisible to the fleet view as anything other than "back
online" — never a growing pile of dead duplicate rows the operator has to
notice and prune by hand.

A registration racing another registration for the same `(owner, name)` —
two container replicas booting at once with an accidentally-shared name, or
a genuine restart racing a stale-but-not-yet-pruned previous instance — is
resolved as a database-level conflict (the unique index) rather than an
application-level check-then-write, for the identical reason
[Job Queue §3.1](job-queue.md#31-dedup-is-an-index-not-a-query) rejects
`findFirst`-then-`create`: the loser's `P2002` is caught, the existing row
is re-read, and registration proceeds as a reattach. A heartbeat-freshness
conflict during that reattach (the existing row's `lastHeartbeatAt` looks
suspiciously recent, as if another live process already holds this name) is
**logged as a warning but does not block the reattach** — last-writer-wins,
because the overwhelmingly normal cause of this exact shape is an
orchestrator restarting a replica under an unchanged name, and refusing the
restart in that ordinary case would be a worse failure than the rare
genuine double-registration it exists to catch.

## 5. Two shared guards in the service

Every job-scoped and node-scoped route funnels through two guards in the
service layer — authoritative checks, not decorative ones a controller
could bypass by calling the service a different way:

- **`assertOwnership(userId, nodeId)`** — 404 if the node does not exist,
  403 if it exists but belongs to someone else, and **returns the row** on
  success so a caller needs no second fetch. 404-before-403 here (rather
  than 403 for "exists but not yours") is deliberate: a caller enumerating
  node ids should not be able to distinguish "this id does not exist" from
  "this id exists and is not yours" by response code alone.
- **`assertJobHeldByNode(nodeId, jobId)`** — the job must be currently
  claimed by *this specific* node, `status = 'running'`, and its lease not
  yet expired, or the call is rejected with **409**, not 400. This is the
  single guard that makes a late submission from a reaped, re-claimed node
  harmless: once [Job Queue](job-queue.md)'s reaper has requeued a job
  whose lease expired and a *different* claimant has since taken it, a
  straggling `result`/`failure`/`renew` call from the original node must be
  told, unambiguously, "this is no longer yours" — and 409 (a conflict with
  the current state of the resource) is the correct signal for "your
  request was valid when you formed it, but the world has moved on," which
  is exactly what happened. A 400 would suggest the *request itself* was
  malformed, inviting a naive client to retry with the same payload
  forever; 409 is what tells a well-behaved node to drop the work and move
  on instead.

## 6. Claiming, and the four job-scoped endpoints

`POST /:id/claim` delegates to the **same** claim statement
[Job Queue §5](job-queue.md#5-claiming-a-job) defines, with `executor:
'node'` and `$nodeId` set to the calling node's id. Two intersections narrow
what it can actually claim, both enforced server-side rather than trusted
from the request body:

- **Requested types ∩ the node's own registered `eligibleTypes`.** A node
  can only ever *narrow* what it asks for relative to what it registered
  with; it cannot claim a type it never declared itself capable of, no
  matter what a malformed or malicious claim request asks for.
- **Requested limit, clamped to the node's declared `concurrency`**, read
  **live** from the row at claim time — not cached from registration — so
  `set-concurrency` ([§8](#8-the-cli-worker-appctl-node-)) takes effect on
  the very next claim call, with no restart required.

### 6.1 Result ingestion, in order

`POST /:id/jobs/:jobId/result` runs a fixed sequence, and the order is load
bearing:

1. **`assertJobHeldByNode`** ([§5](#5-two-shared-guards-in-the-service)) —
   409 if the lease is gone.
2. **400 if the posted `type` does not match the job's own `type`** — a
   node submitting a result for the wrong job type is a client bug, not a
   409-shaped "the world moved on" situation.
3. **400 if the handler registered for this type has no
   `nodeResultSchema`/`persistNodeResult` pair** — i.e. the type is not
   node-eligible at all ([Job Queue §4](job-queue.md#4-the-handler-contract)).
   A node should never have been able to claim such a job in the first
   place ([§6](#6-claiming-and-the-four-job-scoped-endpoints)'s
   `eligibleTypes` intersection prevents it under normal operation), but
   this is the defence for a node whose registered `eligibleTypes` predate
   a handler being downgraded to server-only.
4. **Manual `nodeResultSchema.parse(body.result)`** — deliberately **not**
   run through the global validation pipe. The schema to validate against
   is resolved *per job type, at runtime*, from the handler registry; a
   global pipe is wired to one fixed DTO per route at startup and has no
   way to pick a different schema per request body.
5. **`persistNodeResult(job, result)`** — the handler's own persist-only
   half ([Job Queue §4](job-queue.md#4-the-handler-contract)).
6. **On any throw from step 5**, the job is routed through
   `completeFailed` — the same terminal-failure path an in-process
   exception takes — and the endpoint responds **500**, not 200. A persist
   crash is a genuine job failure that belongs inside the retry machine
   like any other, and the node must be told, unambiguously, not to
   resubmit the same result as if the first attempt simply hadn't arrived.

A node-supplied `willRetry` flag on a failure report is **advisory only**.
The server's own attempt/rate-limit budget ([Job Queue §6](job-queue.md#6-the-terminal-state-machine))
decides whether the job actually gets another attempt — a node has no
visibility into how many attempts a job has already burned across its whole
history (it may be seeing this job for the first time, after a different
node's earlier attempt), so trusting its opinion on "will this be retried"
would let a compromised or simply confused node force either premature
permanent failure or an unbounded retry loop.

## 7. Fleet lifecycle, and an ordering bug worth naming

`POST /:id/deregister` is a **graceful** shutdown — a node telling the
server "I am going away on purpose." Graceful shutdowns are not how workers
usually stop. A crashed process, a killed container, a machine that lost
power or network — none of these call `/deregister`, and a node that dies
this way sits at `status: 'online'` **forever**, because nothing else ever
writes `status: 'offline'`.

This is worse than a cosmetic inaccuracy in the fleet dashboard. It **silently
voids retention**: a prune job that selects `WHERE status = 'offline' AND
lastHeartbeatAt < cutoff` can never reach a node that is stuck at `'online'`
with a three-week-old heartbeat, no matter how long retention is configured
for, because the row never satisfies the `WHERE` clause the prune depends
on. The failure is invisible until someone happens to look at a fleet view
and notices a green "online" chip sitting above a heartbeat from weeks ago.

The fix is a **stale-offline sweep that must run *before* the prune, every
time**:

1. A cron transitions any `online`/`draining` node whose `lastHeartbeatAt`
   has fallen silent for `staleHeartbeatSeconds × offlineStaleMultiplier`
   to `status: 'offline'`. Expressing the offline threshold as a *multiple*
   of the existing stale-heartbeat window — rather than an independently
   configured duration — is deliberate: it is what keeps the fleet
   dashboard's "stale" indicator and the database's `offline` status from
   drifting into two unrelated notions of liveness that happen to look
   similar. `disabled` is **never** touched by this sweep — an operator's
   explicit "take this node out of rotation" intent must survive silence
   from the machine, not be silently reclassified as a crash.
2. Only *then* does the retention prune run, deleting `worker_nodes` rows
   that are both `offline` past the retention window **and** hold no job
   currently `running` — the second half of that condition existing so a
   node mid-execution on a long job is never deleted out from under work it
   is actively doing, even if its heartbeat happens to have lapsed at the
   exact moment the prune fires.

Reversing the order — pruning first, sweeping second — reproduces exactly
the bug this section describes: the prune's own `WHERE status = 'offline'`
clause would still never match a node that has been silently dead for
months but never transitioned out of `'online'`.

## 8. The CLI worker (`appctl node …`)

```
appctl node register            # register this machine as a worker node
appctl node enroll              # device-flow login, then mint + store a nod_ credential
appctl node start [--daemon]    # run the claim/compute/submit loop
appctl node start [--headless]  # drain and exit on SIGTERM/SIGINT, no deregister
appctl node stop
appctl node status
appctl node logs
appctl node set-concurrency <n>
appctl node doctor
appctl node install-deps
appctl node heap-snapshot
appctl node service install|uninstall|status
```

`enroll` is the on-ramp meant for a brand-new machine: it runs the CLI's
existing device authorization flow (`apps/cli/src/device-login.ts`) to
authenticate a human, then — rather than storing that human's own PAT, as
`login` does — mints a fresh `nod_` credential and stores *that* as the
CLI's persisted token, clearing any previously-stored expiry. This is the
concrete reason `nod_` credentials exist at all
([§2](#2-nod_-credentials)) rather than simply having `appctl node start`
reuse whatever token `login` already stored: a human's own PAT should never
be the thing sitting in a worker machine's config file.

All env-var overrides this command family reads (`SERVER_URL`, `TOKEN`, a
node id/name, concurrency, eligible types, poll interval, state directory,
headless mode, memory-tuning knobs) are derived through the CLI's existing
`envVar()` helper (`apps/cli/src/branding.ts`) and **must** reuse the
existing `SERVER_URL_ENV_VAR`/`TOKEN_ENV_VAR` constants already exported
from `apps/cli/src/config.ts` rather than defining a second pair of
server-URL/token variable names — a worker container that is handed
`APPCTL_SERVER_URL`/`APPCTL_TOKEN` (this template's current prefix; see
`apps/cli/src/branding.ts`'s `ENV_PREFIX`) must work identically whether it
was started via `appctl login` or `appctl node enroll`, and a second,
node-specific pair of env vars for the exact same two facts would be a
second thing every deployment guide and every compose file has to remember
exists.

## 9. The `NodeEngine` loop is a continuous top-up pool, not a batch drain

The obvious way to write a worker's claim loop is: claim up to
`concurrency` jobs, `await Promise.all(...)` on all of them, then claim
again. This is a **batch barrier**, and it is wrong for the same reason
[Job Queue §7](job-queue.md#7-the-worker) rejects it on the server side:
with jobs of mixed duration, effective concurrency collapses toward
whichever job in the batch takes longest, because every slot that finished
early sits idle waiting for the slowest sibling before the loop claims
anything new. A worker configured for concurrency 8 that happens to draw
one 20-minute video-processing job alongside seven 5-second jobs spends most
of its 20 minutes running at effective concurrency 1.

The correct shape is a **continuous top-up pool**: re-read the configured
concurrency cap on every pass (so `set-concurrency`, delivered live via
`heartbeat`'s response, takes effect without restarting the process), claim
*only* the number of currently-free slots, and dispatch each claimed job
**without awaiting the batch** — each slot's own async chain independently
claims its next job the instant its current one finishes, with no
coordination against its siblings' progress at all.

Per claimed job, the loop:

1. Starts a lease-renewal ticker calling `POST /:id/jobs/:jobId/renew`
   before `leaseExpiresAt` would otherwise pass.
2. Streams any large input to a temp file rather than buffering it in
   memory (relevant when [Worker Nodes](worker-nodes.md) supports
   node-eligible handlers whose payload references a presigned download
   URL — [§1](#1-security-model-first)).
3. Runs the handler's node-side compute.
4. Submits the result (or reports failure — [§6.1](#61-result-ingestion-in-order)),
   the **one** place rate-limit classification happens on the node's own
   side, forwarding `{ rateLimited, retryAfterMs }` so the server's terminal
   state machine ([Job Queue §6](job-queue.md#6-the-terminal-state-machine))
   can apply the correct backoff even though the failure originated on a
   machine the server does not otherwise observe directly.
5. Cleans up any temp file in a `finally` block, unconditionally.

## 10. The daemon: pidfile, IPC socket, and the write-backlog guard

`appctl node start --daemon` detaches into a background process, tracked by
a **pidfile** and reachable over a **Unix-domain-socket NDJSON IPC channel**
(a named pipe on Windows) so `stop`/`status`/`logs`/`set-concurrency` can
talk to an already-running daemon without re-attaching to its stdout. Both
the pidfile and the socket are created `0600`, and both paths include
stale-instance detection — a pidfile pointing at a pid that is not this
daemon (or not running at all) is treated as leftover from an unclean
shutdown, not as evidence a live instance already exists.

**A write-backlog guard destroys any IPC client whose outgoing buffer
(`writableLength`) exceeds roughly 1 MiB.** This exists because a client
that stops reading does **not** make the daemon's `socket.write()` calls
fail — Node buffers unsent bytes on the heap indefinitely, growing without
bound as long as the daemon keeps producing events nobody on the other end
is consuming. A single `appctl node logs --follow` invocation left running
in a terminal that was closed without cleanly disconnecting is exactly the
scenario this guards against: without the backlog cap, a long-running
daemon can be slowly starved of memory by a client that is no longer even
listening.

Logging is **JSONL with rollover** and **recursive redaction** — every log
value is checked, recursively through nested objects, against a pattern
matching credential-shaped keys: `/^pat$|token|api[-_]?key|apikey|secret|
credential|password/i`. The pattern is deliberately anchored (`^pat$`,
exact) rather than a bare substring match, so ordinary and entirely
harmless keys like `path` or `pattern` are not falsely redacted just for
containing `pat` as a substring. Redaction matters specifically for this
daemon because engine events routinely carry presigned URLs — which are, by
construction, bearer capabilities over object storage
([§1](#1-security-model-first)) — and a log file is exactly the kind of
artifact that outlives the moment it was written and ends up copied,
attached to a support ticket, or committed by accident.

## 11. Memory hardening

A long-running worker process is expected to run for days or weeks between
restarts, on hardware whose memory budget the operator, not this codebase,
controls. Three mechanisms work together:

- **A re-exec shim** raises `--max-old-space-size` above Node's default
  ceiling for the actual worker process, since that flag can only be set at
  process start. The shim **forwards every signal** to the child and
  **re-raises the child's own terminating signal** on exit — so a
  supervisor watching the shim's process still sees the true cause of
  death (SIGKILL from an OOM-killer, SIGTERM from an orchestrator), and
  Ctrl-C / SIGTERM still drains and exits cleanly rather than being
  swallowed by the shim layer.
- **A watchdog** samples heap usage on an interval and fits a least-squares
  trend line to recent samples, surfacing a genuine "growing without bound"
  signal (MB/hour) distinct from ordinary sawtooth GC noise a naive
  instantaneous-reading check would misread as a leak.
- **A pre-OOM valve** writes a heap snapshot **before** draining in-flight
  work and exiting, once heap usage crosses a configured fraction of the
  process's heap limit. The **ordering is the entire point**: V8's own
  built-in near-heap-limit snapshot hook fires *above* this threshold, so a
  worker hardened with only that built-in mechanism recycles cleanly,
  forever, every time it approaches the limit — and the retainer causing
  the growth can **never be named**, because the process always restarts
  before V8's own hook would ever fire. Firing the snapshot deliberately
  earlier, from application code, is what actually produces a diagnosable
  artifact instead of an endlessly self-healing symptom.

This whole mechanism assumes a supervisor with a restart policy — a
container orchestrator, a systemd unit, `appctl node service install`'s own
managed unit. A worker that exits cleanly after a pre-OOM drain, with
nothing configured to bring it back, is a worker that has simply stopped.

## 12. Container image and compose

The worker container is built from **`node:24-alpine`**, matching the API's
own base image (`apps/api/Dockerfile`). This is worth stating explicitly
because it is a real point of contrast with a media-heavy application that
might build this same kind of worker image on Debian: **this template's
worker has no native ML runtime forcing a glibc base, and no ffmpeg/model
layers to install** — its job-eligible handlers are whatever a fork of this
template adds, not a fixed catalog of compute-heavy media pipelines. The
image stays small because there is, as of this repository, genuinely
nothing heavy to put in it; a fork that adds node-eligible handlers with
real native dependencies inherits the choice of base image as *their*
decision to revisit, not one this document should make on their behalf.

The `ENTRYPOINT` is **exec-form** (`["node", "dist/worker.js"]`, never the
shell form `CMD node dist/worker.js`), so `SIGTERM` from `docker stop`
reaches the Node process directly as PID 1 rather than being swallowed by an
intermediate shell — the same reasoning any container running a
long-lived, gracefully-shutting-down process must follow, and the reason
the headless drain-on-signal path in [§8](#8-the-cli-worker-appctl-node-)
only works at all if the signal is delivered where the code is actually
listening for it.

`infra/compose/worker.compose.yml` adds one service, keyed `worker`, meant
to be run alongside `base.compose.yml` the same way `dev.compose.yml` or
`otel.compose.yml` layer on today. Scaling is `docker compose ... --scale
worker=N`: **each replica registers as its own node** ([§4.1](#41-register-or-reattach)
handles the reattach case for a restarted replica, not for N *simultaneous*
identically-named replicas — those need distinct names, e.g. derived from
the container's own hostname) and the fleet load-balances purely through
`SKIP LOCKED` contention on the shared queue, with **no coordination
between replicas at all** — no leader election, no work partitioning, no
replica ever needing to know another one exists.

A third build target is added to `.github/workflows/deploy.yml`, reusing
the existing `IMAGE_NAME: ${{ github.repository }}` convention this
workflow already applies to the API and web images, rather than inventing a
separate naming scheme for the worker image.

## 13. The branding guard

This template's identity seams — `packages/shared/index.js`'s `APP_NAME`
and `apps/cli/src/branding.ts`'s `CLI_NAME`/`ENV_PREFIX`/`envVar()` — exist
so a fork can rename the product in a small, fixed number of places. A
worker container's Dockerfile and compose file are exactly the kind of
artifact that can quietly drift from those seams: an env var hard-coded as
`APPCTL_CONCURRENCY` in a compose file survives a rename to
`ACMECTL_CONCURRENCY` perfectly well as *text*, and simply stops being read
by anything, silently, the moment the CLI itself is renamed.

The guard is modelled directly on the existing
`apps/api/test/production-image.spec.ts` pattern — read the Dockerfile
(and, here, the compose file) as **text**, and assert a rule against it —
and is **bidirectional**:

1. **Every `WORKER_ENV` value is present, verbatim, somewhere in the
   Dockerfile or compose file.** This catches the direction where a
   variable the code reads was renamed (a CLI rename, or a variable
   suffix edited) but the deployment artifact that sets it was not updated
   to match.
2. **Every prefix-matching token found in those files is a member of
   `WORKER_ENV`.** This catches the opposite direction: someone hand-adds
   an environment variable to the compose file that *looks* like it belongs
   to this CLI (it starts with the right prefix) but that no code actually
   reads — a variable an operator could set, in good faith, that silently
   does nothing.

The prefix the test scans for is **built from `ENV_PREFIX`
(`apps/cli/src/branding.ts`), never written as a literal `"APPCTL_"` string
in the test itself** — a test that hard-coded the literal would itself
become exactly the kind of drift-on-rename bug this guard exists to catch.

## 14. Permissions and settings reference

| Permission | Meaning |
|---|---|
| `nodes:read` | List/read the caller's own worker nodes; view node credentials (masked). |
| `nodes:write` | Register/deregister/heartbeat/claim/renew/submit as a node; mint or revoke the caller's own `nod_` credentials. |

These are **split from `jobs:read`/`jobs:write`**, deliberately, following
this repository's own Settings UI Pattern rule that a settings card's
`permission` field must be the exact string its controller enforces, never
an approximation borrowed from an adjacent feature. A user capable of
registering worker nodes and a user capable of retrying/deleting queue rows
are answering two different questions ("can this deployment's compute
fleet change shape" vs. "can this deployment's background work be
administered"), and collapsing them into one permission would force every
future admin-role design in this template to grant both whenever either was
actually needed.

| Setting / env var | Default | Meaning |
|---|---|---|
| `NODES_STALE_HEARTBEAT_SECONDS` | 60 | The base window a node's heartbeat is expected inside of; drives both the fleet dashboard's "stale" indicator and the offline sweep's multiplier ([§7](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming)). |
| `NODES_OFFLINE_STALE_MULTIPLIER` | 10 | How many consecutive stale windows of silence before the sweep marks a node `offline`. |
| `NODES_OFFLINE_RETENTION_DAYS` | 14 | Days an `offline` node with nothing currently `running` survives before the daily prune deletes its row. |

## 15. What was deliberately dropped, and why

Two mechanisms exist in comparable prior art for a distributed-worker
design and are **deliberately absent here**, because both exist only to
serve compute this template does not have:

- **Per-job provider-credential brokering** — minting a transient,
  per-job third-party API credential a node holds only for the duration of
  one compute call. This exists elsewhere to let a node call an AI/vision
  provider's HTTP API directly for a specific job without ever holding a
  standing credential. This template ships no such provider integration —
  it has no built-in job type that calls out to a third-party AI or vision
  API at all. The mechanism would be pure unused surface area today; a fork
  that adds a node-eligible handler needing exactly this can add the
  brokering endpoint alongside it, following the same
  `assertJobHeldByNode`-gated, per-job, time-boxed shape this document's
  other job-scoped endpoints already establish, rather than this template
  shipping speculative infrastructure with nothing to authorize.
- **An ML model manifest endpoint** — a list of model files/versions
  (sha256, byte size) a node should have locally to serve its
  `eligibleTypes`, for a deployment whose node compute depends on
  downloadable model artifacts (face detection, CLIP embeddings, and
  similar). This template has no built-in compute of that shape either.
  Its absence is not a gap to fill later so much as a reflection of what
  this template actually is: a foundation a fork extends with its own job
  types, which may or may not ever need a model manifest at all.

## 16. Rejected alternatives

- **Authenticating a worker with a plain PAT.** A leaked worker credential
  would grant everything its owning user can do, admin routes included —
  [§2](#2-nod_-credentials).
- **Scoping/narrowing PATs generally, instead of a separate `nod_` family.**
  A bigger, more invasive change to an existing, widely-used credential type
  for one concrete use case; a new, narrowly-scoped credential family that
  is *structurally* incapable of reaching anything outside `/api/nodes/*`
  is a smaller, more legible change with a smaller blast radius if it is
  ever gotten wrong.
- **A batch-drain claim loop (`claim N`, `await all N`, repeat) in the CLI
  engine.** Collapses effective concurrency toward the slowest job in the
  batch — [§9](#9-the-nodeengine-loop-is-a-continuous-top-up-pool-not-a-batch-drain).
- **Pruning offline nodes before sweeping stale ones to `offline`.**
  Reproduces the exact silent-retention-void bug this document names —
  [§7](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming).
- **A single fixed duration for "offline after N seconds of silence,"
  independent of the stale-heartbeat window.** Lets the dashboard's "stale"
  notion and the database's `offline` notion of liveness drift apart —
  [§7](#7-fleet-lifecycle-and-an-ordering-bug-worth-naming).
- **Shipping per-job credential brokering and a model manifest on day
  one.** Both exist to serve compute this template does not ship —
  [§15](#15-what-was-deliberately-dropped-and-why).

## 17. Open questions for the child issues

- **Exact IPC wire format** for the daemon's NDJSON channel
  ([§10](#10-the-daemon-pidfile-ipc-socket-and-the-write-backlog-guard)) —
  this document fixes the socket's security posture (`0600`, backlog guard,
  stale-instance detection) and its redaction rule, not its literal
  message schema.
- **Whether `appctl node service install` targets systemd only**, or also
  ships a documented manual-start path for platforms without it (mirroring
  how a comparable CLI worker in prior art documents a WSL/Windows
  fallback) — left to issue #278/#279's own scope.
- **Whether the branding guard ([§13](#13-the-branding-guard)) lives as a
  spec inside `apps/api/test/` (alongside `production-image.spec.ts`) or
  inside `apps/cli/`**, given it inspects both a Dockerfile this repository
  builds from the API's own workspace conventions and a compose file under
  `infra/compose/` — either location satisfies the rule; this document
  does not mandate one.
