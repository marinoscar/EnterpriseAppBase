# Worker Node Credentials

> Issue #267, epic #254. The schema half — `WorkerNode`, `NodeCredential`, the
> `NodeStatus` enum and the `Job.claimedByNode` relation deferred by #255 —
> lives in `apps/api/prisma/schema.prisma`, whose block comments carry the
> per-column reasoning and are not restated here. This document covers the
> service, the endpoints and the guard branch:
> `apps/api/src/nodes/node-credential.service.ts`,
> `apps/api/src/nodes/node-credential.controller.ts`,
> `apps/api/src/nodes/node-credential.module.ts`,
> `apps/api/src/nodes/dto/`, and the `Bearer nod_` branch in
> `apps/api/src/auth/guards/jwt-auth.guard.ts`.
>
> The node control plane itself — register, heartbeat, claim, lease renewal,
> deregistration, the fleet page — is **#268** and is not described here. What
> is described here is the credential those endpoints will authenticate with,
> and the boundary that keeps it from being able to do anything else.

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

## Verification

```bash
npm run typecheck --workspace=api
npm test --workspace=api
npm run openapi:dump && npm run openapi:lint   # root scripts
```

The load-bearing suites:

* `apps/api/src/nodes/node-credential.service.spec.ts` — the four rejection
  paths one at a time, and the `expiresAt: null` group.
* `apps/api/src/auth/guards/jwt-auth.guard.spec.ts` — the allowlist, the
  prefix-boundary paths, the ordering assertion (spy on `validateToken`), and
  regression coverage for the untouched `pat_` and JWT branches.
* `apps/api/test/nodes/node-credential.integration.spec.ts` — the `403`s over
  real HTTP on `/api/users`, `/api/admin/jobs` and `/api/node-credentials`
  **with an admin owner**, the endpoints' RBAC and show-once contract, and the
  allowed side of the boundary driven through the real service.

One note on that last file. `JwtAuthGuard` is a **route-level** guard: Nest
runs it only after the router matches a handler. `/api/nodes` has no handler
until #268, so an HTTP request there `404`s before the guard is consulted —
an assertion on that path would be measuring the router, not the allowlist,
and would quietly start measuring something else the day #268 lands. The
allowed side of the boundary is therefore exercised by invoking the guard
directly over the real `NodeCredentialService` and the real Prisma mock. Guard,
service, hashing and row shape are all production code; only the router is
absent, because the router has nothing to say yet. Those cases should be folded
back into ordinary HTTP requests once #268 mounts the routes.
