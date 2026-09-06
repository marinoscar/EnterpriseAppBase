# Worker Nodes

> Issues #267, #268 and #269, epic #254. The schema — `WorkerNode`, `NodeCredential`,
> the `NodeStatus` enum and the `Job.claimedByNode` relation deferred by #255 —
> lives in `apps/api/prisma/schema.prisma`, whose block comments carry the
> per-column reasoning and are not restated here.
>
> **Part one (§1–§7)** is the credential a node authenticates with and the
> boundary that keeps it from being able to do anything else:
> `apps/api/src/nodes/node-credential.service.ts`, its controller and module,
> and the `Bearer nod_` branch in
> `apps/api/src/auth/guards/jwt-auth.guard.ts`.
>
> **Part two (§8–§14)** is the control plane those credentials reach —
> register, heartbeat, claim, lease renewal, result and failure —
> `apps/api/src/nodes/nodes.service.ts`,
> `apps/api/src/nodes/nodes.controller.ts`,
> `apps/api/src/nodes/nodes.module.ts` and
> `apps/api/src/nodes/dto/node-control-plane.dto.ts`.
>
> **Part three (§15–§22)** is the data plane — how a node with no storage
> credentials reads input bytes and writes output bytes — plus the reference
> node-eligible job type that makes the whole fleet reachable end to end:
> `apps/api/src/nodes/node-data-plane.service.ts`,
> `apps/api/src/nodes/dto/node-data-plane.dto.ts`,
> `apps/api/src/storage/storage-job-input.ts`,
> `apps/api/src/jobs/handlers/example-checksum.handler.ts` and
> `apps/api/src/jobs/contracts/`.
>
> The fleet lifecycle cron (liveness, pruning, auto-drain) is **#270** and is
> not described here.

A worker node is a process on a machine the deployment may not own, running
unattended for months, that pulls jobs off this API's queue and reports
results back. Before it can do any of that it has to authenticate. This
document is about the credential it authenticates with, and about one
decision in particular:

**a node credential is not a personal access token, and the difference is a
route allowlist enforced in the authentication guard.**

## 1. Why a node credential is not a PAT

The tempting answer is that a node is just another automated client, and this
API already has a token family for automated clients. Mint the worker a
`pat_`, put it in the config file, done. That answer is wrong, and it is
wrong in a way that only becomes visible after a leak.

**A PAT carries its owner's full authority, deliberately and by documented
promise.** `JwtAuthGuard` resolves a `pat_` token through
`PatService.validateToken` into the owning `AuthenticatedUser` and hands it to
`RolesGuard` and `PermissionsGuard` exactly as the JWT strategy would.
`src/openapi/description.ts` publishes that as a universal claim — a PAT works
on every authenticated route, with no narrower scope — and
`test/auth/pat-universality.integration.spec.ts` exists specifically to keep
it true. That is the correct design for a PAT: a human deliberately delegating
their own authority to a script they control and can revoke.

Now put the same token in a node's config file. Three facts compound:

1. **The owner is an admin.** `nodes:write` is granted to Admin only in
   `prisma/seed-data.ts`, alongside `jobs:*` and `db_backup:*`, for the
   reasons recorded there — the queue and the fleet are operational surfaces
   that expose payload metadata, host names and the shape of the deployment.
   So whoever can mint a node credential is an administrator, and any token
   resolving to them resolves to an administrator.
2. **The credential lives somewhere weak.** A config file on a spare box, a
   `.env` in someone else's cluster, a container image, a machine nobody has
   patched since it was set up. This is not a criticism of operators; it is
   what "unattended worker" means.
3. **Nobody is watching.** A PAT belongs to a person who notices when
   something is odd. A node credential belongs to a process, and the first
   symptom of misuse is whatever the attacker chooses to make the first
   symptom.

Together those make "a leaked worker token" and "a leaked admin session" the
same event. `PATCH /api/users/{id}` to grant an account a role,
`PUT /api/system-settings`, the allowlist, the backup restore — all reachable,
all with a token whose whole job was to poll for work.

So `nod_` is a **separate token family** with its own table, its own prefix
and its own rules. The blast radius of a leak becomes "can pretend to be a
worker" — which is bad, and bounded, and observable in the fleet listing —
instead of "owns the deployment".

`NodeCredential` otherwise mirrors `PersonalAccessToken` closely and on
purpose: same 32 bytes of `randomBytes` entropy, same sha256-at-rest, same
short display prefix, same show-the-raw-value-exactly-once contract, same
fire-and-forget `lastUsedAt`. Reading `node-credential.service.ts` beside
`pat.service.ts` should make every divergence obvious, because there is
exactly one (§4).

## 2. The allowlist lives in the guard, not the service

A `nod_` token is confined to `/api/nodes` and paths beneath it. Everything
else is `403`. That check is in `JwtAuthGuard`, not in
`NodeCredentialService`, and the split is not arbitrary.

**The guard is where route identity exists.** It has the request. It runs
before any handler. It already owns the equivalent decision for the `pat_`
family (namely "no restriction"), so the two families' rules sit side by side
where they can be compared.

**The service has more than one caller.** `validateToken` answers exactly one
question — is this string a live credential, and whose — and returns an
`AuthenticatedUser` or `null`. The guard calls it today; #268's control plane
may well want to resolve a credential outside an HTTP request. A service that
also enforced a route rule would need a URL passed into a function about
credential liveness, or the rule duplicated at each call site. A security rule
that exists in two places is a security rule that will eventually disagree
with itself, and the disagreement will be discovered by whoever exploits it.

### 2.1 The match is a prefix boundary, not `startsWith`

The rule is: the path (query string stripped) is **exactly** `/api/nodes`, or
begins with `/api/nodes/`. A bare `startsWith('/api/nodes')` would also admit
`/api/nodesX`, `/api/nodes-other`, and — the one that actually matters — any
future route somebody names `/api/nodes…` without reading this file. All three
are enumerated as test cases rather than left implicit.

