# 0001. Org-aware principal and scope

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** platform owner
- **Tracking:** issue #687 (PP-1.16), epic #660, program #659
- **Contract:** [`apps/api/src/common/principal/principal.types.ts`](../../apps/api/src/common/principal/principal.types.ts)

## Context

### What the spec already decided

The [platform packages spec](../specs/platform-packages.md#tenancy-and-access-model)
settles the tenancy model this contract has to serve:

- **Organisations are the tenants.** An organisation ("Company A") is a
  collection of users and the isolation boundary for data, administration and
  billing.
- **Circles are not tenants.** MemoriaHub's circles become *groups* inside an
  org: they share content, they do not isolate it.
- **Tenancy mode is a deployment setting**, not a code fork. Single-org puts
  everyone in one org that users auto-join; multi-org has one org per customer.
  Same code, same tables, in both modes. A personal org per user was rejected.
- **Row-level security is transaction-local.** When RLS lands, its settings are
  applied with `set_config(..., true)` / `SET LOCAL` so they survive connection
  poolers, and cross-org system work uses a separate bypass connection.
- **Phasing.** "Now (wave 0 and 2): the principal and scope in the core
  contracts include the org." Organisation tables arrive in wave 4.

Contracts published in waves 1 to 3 (registries, the scoped data-access
helper, package APIs) take a principal or a scope as input. If those inputs do
not carry the org from the start, every one of them needs a breaking change in
wave 4.

### What exists today

The request identity has two loosely related shapes, no notion of scope and no
marker of which credential was used.

- [`auth/interfaces/authenticated-user.interface.ts`](../../apps/api/src/auth/interfaces/authenticated-user.interface.ts):
  - `AuthenticatedUser extends User` (a Prisma model) with the
    `userRoles → role → rolePermissions → permission` graph. It is what
    `JwtStrategy.validate`, `PatService.validateToken` and
    `NodeCredentialService.validateToken` return, and what lands on
    `request.user`.
  - `RequestUser { id, email, roles, permissions, isActive }`, built by
    `toRequestUser()` in `roles.guard.ts` and `permissions.guard.ts` and stored
    on `request.requestUser`.
- [`auth/decorators/current-user.decorator.ts`](../../apps/api/src/auth/decorators/current-user.decorator.ts):
  `@CurrentUser()` returns `request.requestUser || request.user`. It has about
  120 call sites under `apps/api/src`.
- **Ownership is a convention.** About 30 `where: { userId` filters under
  `apps/api/src` (the spec counts about 46 across an app) are the only thing
  that keeps one user's rows from another's.
- **Four credential families reach the same `request.user`**
  ([`auth/guards/jwt-auth.guard.ts`](../../apps/api/src/auth/guards/jwt-auth.guard.ts),
  [SECURITY-ARCHITECTURE §2](../SECURITY-ARCHITECTURE.md#2-credential-kinds)):
  - the browser session access JWT;
  - the device-flow access JWT, which carries a `did` claim
    ([`auth/strategies/jwt.strategy.ts`](../../apps/api/src/auth/strategies/jwt.strategy.ts),
    `JwtPayload.did`);
  - a `pat_` personal access token (the guard's PAT branch);
  - a `nod_` worker-node credential (the guard's node branch, confined to
    `/api/nodes`).

  Nothing downstream can tell them apart. EvoPath added an
  `@AuthCredential()` decorator for this gap; it is a backport candidate
  (#689).

## Decision

Introduce one org-aware **principal and scope contract** as TypeScript types,
in `apps/api/src/common/principal/`, with no runtime code and no imports from
Prisma, Nest or any app module, so the file moves unchanged into
`@marinoscar/platform-api/core` (#698). Nothing imports it in this change; no
guard, decorator, strategy or service changes behaviour.

The contract is marked `@stability experimental` until #698 publishes it: the
org fields narrow later (see [Tenancy modes](#tenancy-modes)).

### The types, field by field

| Type | Shape | Rule |
|---|---|---|
| `TenancyMode` | `'single' \| 'multi'` | Deployment-level. Parsed from `TENANCY_MODE` by #722; this ADR only names it. |
| `CredentialKind` | `'session' \| 'device' \| 'pat' \| 'node'` | One value per credential family. See [credential mapping](#credential-mapping). |
| `PrincipalKind` | `'user' \| 'node'` | Discriminant of `Principal`. |
| `OrgMembership` | `{ orgId, role }` | One org the principal belongs to, with its org-scoped role name (spec: "Org roles"). |
| `GroupMembership` | `{ groupId, orgId, role }` | One group inside an org, with the member's role in it. |
| `UserPrincipal` | base + `kind: 'user'`, `credential: 'session' \| 'device' \| 'pat'` | A human, directly or through a credential they delegated. |
| `NodePrincipal` | base + `kind: 'node'`, `credential: 'node'`, `nodeId?` | An unattended worker process acting as its owning user. |
| `Principal` | `UserPrincipal \| NodePrincipal` | Who is calling. Narrow on `kind`. |
| `Scope` | `{ userId, orgId?, groupIds? }` | The data boundary of one operation. |
| `SystemActor` | `{ kind: 'system', reason }` | The only way to run unscoped. |

Fields every principal carries:

| Field | Type | Meaning |
|---|---|---|
| `kind` | `PrincipalKind` | `'user'` or `'node'`. |
| `userId` | `string` | The user whose authority is exercised. For a node, the credential's owner. |
| `email` | `string` | That user's email, for logs and audit. |
| `credential` | `CredentialKind` | How the request authenticated. |
| `roles` | `readonly string[]` | System roles (spec: "System roles operate the deployment"). Today every role is a system role. |
| `permissions` | `readonly string[]` | Effective permission strings, deduplicated. |
| `activeOrgId` | `string`, optional | The active organisation. See [Tenancy modes](#tenancy-modes). |
| `memberships` | `readonly OrgMembership[]`, optional | Every org the user belongs to. Filled by #724. |
| `groups` | `readonly GroupMembership[]`, optional | Every group the user belongs to. Filled when groups land (#729). |

Three shape rules:

- **Readonly everywhere.** A principal is a snapshot taken once per request.
  Nothing mutates it; a change of org re-issues the token and produces a new
  principal on the next request.
- **No `isActive`.** An inactive user never becomes a principal: every
  validation path already returns `null` (or throws) for an inactive user, so
  the field could only ever be `true`.
- **No runtime mapper yet.** `toPrincipal()` arrives with #698. The mapping
  below is the specification it implements, and the type-level spec
  ([`principal.types.spec.ts`](../../apps/api/src/common/principal/principal.types.spec.ts))
  proves today's `RequestUser` plus a `CredentialKind` is enough to build a
  `UserPrincipal`.

### Credential mapping

Decided in `JwtAuthGuard`, the only place that knows which branch accepted the
request:

| Guard branch | Signal | `credential` | `kind` |
|---|---|---|---|
| Passport JWT strategy | payload has no `did` | `'session'` | `'user'` |
| Passport JWT strategy | payload has a `did` | `'device'` | `'user'` |
| `Bearer pat_…` branch | `PatService.validateToken` | `'pat'` | `'user'` |
| `Bearer nod_…` branch | `NodeCredentialService.validateToken` | `'node'` | `'node'` |

A device flow that issued a `pat_` (`tokenType: "pat"`) reaches the PAT branch
and is therefore `'pat'`: the kind names the credential presented, not the flow
that minted it.

`RequestUser` maps onto the base fields as `id → userId`, `email → email`,
`roles → roles`, `permissions → permissions`; `isActive` is dropped (see
above).

### Scope derivation

A `Scope` is derived **from the principal only**, never from a path, query or
body parameter. It is the rule `notifications/notification-stream.service.ts`
already states for SSE isolation (the stream key comes from the authenticated
principal, so no user-supplied value selects a stream), generalised to all
data access.

- `userId = principal.userId`. Always present.
- `orgId = principal.activeOrgId`. Absent until orgs exist; required after.
- `groupIds` = the ids of `principal.groups`, optionally narrowed by the
  operation to a subset. An operation may narrow; it may never widen to a group
  the principal is not a member of.

A route that acts on another user's data on behalf of an administrator (for
example `PATCH /api/users/:id`) does not build a `Scope` from `:id`. It is
either authorised by permission and runs as a `SystemActor`, or it is an
org-admin operation that #723 and #729 express through org roles and grants.

### Tenancy modes

- **Single mode.** Every user auto-joins the default org, so a user
  principal's `activeOrgId` is always the default org's id.
- **Multi mode.** The active org is chosen at sign-in and carried in the access
  token. Switching org re-issues the token; a principal never changes org in
  place.
- **Bound credentials.** Personal access tokens and device tokens are bound to
  one org at issue and cannot switch (#724).
- **Node credentials stay system-scoped.** A `NodePrincipal` carries no
  `activeOrgId`, in either mode, and stays confined to `/api/nodes`.

`activeOrgId`, `memberships` and `groups` are **optional now**, so the contract
ships before orgs exist. Once #724 lands they become required for user
principals in multi mode. That is introduced as a minor version of the
experimental contract that narrows the type behind `TenancyMode`: a type
parameter with a default (for example `UserPrincipal<M extends TenancyMode =
TenancyMode>`, where `M = 'multi'` makes `activeOrgId` and `memberships`
required). Callers that name no mode keep compiling; code that declares
`'multi'` gets the stronger type.

### `SystemActor`

- It is the **only** way to run without a scope. Code that needs every user's
  rows (backups, retention purges, the Doctor, factory reset) passes a
  `SystemActor` explicitly; there is no "scope with no user".
- It always carries a short, greppable `reason` (`'retention.purge'`,
  `'db.backup.run'`), which is logged and set on the active span.
- It is used by system jobs and cron-enqueued work and is **never derived from
  an HTTP request**. #688's tripwire and, once RLS lands, the bypass connection
  of #725 enforce that.

### Telemetry

The org goes on **spans and logs** (`org.id`), never on **metric labels**: an
unbounded label multiplies series per tenant (spec, per-slice impact table).
The credential kind is a small closed set and may be a metric label.

### RLS

When #725 lands, `Scope.orgId` is exactly the value the transaction-local
`set_config('app.org_id', <orgId>, true)` carries for the scoped transaction.
A `SystemActor` runs on the separate bypass connection and sets nothing.

## Consequences

| Later work | What it does with this contract |
|---|---|
| #688 (scoped data access) | `forScope(scope: Scope)`, `forUser(userId)` and `asSystem(actor: SystemActor)` import these types with `import type`. `orgId` and `groupIds` are accepted and ignored until #725 and #729. |
| #698 (`platform-api/core`) | Moves `principal.types.ts`, `index.ts` and the spec into the package unchanged, adds the runtime `toPrincipal()`, attaches a `Principal` to the request and adds `@CurrentPrincipal()`. |
| #724 (active org) | Fills `activeOrgId` and `memberships`, binds PATs and device tokens to an org, and introduces the multi-mode narrowing. |
| #725 (RLS) | Carries `Scope.orgId` into `set_config('app.org_id', …, true)`; gives `SystemActor` its bypass connection. |
| #729 (grants and groups) | Fills `groups` and honours `Scope.groupIds`. |

**`@CurrentUser()` callers do not change** until #698. It adds
`@CurrentPrincipal()` beside `@CurrentUser()`, and call sites migrate
deliberately, module by module, rather than all 120 at once.

What becomes harder: a principal cannot be edited in place, and unscoped data
access needs a written reason. Both are the point.

## Alternatives considered

- **A personal org per user.** Rejected by the spec: it would block
  cross-user sharing, which kvox and MemoriaHub need inside one org.
- **Scope as free-form filters** (`Record<string, unknown>` merged into
  `where`). Rejected: a filter can come from request input and can be widened
  by whoever builds it, so it cannot back an isolation guarantee or RLS. A
  closed `{ userId, orgId, groupIds }` derived from the principal can.
- **Permissions inside the access token now.** Rejected (see #683): the
  database is authoritative for roles and permissions so that a role change or
  deactivation takes effect on the next request; a token claim would delay that
  until expiry. #683 adds a short-TTL principal cache instead. Only the active
  org goes in the token, because it is a choice, not a grant.
- **Extend `RequestUser` in place.** Rejected: it ripples through 120
  `@CurrentUser()` sites and changes behaviour now.
- **Put the types in `packages/shared`.** Rejected for now: that package is
  product identity shared with web and CLI. The contract belongs in
  `platform-api/core`; keeping it import-free makes the move trivial.
- **Make `orgId` required now with a placeholder value.** Rejected: a fake org
  id would leak into logs and data before orgs exist.

## References

- Spec: [platform packages, Tenancy and access model](../specs/platform-packages.md#tenancy-and-access-model)
  (Decisions, The model, Tenancy mode is a deployment setting, Enforcement,
  Per-slice impact, Phasing) and [Wave 0](../specs/platform-packages.md#wave-0-no-regret-moves).
- Security: [SECURITY-ARCHITECTURE §1 and §2](../SECURITY-ARCHITECTURE.md#2-credential-kinds).
- Contract: [`apps/api/src/common/principal/`](../../apps/api/src/common/principal/index.ts).
- Code: `apps/api/src/auth/interfaces/authenticated-user.interface.ts`,
  `apps/api/src/auth/decorators/current-user.decorator.ts`,
  `apps/api/src/auth/guards/jwt-auth.guard.ts`,
  `apps/api/src/auth/strategies/jwt.strategy.ts`,
  `apps/api/src/notifications/notification-stream.service.ts`.
- Issues: #687 (this ADR), #688, #689, #698, #722, #723, #724, #725, #729, #683.
