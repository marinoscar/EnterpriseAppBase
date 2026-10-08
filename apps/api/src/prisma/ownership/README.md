# User-owned data and scoped access

Issue #688 (PP-1.9). Since #699 the **mechanism** lives in
`@marinoscar/platform-api/core` ([core README, "Scoped data access"](../../../../../packages/platform-api/src/core/README.md#scoped-data-access)):
the registry, the scoped client extension, `asSystem` and
`ScopedAccessError`, schema-independent so packaged slices use it too. This
folder holds the **app side**:

1. **The registrations**: every Prisma model of this app with a foreign key
   to `User`, with the role of that key, a purge policy, an export policy and
   a rationale, registered into the package's `userOwnedModelRegistry`. A
   tripwire (the `userOwnedData` conformance suite) keeps it in step with the
   `prisma/schema/` folder.
2. **The binding**: `ScopedPrismaService.forUser(userId)` returns this app's
   Prisma client, typed, unable to read or change another user's rows in a
   registered model, and `asSystem(actor)` is the explicit, named way to run
   unscoped. `PrismaService.forUser(scope)` is the same client without the
   service.

**Model ownership kinds and row-level security (#725).** Beside the user-owned
registry this folder holds the **model ownership** registrations
(`platform-model-ownership.ts`, `model-ownership.manifest.ts`): every Prisma
model is `org` (NOT NULL `org_id`, row-level security forced), `org-optional`
(nullable `org_id`), `user` or `system`, with `orgReference` for an identity
table that merely names an organization. An app adds its own in
`app-registrations/model-ownership.ts`. `test/tenancy/model-ownership.spec.ts`
fails for a model with no entry and `test/tenancy/rls-coverage.db.spec.ts` for an
`org` table without its policy. The org-scoped client (`PrismaService.forOrg` /
`runInOrg`) and the bypass client (`PrismaSystemService`) are in `../`; the
rules are in [SECURITY-ARCHITECTURE.md §18](../../../../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls).

Spec: [platform-packages.md](../../../../../docs/specs/platform-packages.md),
"Tenancy and access model" → "Enforcement". Security view:
[SECURITY-ARCHITECTURE.md §17](../../../../../docs/SECURITY-ARCHITECTURE.md#17-user-owned-data-and-scoped-access).
The principal and scope types: [ADR 0001](../../../../../docs/adr/0001-org-aware-principal-and-scope.md).

## Files

| File | What it holds |
|---|---|
| `user-owned-model.manifest.ts` | One call: `registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS)` of `@marinoscar/platform-api/manifest`, which registers the platform inventory (`PLATFORM_USER_OWNED_MODELS`: 33 models, 40 `User` foreign keys, #866), then `app-registrations/user-owned-models.ts`, into the package's `userOwnedModelRegistry`. |
| `scoped-prisma.service.ts` | `ScopedPrismaService` (`forUser`, `forScope`, `asSystem`): a thin Nest wrapper over the package's `userScopeExtension` and `asSystem`, plus the debug log line. Provided and exported by the global `PrismaModule`. |
| `index.ts` | The barrel (`ScopedPrismaService`, `UserScopedClient`). Importing it fills the registry. The registry, `ScopedAccessError`, `ownerFieldOf` and friends are imported from `@marinoscar/platform-api/core`. |
| `../prisma.service.ts` | `PrismaService.forUser(scope)`: `this.$extends(userScopeExtension(scope))`, typed with the generated models. |

Tests: `user-owned-model.registry.spec.ts` (the app's inventory) and
`scoped-prisma.service.spec.ts` (the binding) here;
`test/prisma/user-owned-models.spec.ts` (the ownership and raw-SQL tripwires,
through `runPlatformConformance`) and `test/prisma/scoped-access.db.spec.ts`
(isolation on a real database). The rewriting rules and the registry's own
validation are proven in the package
(`packages/platform-api/test/core/data-access/`).

## Owner or actor

Every foreign key to `User` is one of two things:

| Role | Meaning | Example | Scoped client |
|---|---|---|---|
| **Owner** (`ownerField`) | The row belongs to the user. | `UserCredential.userId`, `StorageObject.uploadedById` | Reads and writes, confined to the user |
| **Actor** (`actorFields`) | The row only records which user acted; another owner (usually the deployment) controls it. | `AuditEvent.actorUserId`, `SystemSettings.updatedByUserId` | Refuses the model |

A model has at most one owner field and any number of actor fields. An actor
field on an owned model may not cascade: deleting the actor would delete a row
someone else owns.

## Policies

**Purge** says what happens to the row when the user's data is purged. It
names the behaviour the relation's `onDelete` already implements, and the
tripwire fails when they disagree:

| `purge` | Meaning | Required `onDelete` |
|---|---|---|
| `'delete'` | The row is deleted with the user's data. | `Cascade` |
| `'detach'` | The row survives and the user reference is nulled. | `SetNull` |
| `'retain'` | The row survives untouched; the user cannot be deleted while it exists. Actor-only models only, with a rationale saying why. | `Restrict` or `NoAction` |

It applies to the owner field, or to every actor field when there is no owner.
A relation without `onDelete` gets Prisma's default (`SetNull` when optional,
`Restrict` when required), and the tripwire checks that default.

**Export** (`'include'` or `'exclude'`) says whether a user's data export
includes the row. `exportOmit` lists columns that never leave the server even
when the row is exported (ciphertexts, hashes).

These are declarations today. Executing a purge or an export (user-data
reset, factory reset, the export framework) arrives with #743 and #744 and
reads this registry instead of a hand-written table list.

## Register a model

The tripwire (`test/prisma/user-owned-models.spec.ts`) fails the moment a
model gains a relation to `User` without an entry, and its message names the
file to edit.

**Platform model**: append an entry to the owning slice's list, or to `packages/platform-api/src/manifest/platform-user-owned-models.ts` for a base model (append only: the order is the export's dataset order), then rebuild the package. `packages/platform-api/test/manifest/manifest.spec.ts` checks the inventory against the platform's fragments.

**App model (a fork)**: add it to
[`app-registrations/user-owned-models.ts`](../../app-registrations/user-owned-models.ts),
never to the platform file:

```typescript
// apps/api/src/app-registrations/user-owned-models.ts
import type { UserOwnedModelDef } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

export const APP_USER_OWNED_MODELS: readonly UserOwnedModelDef<Prisma.ModelName>[] = [
  {
    model: 'Workout',
    ownerField: 'userId',
    purge: 'delete',        // the relation is onDelete: Cascade
    export: 'include',
    rationale: "A workout is the user's own log.",
  },
];
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `model` | yes | The Prisma model name (`Prisma.ModelName`, through the type parameter). One entry per model. |
| `ownerField` | one of the two | The scalar foreign key naming the owner. |
| `actorFields` | one of the two | Scalar foreign keys naming who acted. |
| `ownerRelation` | no | The relation field behind `ownerField`, used for `{ connect: { id } }` creates. Defaults to the owner field without `Id` (`userId` → `user`, `createdById` → `createdBy`); the tripwire tells you when to set it. |
| `purge`, `export` | yes | See [Policies](#policies). |
| `exportOmit` | no | Only with `export: 'include'`. |
| `rationale` | yes | One or two sentences. |

**Then decide what a data reset does with it (#743).** A model with an
`ownerField` also needs a user-data hint, or the `user-data` conformance suite
(`test/user-data/user-data-conformance.spec.ts`) fails: `{ model, category }`
(deleted with the user's data, in a registered category) or
`{ model, keep: '<why>' }`, in
[`app-registrations/user-data.ts`](../../app-registrations/user-data.ts). The
purge order is computed from the schema; see
[docs/specs/user-data-reset.md §4](../../../../../docs/specs/user-data-reset.md#4-extending-it-in-an-app).

## Scoped access

### `forUser` and `forScope`

```typescript
constructor(private readonly scoped: ScopedPrismaService) {}

async listMine(userId: string) {
  return this.scoped.forUser(userId).userCredential.findMany();  // only userId's rows
}
```

`forScope(scope)` takes the `Scope` from `@marinoscar/platform-api/core` (ADR 0001);
`forUser(userId)` is `forScope({ userId })`. Only `scope.userId` is applied:
`orgId` and `groupIds` are accepted and ignored until row-level security
(#725) and group grants (#729).

On a registered **owner** model, for owner field `O` and the scope's user `U`:

| Operation | What the client does |
|---|---|
| `findFirst(OrThrow)`, `findMany`, `count`, `aggregate`, `groupBy`, `updateMany(AndReturn)`, `deleteMany` | `where` becomes `{ AND: [where, { O: U }] }` |
| `findUnique(OrThrow)`, `update`, `delete`, `upsert` | `{ O: U }` is added to the unique `where`. Another user's row is "not found" (`null`, or Prisma's `P2025`), never a 403 that leaks its existence. |
| `create`, `createMany(AndReturn)`, `upsert`'s `create` | `O` is set to `U` when absent; another value throws `ScopedAccessError`. The owner given as the relation (`user: { connect: { id } }`) is accepted only for `U`. |
| `update`, `updateMany(AndReturn)`, `upsert`'s `update` | Moving the row to another owner throws. |

Everything else through a scoped client throws `ScopedAccessError`:

- an **actor-only** or **unregistered** model (`'AuditEvent is not user-owned; use asSystem() with a reason'`), including `User` itself;
- **raw SQL** (`$queryRaw`, `$executeRaw`, and their `Unsafe` variants), also inside `$transaction`;
- an operation the client does not know how to scope.

Interactive transactions (`scoped.forUser(id).$transaction(async (tx) => ...)`)
stay scoped.

### `asSystem`

```typescript
const prisma = this.scoped.asSystem({ kind: 'system', reason: 'retention.purge' });
await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
```

Returns the unscoped `PrismaService`. The reason (a short, greppable string)
is logged at debug and set on the active span as `db.access.scope = 'system'`
and `db.access.reason`; it is never a metric label. Use it for work that is
not on behalf of one user: backups, purges, the Doctor, cross-user admin
reads, and anything touching an actor-only table.

Injecting `PrismaService` directly still works and is how most of the code
base reads today; `asSystem` is the form to use when a path that otherwise
uses the scoped client needs an unscoped step, so the intent is visible.

### Caveat: nested writes and relations are not rewritten

The client rewrites the top-level `where` and `data` of the model being
queried. It does **not** rewrite nested writes (`create`/`connect`/`update`
inside `data`) or relation filters and `include`/`select` of other models. A
nested write into another user-owned model must go through that model's own
scoped call.

### Scoping is defence in depth

Every route still declares `@Auth(...)`, and a service still decides which
user it acts for (from the authenticated principal, never from a request
body). The scoped client guarantees that once it has decided, a forgotten
`where: { userId }` cannot reach another user's rows.

## Adopting the scoped client in an existing service

`UserCredentialsService` (now in `@marinoscar/platform-api/credentials`,
where it calls the package's `forUser(prisma, { userId })` on the
`PLATFORM_PRISMA` port) was the reference adoption, with unchanged behaviour:

1. Inject `ScopedPrismaService` (it is global; no module import needed).
2. Replace `this.prisma.<model>` with `this.scoped.forUser(userId).<model>`
   on the user-facing paths. Keep the explicit `userId` filters where they are
   the address (a compound unique key, say); the client is the guarantee.
3. Run the service's existing tests unchanged. A mocked unit spec whose deep
   Prisma mock cannot run `$extends` provides a `ScopedPrismaService` double
   in its setup only (`{ forUser: () => mockPrisma }`); its assertions stay
   as they are.
4. If a path also needs a system table, use `asSystem({ kind: 'system', reason })`
   for that step.

The other `where: { userId }` call sites are converted slice by slice.

## Raw SQL

Raw SQL bypasses the scoped client, so the files allowed to use it are listed,
with a reason each, in `apps/api/test/prisma/raw-sql-allowlist.ts`
(`{ file, why }` entries). The `userOwnedData` suite run by
`user-owned-models.spec.ts` fails for a new unlisted file and for a listed
file that no longer uses raw SQL. A raw statement must never take a
request-derived id without scoping it to the caller.