The URL is read as `originalUrl ?? url`, covering both adapters (Fastify
exposes the full path on `url`; Express rewrites `url` under a mounted router
and preserves the real path on `originalUrl`), and a request with no
resolvable URL is **refused**. An allowlist that cannot classify a request
must fail closed.

The check reads the raw path rather than Nest's route metadata
(`context.getHandler()` / `getClass()`) on purpose: gating on "is this the
nodes controller" would make the answer depend on a decorator #268 has not
written yet, and any controller that forgot the marker would silently be open
or closed depending on which default was chosen. A path is a fact about the
request that exists before routing and cannot be accidentally omitted.

### 2.2 `/api/node-credentials` is deliberately **not** on the allowlist

A `nod_` token cannot reach even its own management surface. That looks like
an oversight until it is named: **self-management is credential minting.** A
worker token that could call `POST /api/node-credentials` could mint a second
credential with no expiry, and a third, none of which the operator asked for
and none of which revoking the leaked one removes. Revocation would stop being
a control — it would be whack-a-mole against a token that can regrow.

Managing node credentials therefore requires a real session or a `pat_` token:
a human, or a human's deliberate automation.

## 3. The allowlist check runs **before** validation

Inside the `nod_` branch the order is fixed:

```ts
if (!this.isNodeRoute(request)) throw new ForbiddenException(...);
const user = await this.nodeCredentialService.validateToken(token);
```

Both orderings return the same `403` to the caller, so this is invisible from
outside — which is exactly why it is written down and asserted with a spy.
Validating first would be wrong twice over:

**It leaks token liveness through `lastUsedAt`.** `validateToken` stamps
`lastUsedAt` fire-and-forget on every success. A stolen credential probed
against `/api/users` would therefore leave a fresh timestamp in the operator's
own credential listing. The probing request is refused, so the attacker learns
nothing from the response — but anyone who can read that listing learns the
token is still good, and the operator's "is this node still alive, is this
credential safe to revoke" column now reflects probe traffic instead of a
working node. The one signal an operator has for deciding what to revoke would
be written by the person they are trying to revoke.

**It does needless database work on a refused request.** An indexed lookup
plus an `include` of roles and permissions, plus a write, spent on a request
that was never going to be allowed — on the authentication path, for an
unauthenticated caller. Rejecting on route identity alone needs no I/O and
leaks nothing: the answer is identical for a real credential, a revoked one,
and a string somebody made up.

## 4. `expiresAt` is nullable — the one divergence from PAT

`PersonalAccessToken.expiresAt` is **required**. `NodeCredential.expiresAt` is
**nullable**, and `null` is a real, supported, expected value meaning "never
expires; authenticate until revoked". The full reasoning is in the schema
comment; the short form:

A PAT's forced expiry is a reasonable nudge toward rotation because a human is
around to notice it expired and mint a new one. A node credential
authenticates a process on a machine nobody is watching. A mandatory expiry
there does not produce rotation — it produces **an entire fleet going dark at
3am because a timer nobody scheduled fired**. The worker cannot heartbeat,
cannot claim, cannot report results, and the first anyone learns of it is jobs
silently piling up unclaimed while every row in the database still looks
perfectly healthy.

That failure is worse than a long-lived credential precisely *because* of §2:
the credential's blast radius is already confined to `/api/nodes/*`. The thing
a mandatory expiry protects against — a leaked token carrying the owner's full
authority — is the thing the allowlist already removed. Paying for it twice,
in fleet outages, buys nothing.

**Revocation is the actual control**, and it is immediate: `revokedAt` is
re-read from the row on every authentication, so nothing is cached and there
is no TTL to wait out. An operator who wants an expiring node credential can
still set `expiresInDays`; it is simply not forced.

The inversion this creates — treating `expiresAt: null` as "expired at the
epoch" — is the single most damaging bug this service could contain, which is
why it has its own test group at both the unit and integration level.

## 5. Permissions on `/api/node-credentials`

| Operation | Permission |
| --- | --- |
| `POST /api/node-credentials` | `nodes:write` |
| `GET /api/node-credentials` | `nodes:read` |
| `DELETE /api/node-credentials/{id}` | `nodes:write` |

Create and revoke are `nodes:write` because both change which machines can
authenticate to this deployment.

The listing is `nodes:read` and **not** a bare `@Auth()`, which is what the
equivalent PAT listing uses. Two reasons:

* The Settings UI Pattern (CLAUDE.md rule 3) requires a settings card's
  `permission` to be the exact string the controller enforces. A Workers
  surface is gated on `nodes:read`/`nodes:write` — `src/openapi/tags.ts`
  already publishes that claim. An ungated listing would make the hub and the
  API disagree about who can see it, and the hub would be the one lying.
* A PAT listing is a personal convenience; a node credential listing is
  **fleet inventory**. It answers "which credentials can attach a machine to
  this deployment, when was each last used, which are still live" — an
  operational question about the deployment, not a private one about the
  caller.

`nodes:read` rather than `nodes:write` for the listing because a role that may
audit the fleet without being able to mint new access to it is a distinction
worth expressing — that is the entire reason the permission pair is split
(`common/constants/roles.constants.ts`).

Ownership on revoke is folded into the lookup
(`findFirst({ where: { id, userId } })`) rather than checked after a
`findUnique`, so "not yours" and "does not exist" are literally the same code
path and cannot be told apart from outside. A caller who could distinguish
them could enumerate other users' credential IDs.

## 6. `NodeCredentialModule` is `@Global`, and separate from #268's nodes module

It imports `PrismaModule` and nothing else, mirroring `PatModule` exactly.

