# Worker Nodes

> Issues #267 and #268, epic #254. The schema — `WorkerNode`, `NodeCredential`,
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
> The presigned data plane a node moves bytes through is **#269**, and the
> fleet lifecycle cron (liveness, pruning, auto-drain) is **#270**; neither is
> described here.

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
output object with no storage credentials of its own — is **#269** and is
deliberately absent from `params`, which is why `params` is a separate bag
from `job` in the claim response rather than a flattened object.

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