**`@Global`** because `JwtAuthGuard` is instantiated everywhere `@Auth()`
appears — nearly every feature module — and now injects `NodeCredentialService`
alongside `PatService`. Without it, every one of those modules would need an
explicit import, and a module that forgot would fail at boot with a DI error
naming a guard rather than the missing import. `PatModule` solved the identical
problem the identical way; the guard's two dependencies behaving differently
would be a trap.

**Separate from the nodes module #268 will add** because that module brings
real weight: the jobs services, settings, config, the clock. Putting all of
that behind a guard that runs on every authenticated request would very likely
create a cycle — a nodes module depending on the jobs module, whose
controllers use `@Auth()`, whose guard depends on the nodes module — which
Nest reports at boot and which is always "fixed" under pressure with
`forwardRef`, making the cycle invisible rather than absent. The split is by
**dependency weight**, not by topic: same directory so the relationship is
obvious, different modules so the graph stays acyclic.

## 7. Interaction with maintenance mode

`MaintenanceGuard.OPAQUE_BEARER_PREFIXES` already lists both `pat_` and
`nod_`, so a node credential never receives the `allowAdmins` bypass during a
maintenance window — even though its owner is an admin. That is deliberate and
predates this issue: opaque bearers carry no claims, resolving one would cost
a database round trip on a guard that runs for every request during a window
in which the database may be exactly what is being worked on, and they belong
to unattended clients, which are the callers that most need to back off. See
[`docs/specs/maintenance-mode.md`](maintenance-mode.md) §2.

`maintenance.guard.spec.ts` asserts that `OPAQUE_BEARER_PREFIXES` contains the
`NODE_TOKEN_PREFIX` constant the service actually mints, rather than a
hand-copied `'nod_'` — three files have to agree on that string (the service
mints it, `JwtAuthGuard` routes on it, `MaintenanceGuard` refuses it the
bypass), and renaming it in one place would not break a compile: the token
would simply stop matching and silently regain the bypass.

---

# Part two: the control plane (#268)

## 8. The constraint everything else follows from

**A node has no database access and no storage credentials.** Every fact it
needs arrives in an HTTP response; every fact it produces is validated before
it is trusted. It is *authenticated* — a `nod_` credential resolves to its
owning user — but it is not *trusted* the way an in-process caller is: it runs
unattended on a machine this deployment may not own, its configuration is
editable by whoever holds that machine, and it may be running an older build
than the server it is talking to.

That is why the request bodies are as tight as they are (a node's
`concurrency` becomes a claim limit, so it is bounded), why the result path
parses against a schema before anything is written, and why the two guards in
`NodesService` are authoritative rather than a courtesy the controller extends.

It is also why this is the point at which the queue gains a **second
executor** — and why almost nothing about executing a job lives in this
module.

Every write route (`register`, `deregister`, `heartbeat`, `claim`, `renew`,
`result`, `failure`) is `nodes:write`; the two reads (`GET /api/nodes`,
`GET /api/nodes/{id}`) are `nodes:read`, the same split and the same reasoning
as §5. Claiming is a **write**: it takes rows and marks them running, even
though a node operator may think of "get me work" as a read.

One consequence is worth knowing before adding a route to `NodesController`:
everything mounted under `/api/nodes` is reachable by a `nod_` credential, by
§2. That is the intended blast radius, and it means a route added there is a
route an unattended, months-old credential on somebody else's box can call.

## 9. The node reuses the queue's machinery; it does not acquire its own

`NodesService` calls `JobClaimService.claim({ executor: 'node', nodeId, … })`
and `JobTerminalService.completeSucceeded` / `completeFailed`. Both services
were written with this caller in mind — `ClaimOptions` has carried `nodeId`
and `executor` since #260 precisely so there would be one claim statement, and
`CompleteFailedOptions` has carried `rateLimited`/`retryAfterMs` since #261
precisely so a node could report as *data* what an in-process handler reports
by *throwing*.

The lease length is derived, not negotiated: `resolveJobLeaseMs` in
`job.worker.ts` is the single derivation both executors read, extracted in
#268 for the same reason `resolveWorkerConcurrency` was extracted in #265 —
a second caller appeared, and two derivations of one number drift.

So the node plane's own logic is: *who is asking*, *what may they have*, and
*is what they sent real*. Everything after that is the queue's.

## 10. Register is idempotent on `(owner, name)`

Find → reattach if present, else create; on a `P2002` from a concurrent
replica, re-read and reattach. Reattach refreshes hostname, platform, CLI
version, eligible types and concurrency, and brings the node back `online`.

**The failure this prevents is invisible while it happens.** Without
idempotence, every restart of a worker container — a deploy, an OOM kill, a
host reboot — leaks a new `worker_nodes` row. Nothing errors. Within a week
the fleet listing is a list of ghosts and the operator cannot tell which row
is the machine currently doing work. `@@unique([createdById, name])` exists
for this, which is also why a node's name belongs in its config file rather
than being generated at startup.

Two refinements are worth stating because neither is obvious from the shape:

* **A fresh heartbeat warns but proceeds.** If the existing row heartbeated
  seconds ago, two processes may genuinely be claiming one identity — but the
  overwhelmingly common cause is a container recreated before its last
  heartbeat aged out. Refusing would turn the *normal* restart into a startup
  failure on an unattended machine, whose only recovery is to wait or to
  invent a new name (leaking the row idempotence just avoided). The documented
  policy is **last-writer-wins**, with a log line naming both hosts.
* **`disabled` survives a re-registration.** Everything else is overwritten and
  the status returns to `online`, but an operator's kill switch is not cleared
  by the process being switched off — otherwise `docker restart` defeats it.
  `draining` is *not* preserved, deliberately: draining means "finish what you
  are holding", and a re-registered process holds nothing.

The same asymmetry governs `heartbeat`: a node may report `online` or
`offline` about itself and may never report — or clear — `draining` or
`disabled`, which are operator state.

## 11. Claim: three filters, and two behaviours worth recording

The requested types are intersected with the node's registered
`eligibleTypes`, so **a node can only ever narrow, never widen**. The claim
request is the one input a compromised or misconfigured worker fully controls;
if it could widen, registration would stop meaning anything.

The limit is clamped down to the node's declared `concurrency`, **read live
off the row** — never a value captured at registration — which is the entire
mechanism behind "a runtime `set-concurrency` takes effect on the next claim".
A larger requested limit is capped rather than refused: a node asking for more
than it declared is describing slots it does not have, and failing the call
would stall a fleet over an arithmetic disagreement.

Two behaviours beyond that are worth recording because they are decisions, not
consequences:

* **Types no node could run are dropped too.** A type is node-eligible only
  when its handler carries both `nodeResultSchema` and `persistNodeResult`
  (§2 of [job-queue.md](job-queue.md), and `job-handler.interface.ts`). Letting
  a node claim a server-only type produces a loop: it computes something this
  server cannot store, its result post is refused, the lease expires, the
  reaper requeues, and the node claims it again — burning an attempt per lap
  and looking, from the queue's side, like a job that keeps failing for no
  reason. Dropping the type with a warning naming it makes the
  misconfiguration visible instead of expensive.
* **`disabled` is `403`; `draining` is an empty list.** A disabled node's
  answer will not change by polling, so it is an error. A draining node is in
  a normal state with a normal instruction, and it must keep heartbeating and
  renewing leases while it finishes — teaching it that this endpoint is
  failing would be wrong.

Note that a claim deliberately does **not** stamp `lastHeartbeatAt`. Liveness
has exactly one writer, so "when did we last hear from this node" stays a
question about a column one route moves.

## 12. The lease check is what makes a late submission harmless

`assertJobHeldByNode` demands four things — claimed by *this* node, `running`,
with a lease, and that lease unexpired — and it is reused by `result`,
`failure` and `renew`.

The scenario it exists for is ordinary: a node's machine sleeps, its lease
expires, the reaper (#263) requeues the job, another executor claims it and
starts running — and then the original node wakes and posts the result it
computed twenty minutes ago. Without the check, that result is persisted over
a newer run: `persistNodeResult` writes stale output, `completeSucceeded`
marks a row terminal that another executor is actively working on, and that
executor's own terminal write lands afterwards on a job it no longer owns. The
damage is a permanently wrong stored result and a duplicated side effect, with
nothing in any log tying the two together.

The renewal re-asserts the same conditions **inside the `WHERE` clause of its
own write**, because the window between reading the row and updating it is
small and real, and a renewal landing inside it would keep the reaper away
from a run that is no longer this node's.

## 13. Result ingestion, in exactly this order

1. `assertJobHeldByNode` — §12.
2. **400** if the posted `type` does not match the job's. It is redundant with
   the row, which is the point: a node holding two jobs and crossing their ids
   would otherwise post job A's result against job B, and the only thing
   standing between that and a persisted, plausible, permanently wrong row
   would be whether B's schema happened to reject A's payload. Two ids
   agreeing is a coincidence; an id and a type agreeing is a statement.
3. **400** if the handler carries no `nodeResultSchema`/`persistNodeResult`
   pair ("not node-persistable").
4. `handler.nodeResultSchema.parse(body.result)` in a `try`/`catch` → a clean
   **400** with the issues in `details`. **A manual parse, not the global
   pipe**: which schema applies is not known until the job row has been read,
   so no decorator can express it. `details` is where the issues go because
   `http-exception.filter.ts` rebuilds every error body from a fixed key
   allowlist — a custom field anywhere else vanishes on the way out.
5. `handler.persistNodeResult(job, parsed)`. **On throw: route through
   `completeFailed` and answer 500.** Once the server has begun persisting it
   owns the row's lifecycle, so the failure belongs in the ordinary retry
   machine (backoff, attempt budget, a readable `lastError`) exactly as an
   in-process handler's throw would be. The 500 tells the node "this is ours,
   not yours" — and the job is no longer `running` by then, so a resubmission
   would be refused anyway.
6. `completeSucceeded`.

A **failure** submission passes `{ rateLimited, retryAfterMs }` straight into
`completeFailed`, which treats them identically to a thrown `RateLimitError` —
down to tripping this server's own throttle gate, because a provider does not
care which machine its 429 was sent to.

## 14. Deliberately not ported from the source application

Two things exist in the application this design was extracted from and are
**not** here, both because they serve ML compute this template does not have:

* **Per-job provider-credential brokering.** There, the control plane mints a
  short-lived provider credential per claimed job and hands it to the node.
  Porting it would ship an unused secret-distribution path — the most
  expensive kind of code to carry unused, because it looks load-bearing to
  everyone who reads it later and nobody can safely delete it. A fork that
  needs it adds it where the claim response is built, next to #269's presigned
  URLs, which is the same seam.
* **The model manifest.** A published list of model versions the fleet must
  agree on, so a node does not compute against a model the server will reject.
  It is a real problem in that domain and not a problem in a template with no
  models.

The presigned data-plane IO — how a node reads an input object and writes an
output object with no storage credentials of its own — is **#269**, and it is
still deliberately absent from `params`: the URLs are minted on demand by the
two routes in §15 rather than folded into the claim response, for the reason
§18 gives. `params` stays a separate bag from `job` regardless, so that a
server-minted value is never mistaken for a column.

# Part three: the data plane (#269)

## 15. Bytes never pass through the API

A node holds **no storage credentials**, permanently and by design (§8). It
therefore cannot read the object a job is about, and cannot write one. Two
routes close that gap, both behind the same `assertJobHeldByNode` the control
plane uses:

| Route | What it mints |
|---|---|
| `POST /api/nodes/{id}/jobs/{jobId}/download-url` | a short-lived signed **GET** for the job's input object |
| `POST /api/nodes/{id}/jobs/{jobId}/upload-url` | a short-lived signed **PUT**, to a key **the server chose** |

The node then talks to the storage provider **directly**. No object payload
enters the API process, and no storage credential leaves it. Both are
`nodes:write`: minting a signed URL hands out a capability against storage and
is scoped by a lease the node must be actively holding, which is not the shape
of anything a read-only auditor should be able to do.

They are `POST` rather than `GET` even though they read nothing, because they
**mint a credential**. A `GET`'s URL is what every layer between the server and
the node writes down — proxy access logs, a CDN cache key, an APM trace's
endpoint label — and a response body containing a bearer URL has no business
being cacheable.

**The expiry is bounded and not negotiable.** `storage.signedUrlExpiry`
(default one hour) is honoured when it is *stricter* and clamped to 15 minutes
when it is not, with a 60-second floor so a `SIGNED_URL_EXPIRY=0` typo cannot
take a whole fleet down. The reasoning is the asymmetry: an hour is right for a
URL handed to a logged-in person's browser and wrong for one handed to an
unattended process on hardware this deployment may not own. A node that needs
longer asks again, which costs one request while it holds the lease. There is
deliberately no node-only environment variable — a second knob is a second
thing to get wrong, and its only correct values are already inside that range.

**The URL is never logged**, at any level, by any component: the storage
provider names the key only, `NodeDataPlaneService` names the job and the
object, and `LoggingInterceptor` records method, url and duration — never a
response body. `test/nodes/node-data-plane.integration.spec.ts` asserts that
across a real request, because it is a property of the whole pipeline rather
than of one service.

## 16. The download is resolved through an *internal* path

`ObjectsService.getDownloadUrl` exists and is deliberately **not** used. It
applies a per-user ownership check, because its caller is a person asking for
their own file over the interactive API. A node is not that.

Applying that check here would not add safety — it would add a bug. The user a
`nod_` credential resolves to is the node's **owner**, the operator who
registered the machine, who has no relationship to whoever uploaded the object
a job happens to be about. Every job over another user's upload would fail with
a `403` that is simply wrong, and a fleet would appear to work perfectly right
up until the first cross-user job.

The posture is exactly the in-process worker's: when `JobWorker` runs a
handler, that handler calls `storageProvider.download(key)` with no ownership
check at all, because a background job is not acting on behalf of a user. A
node is the same executor on different hardware, and giving the two different
access rules would make a job's outcome depend on which one claimed it. **What
bounds a node is the lease, not ownership**: it may read exactly the input of
exactly the job it is holding, for exactly as long as it holds it.

`NodesModule` imports `StorageProvidersModule` rather than `StorageModule`
partly for this reason — not importing the module is what keeps the wrong
method out of reach.

## 17. The server chooses the upload key

`node-outputs/{jobId}/{uuid}`, derived from a path parameter the router
already validated as a UUID plus a fresh `randomUUID()`. Nothing from the
request body reaches it. Two consequences, both load-bearing:

* **A node cannot overwrite anything.** A signed PUT is an unconditional
  overwrite of exactly its key, so "the key is always new" is the whole of that
  guarantee — including against a node clobbering its own earlier output.
* **Output is attributable.** The job id is in the path, so an object found in
  the bucket months later traces to the row that produced it with no lookup
  table. The `node-outputs/` prefix keeps fleet output separable from
  `uploads/` for listing and for lifecycle rules.

A node-supplied `key` is **refused with `400`, not silently ignored**, and the
choice between those two is about what the node's author learns rather than
about safety (both are safe; the key is never read). Ignoring means their field
vanishes without a word: the upload succeeds, the bytes land somewhere they did
not choose, and their code goes on referring to a path with nothing at it —
found days later by a person. A `400` naming the field is found on the first
run by the person who just wrote it, and costs a correct client nothing,
because no legitimate node ever sends it.

Minting a target creates **no `storage_objects` row**. The node may never use
the URL, may crash mid-transfer, or may have its lease expire and its result
refused; a row written now would outlive all three as a `pending` object with
nothing behind it. Recording the output is the handler's business in
`persistNodeResult`, which is why the chosen key is returned to the node: it
reports it back in its result.

## 18. URLs are minted on demand, not folded into the claim

#268's `params` bag was built to receive them and deliberately still does not.
Minting at claim time spends the URL's lifetime on the wrong clock: a node
claiming its whole `concurrency` in one call queues that work internally, so
the last job's URL has been ageing since before the first job started — and the
obvious fix, a longer expiry, widens exactly the window the short expiry exists
to close. On-demand minting starts the clock when the transfer does, costs
nothing for a job type that never touches storage, and makes a retried transfer
one cheap call rather than a re-claim.

## 19. Input resolution fails by name, never with an empty path

The application this design was extracted from resolved a job's input by
reading a path out of a row and handing it to a stream open. When the subject
was missing, deleted, or keyless, the path was the empty string and the job
died with:

```
Error: ENOENT: no such file or directory, open ''
```

That message names nothing — not the job, not the type, not the subject, not
which of three causes applied — and the same text appeared for all three.
Nothing about it suggests the failure is permanent, so such jobs were retried
to exhaustion.

`resolveStorageObjectInput` (`src/storage/storage-job-input.ts`) is the single
resolver both executors use, and it returns a `StorageObject` with a guaranteed
non-empty `storageKey` or throws one of three named reasons:

| `reason` | Meaning |
|---|---|
| `missing_subject_id` | the job names no subject at all |
| `input_object_not_found` | the subject id names no row |
| `input_object_has_no_storage_key` | the row exists but holds no key |

It is a **plain function taking the client**, not an injectable service,
because its two callers live in modules that must not reach each other — the
handler is in `JobsModule` and the data plane in `NodesModule`, and
`NodesModule` already imports `JobsModule`, so a service would run the
dependency in the one direction the queue is kept free of. It throws a
**transport-agnostic error** for the same kind of reason: the handler needs a
throw the worker records in `Job.lastError`, and only the data plane needs a
status code.

Over HTTP that status is **`422`**, and the choice is the instruction, exactly
as the `409` is in §12:

* `400` would say "your request was malformed". It was not — the node sent the
  right thing about the right job — and a node written to fix-and-resend a 4xx
  would resend forever.
* `404` would say "no such job", which is false and sends an operator hunting
  for a row that is right there in the admin list.
* `500` would say "try again". All three reasons are permanent: a subject that
  was never set does not appear later, and a deleted row does not come back.
* `422` says "understood, and cannot be processed", which is the truth. The
  node's correct response is to report the job **failed**, letting the attempt
  budget and the admin list surface it like any other permanent failure.
  `details.reason` says which of the three applied and `details.retryable` is
  `false`.

## 20. A single-shot signed PUT, and what it replaced

`StorageProvider` had `getSignedDownloadUrl(key, options?)` — exactly what the
download route needs — and, for uploads, only
`getSignedUploadUrl(key, uploadId, partNumber, expiresIn?)`, which is
**multipart-specific** and meaningless without an `uploadId` from
`initMultipartUpload`. There was no plain signed PUT.

#269 adds `getSignedPutUrl(key, options?)` to the interface and implements it
in `S3StorageProvider` with `PutObjectCommand`.

**Rejected: driving a one-part multipart upload through the existing methods.**
It is possible — `init`, sign part 1, let the node PUT it, then `complete` —
and it is worse in four ways, each of which surfaces operationally rather than
as ugly code:

1. It needs a second round trip **and the part's ETag from the node**. That
   ETag is required by `CompleteMultipartUploadCommand`, so it would have to
   become a field in the node result contract — every node-eligible job type
   carrying a storage-protocol detail in its own result schema, forever, for a
   reason no handler author could guess.
2. **An abandoned upload leaks billable storage.** A node that dies between
   `init` and `complete` leaves an in-progress multipart upload holding its
   parts: invisible to `ListObjects`, chargeable until a bucket lifecycle rule
   (which this template does not require an operator to configure) expires it.
   An unused signed PUT leaves nothing — "no object" is exactly what a failed
   job should leave behind.
3. **It makes the server hold per-job state.** The `uploadId` must survive from
   mint to completion, so it needs a column, a cache, or a round trip through
   the node — three ways for a node's crash to strand a row. The node plane is
   designed so the server holds only what is already in `jobs`.
4. S3 enforces a **5 MiB minimum on every part but the last**. A one-part
   upload is exempt, but the rule sits next to a path somebody will later
   "optimise" into two parts.

The cost of the chosen option is one method every implementation must provide.
`test/nodes/node-checksum-data-plane.db.spec.ts` implements the whole interface
in its local provider precisely so that the day somebody adds a method without
implementing it everywhere, a file stops compiling.

## 21. `example.checksum`: the reference node-eligible type

Before #269 this template shipped **no node-eligible handler**, and the
consequence was not cosmetic: `claimJobs` intersects with the registry's
node-eligible types (§11), so with none registered, every claim by every node
correctly returned an empty list. The entire data plane could be wrong in any
way at all and nothing in this repository would notice, because nothing could
reach it.

`example.checksum` (`apps/api/src/jobs/handlers/example-checksum.handler.ts`)
takes `subjectType: 'storage_object'` and a `StorageObject.id`, and exercises
the complete path: claim → download URL → stream → SHA-256 → submit → schema
validation → `persistNodeResult` writing `{ sha256, bytes }` into
`StorageObject.metadata`, plus the failure and lease-renewal branches.

It is deliberately generic. **Rejected: a node-eligible `example.echo`** (post
`{ ok: true }`) — it would exercise the control plane and skip the whole data
plane, which is the half #269 adds and the half that is easy to get wrong.
**Rejected: anything domain-specific** — thumbnails, PDF page counts,
transcodes, inference — each needs a native dependency (`sharp`, `pdfium`,
`ffmpeg`, a model runtime) that a template must not force on a fork which will
delete this handler on day one, and which turns "can I run a node?" into a
packaging problem before it is a queue problem. SHA-256 over a stored object is
provider-agnostic, needs nothing beyond `node:crypto`, is genuinely useful
(integrity, deduplication, a stable content id), and is CPU-bound work over a
stream — the exact shape worth moving off the API server.

Its `process` and `persistNodeResult` **share one private write**. The compute
half differs by executor; the persist half is a single method called from both,
because otherwise a job's stored result depends on which executor claimed it —
a divergence nothing catches by accident, since each path is naturally tested
on its own.

## 22. The result contract crosses the boundary as **data**

`GET /api/nodes/job-types` lists every node-eligible type with its
`nodeResultSchema` converted by `z.toJSONSchema()`, so a client validates a
result before posting it, against the definition this server will actually
enforce. The schemas live in `apps/api/src/jobs/contracts/`.

**Rejected: a shared `packages/job-contracts` workspace.** The reasons are
already written down in `packages/shared/index.js`, which is the one package
that had to solve this problem in this repository:

* `apps/api` builds with `rootDir: ./src`. Importing TypeScript **source** from
  outside that root widens it, and tsc then emits `dist/src/main.js` — which no
  longer matches `start:prod`'s `node dist/main`. The build stays green and the
  container breaks.
* `apps/api`'s Jest config has no `moduleNameMapper` and the default
  `transformIgnorePatterns` (`/node_modules/`), so a workspace symlink
  resolving to `.ts` would be untransformed and every API suite would die at
  import time.
* CI runs `npm ci` and goes straight to typecheck; nothing builds a fourth
  workspace first, so a package needing compilation would have to add a step to
  several jobs.

`packages/shared` escapes all of that by shipping committed `.js` plus a
hand-written `.d.ts` — which works for a string constant and is useless for a
Zod schema, whose entire value is the runtime object. Serving the schema over
HTTP has none of those problems and one extra property a package cannot have:
a client on an older release cannot validate against a schema this server
stopped using.

`resultSchema` is **`null`, never `{}`**, when a schema has no JSON Schema
representation. `{}` means "anything is valid", so an empty object would be a
lie in the most expensive direction — the client would confidently validate
garbage and be refused by the server it just agreed with. The type is still
listed, because it is still claimable.

⚠ The route is a **literal under `/nodes` and must be declared before any
`:id` route**. `GET /api/nodes/{id}` already exists, so declaring `job-types`
after it routes every request for the contract list into the node lookup, where
`ParseUUIDPipe` answers `400 "Validation failed (uuid is expected)"` — a
message that names nothing about the real mistake.

## Rejected alternatives

**Reuse `PersonalAccessToken` for nodes.** The whole of §1. A leaked worker
token would carry its admin owner's full authority on every authenticated
route, by the PAT's own documented and tested design. The token family is the
boundary; there is no way to have one without the other.

**Add a `scopes` column to `PersonalAccessToken` and issue a narrow PAT.**
Superficially the smaller change — one column, no new table. It is worse in
three ways. First, it silently rewrites a published guarantee: the OpenAPI
description and `pat-universality.integration.spec.ts` both assert that a PAT
works on every authenticated route with no narrower scope, and a nullable
`scopes` column makes that claim conditional on data — true for some rows,
false for others, with nothing in the type system marking which. Second, it
makes the security property **per-row** rather than per-family: the guard would
have to load the token to discover it is restricted, which puts the lookup
back before the route check and reintroduces the `lastUsedAt` liveness oracle
of §3 with no way to avoid it. Third, it invites scope creep in the literal
sense — once tokens carry scopes, every future restriction is a new scope
string on the same table, and the "which routes may this reach" question stops
having one answer anybody can read. A separate table with a separate prefix
makes the restriction a fact about the token's *type*, checkable from the
first four characters of the header, before any I/O.

**Enforce the route allowlist inside `NodeCredentialService`.** §2. The
service has no request and more than one caller; the rule would have to travel
as a parameter into a function about credential liveness, or be duplicated per
call site.

**Gate on Nest route metadata (a `@NodeRoute()` decorator) instead of the
path.** §2.1. It makes the boundary depend on a decorator being remembered on
controllers that do not exist yet, and a forgotten decorator fails open or
fails closed depending on a default nobody will remember choosing.

**Let a `nod_` token manage its own credentials.** §2.2. Self-management is
minting; revocation would stop being a control.

**A mandatory expiry, matching PAT.** §4. It converts an already-bounded leak
risk into a scheduled fleet outage, and the boundedness is provided by the
allowlist rather than by the clock.

**A separate claim implementation for nodes.** §9. It is the obvious shape —
the node plane has different arguments, so give it its own query — and the
property it breaks is the one nothing tests by accident: two claimers never
receiving the same row. A specialised copy would start identical to
`JobClaimService`'s single `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING` and
diverge on the first fix applied to one side, and it would pass every mocked
test in the repository while double-claiming the first time a node and the API
server polled within the same millisecond. `test/nodes/node-claim-contention.db.spec.ts`
exists to hold that line against real Postgres.

**Writing terminal rows from the node plane.** §9 and the header of
`job-terminal.service.ts`. Two call sites means two answers to "does a 429
charge an attempt", "does the settled event fire on a retry", "what is the
backoff" — each starting identical and diverging invisibly.

**Trusting the node's `willRetry`.** A node that has just read a provider's
response often does know whether the work is worth retrying, and it may say
so; the field is accepted and never acted on. A node that could dictate its
own retries could retry itself past the attempt budget — and that budget
exists precisely to bound a job nobody is watching, running on hardware the
operator cannot see. The response reports what the server decided, which is
the only version of the answer that governs anything.

**Rejecting a late result with 400 instead of 409.** The status code is the
instruction the node acts on. `400` means "your request was malformed", whose
reasonable client response is to fix it and resend — forever, since the lease
will never come back. `409` means "the server's state moved on", whose correct
response is to **drop the work**: the job belongs to somebody else now. Only
one of the two carries that.

**404 for another user's node.** This is where the control plane deliberately
differs from `NodeCredentialService.revokeCredential`, which folds ownership
into its lookup so "not yours" and "does not exist" are indistinguishable. A
credential id is a secret-adjacent handle and nobody legitimately holds one
they do not own, so hiding the difference costs nothing. A node id is neither:
it is printed in logs, embedded in config files and passed between operators,
and the realistic failure is a `nod_` credential paired with the wrong node id.
`404` tells that operator "this node does not exist", which is false, and
sends them off to re-register — leaking a duplicate row and stranding the real
node's jobs. `403` tells them the truth: the node exists, and this credential
does not own it.

**Letting a node choose its own lease (or its own retry).** A courteous-looking
parameter that hands the one safety property the lease exists for to the least
trustworthy participant: a node asking for a 24-hour lease parks every row it
claims for a day, and nothing in the fleet looks broken while it happens.

**Proxying job bytes through the API** (`GET …/input` streaming the object,
`POST …/output` accepting it). The smallest diff and the worst outcome: every
byte of every job would cross the API process twice, so the API's memory, event
loop and egress bill become a function of how much work the *fleet* is doing —
the exact coupling a worker node exists to remove. A ten-node fleet hashing 1 GB
objects would saturate the API before it saturated anything that was computing.
It also puts long-lived streaming connections on the process that serves
interactive requests, so one large transfer degrades every page load, and a node
on a slow link holds a request open for minutes against every timeout in the
stack (Nginx, Fastify, the load balancer) — each of which would have to be
raised, for everyone.

**Giving nodes storage credentials.** Also small, also worse. A credential
handed to a node is a bucket-wide capability sitting in a config file on a
machine this deployment may not own, for as long as that machine exists: it does
not expire when the job ends, it is not scoped to one object, and it cannot be
revoked without rotating it for every other holder. A node compromised on
Tuesday can read every object in the bucket on Friday. A signed URL is the same
capability reduced along three axes at once — one object, one verb, minutes —
and a decommissioned node holds nothing to rotate.

**Letting the node choose the upload key.** §17. A signed PUT is an
unconditional overwrite of exactly its key, so a key from the request body is a
write primitive over the whole bucket handed to the least trustworthy
participant. `../../etc/config.json` and the storage key of any row in
`storage_objects` are both just strings, and no provider objects: S3 keys are
opaque, `..` is not special, and there is no filesystem to refuse the traversal.
The damage is silent — a job that "succeeded" while overwriting another user's
file.

**Shipping no node-eligible handler.** §21. It is what #268 shipped under, and
it leaves the fleet untestable end to end: with no node-eligible type
registered, every claim by every node correctly returns nothing, so no
data-plane defect is observable from this repository at all.

**A shared `packages/job-contracts` workspace.** §22, and
`packages/shared/index.js` for the three build-system reasons in full.

**Requeueing a deregistering node's jobs.** `deregister` is an HTTP call a
process makes while shutting down; nothing proves the work actually stopped.
Requeueing on that say-so would hand a still-running job to a second executor.
Held jobs come back through the lease reaper, which is the same path a crashed
node takes — one path, tested once, with no state a cooperative node can reach
that an uncooperative one cannot.

## Verification

```bash
npm run typecheck --workspace=api
npm test --workspace=api
npm run openapi:dump && npm run openapi:lint   # root scripts
```

`npm run test:db` additionally runs the real-Postgres suites, which `npm test`
excludes.

The load-bearing suites:

* `apps/api/src/nodes/nodes.service.spec.ts` — register-or-reattach including
  the simulated `P2002`, the three claim filters (asserted on the arguments
  handed to `JobClaimService`, because a filter that is wrong still returns
  jobs), and the lease guard's four conditions sabotaged one at a time.
* `apps/api/test/nodes/nodes.integration.spec.ts` — the same decisions over the
  real router, guards, Zod pipe, response envelope and exception filter: the
  `409` a late submission actually receives, the validation issues surviving
  inside `details`, and the `{ job, params }` shape a node's entire view of its
  work depends on.
* `apps/api/test/nodes/node-claim-contention.db.spec.ts` — **real Postgres
  only.** A node claiming through `NodesService` and the in-process worker
  claiming through `JobClaimService`, over two independent clients, never
  receive the same row. Unprovable against a mock, which is why it is a
  `*.db.spec.ts`.
* `apps/api/src/nodes/node-data-plane.service.spec.ts` — the guard being
  REACHED rather than reimplemented, the key being derived server-side (asserted
  on the argument handed to the provider, because a service that reported one
  key while signing another would pass any body-only assertion), the expiry
  clamp in both directions, and the three input-resolution reasons.
* `apps/api/test/nodes/node-data-plane.integration.spec.ts` — the same over the
  real router: `GET /api/nodes/job-types` being reachable at all (route order),
  valid JSON Schema for every node-eligible type, `409` without a lease, `400`
  naming a node-supplied `key`, `422` with `details.reason`, and a `Logger` spy
  proving no signed URL reaches a log line.
* `apps/api/src/jobs/handlers/example-checksum.handler.spec.ts` — both
  executors leaving the same row, `persistNodeResult` never touching the
  provider, the merge into `metadata`, and the near-miss digests (upper case,
  prefixed, truncated) a fork's own node would produce.
* `apps/api/src/storage/storage-job-input.spec.ts` — the three failures one at
  a time, each asserting the message names the job and is not `open ''`.
* `apps/api/test/nodes/node-checksum-data-plane.db.spec.ts` — **real Postgres
  only.** `example.checksum` from enqueue to persisted metadata, with a local
  signing storage provider: the "node" is handed nothing but the job and the
  URL it asked for, so it can only succeed if the data plane really works.
  Covers the lease-renewal and failure branches, the malformed result refused
  before `persistNodeResult`, and a node-supplied key refused against the job's
  own input object.
* `apps/api/src/nodes/node-credential.service.spec.ts` — the four rejection
  paths one at a time, and the `expiresAt: null` group.
* `apps/api/src/auth/guards/jwt-auth.guard.spec.ts` — the allowlist, the
  prefix-boundary paths, the ordering assertion (spy on `validateToken`), and
  regression coverage for the untouched `pat_` and JWT branches.
* `apps/api/test/nodes/node-credential.integration.spec.ts` — the `403`s over
  real HTTP on `/api/users`, `/api/admin/jobs` and `/api/node-credentials`
  **with an admin owner**, the endpoints' RBAC and show-once contract, and the
  allowed side of the boundary driven through the real service.

One note on that last file, resolved by #268. `JwtAuthGuard` is a
**route-level** guard: Nest runs it only after the router matches a handler.
While `/api/nodes` had no controller, a request there `404`d before the guard
was consulted, so #267 could only assert the *admitted* side by invoking the
guard directly — an HTTP assertion would have been measuring the router. Now
that `NodesController` is mounted, those cases are ordinary supertest requests
through the real router, guard and service (`GET /api/nodes`,
`GET /api/nodes?x=1`, `POST /api/nodes/{id}/heartbeat`,
`POST /api/nodes/register`), and they assert that `lastUsedAt` *is* stamped on
an allowed route — the mirror of the ordering assertion on a refused one.

What still cannot be an HTTP request is the prefix boundary itself:
`/api/nodesX`, `/api/nodes-other`, `/api/nodescrape` and `/api/nodes/` route
nowhere, so all of them `404` in the router whatever the guard decides. Those
stay as direct guard invocations, because a naive
`startsWith('/api/nodes')` admits every one of them and the router's `404`
would hide it.
