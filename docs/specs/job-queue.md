# The Background Job Queue

> Epic #254, Phase 0–1 (#255 the `Job` / `JobStatsRollup` schema and
> `buildDedupKey`, #259 the handler contract, registry, worked example and
> this document, #260 enqueue with index-backed dedup and the atomic
> `SKIP LOCKED` claim, #261 the terminal state machine, #262 the in-process
> worker pool and worker modes, #263 queue hygiene). Implemented in
> `apps/api/prisma/schema.prisma` (the `Job` and `JobStatsRollup` models),
> `apps/api/src/jobs/job-keys.ts`,
> `apps/api/src/jobs/job-handler.interface.ts`,
> `apps/api/src/jobs/job-handler.registry.ts`,
> `apps/api/src/jobs/job-type-labels.ts`,
> `apps/api/src/jobs/jobs.module.ts` and
> `apps/api/src/jobs/handlers/`.
>
> **On what is merged today.** This document is written alongside #259 and
> describes, as *implemented*, only what #259 ships: the contract, the
> registry, the labels map, the example handler and the module. Sections 4–7
> are deliberate stubs for the issues that fill them in, marked as such.
> Where an unmerged issue's behaviour is referenced from a merged section
> (the worker's lifecycle phase, for instance) it is stated as a **constraint
> that issue must satisfy**, not as behaviour verified in this checkout.

## Why this shape, and not the obvious one

Before this epic, a fork of this template that needed background work had
exactly one place to put it: another `@Cron` task next to
`auth/tasks/token-cleanup.task.ts`,
`device-auth/tasks/device-code-cleanup.task.ts` and
`storage/tasks/storage-cleanup.task.ts`. Those three are the honest baseline,
and they are the argument for the queue:

1. **They cannot retry.** A cron that throws has failed until its next tick,
   with no record that it failed, no attempt count, and no backoff.
2. **They cannot be observed.** There is no row anywhere saying a run
   happened, how long it took, or what its error was.
3. **They already assume a single API replica.** There is no leader election
   in this repository, so a second replica runs every cron a second time.
4. **They cannot be moved off the API process.** Anything expensive competes
   with request handling on the same event loop.

The queue is a `jobs` table, claimed atomically with `FOR UPDATE SKIP LOCKED`
by an in-process worker and — later in the epic — by remote worker nodes, so
the *same handler code* runs in either place with no branching. Three
deliberate non-choices shape it:

- **No Redis, no BullMQ.** This template already requires PostgreSQL;
  requiring a second datastore on a template's default path is a real
  adoption cost for every fork, paid whether or not the fork uses the queue.
- **No second process entrypoint by default.** The worker runs in the API
  process. The remote node fleet is optional and additive.
- **No application-specific job type.** The template ships example handlers
  and the extension recipe; a fork brings the real work.

Everything below follows from one requirement: **a fork adds a job type with
one class and no queue wiring** — no migration, no enum, no `switch`, and the
type appears in the admin dashboard on its own.

## 1. The handler contract

`apps/api/src/jobs/job-handler.interface.ts` is the entire public surface of
the queue for a feature author:

```ts
export interface JobHandler {
  readonly type: string;
  process(job: Job): Promise<void>;

  /** Present only on node-eligible handlers. */
  readonly nodeResultSchema?: z.ZodType;
  persistNodeResult?(job: Job, result: unknown): Promise<void>;
}
```

Two required members. That is not minimalism for its own sake — it is the
measure of the promise. Every member added here is a member every future
handler in every fork has to satisfy, and the worker's whole knowledge of a
job type is "look up `type`, call `process`". A contract the worker does not
read is a contract that should not be in this interface.

`Job` is the generated Prisma type. `type` is a plain `String` column on that
table, not an enum, precisely so that adding a handler costs zero migrations —
see the `Job` model's own header comment in `schema.prisma` — and so a row can
outlive the handler that produced it.

### 1.1 `process` throws to fail; it does not return a result

The nearest precedent in this repository is
`storage/processing/object-processor.interface.ts`, whose `process` returns
`Promise<ObjectProcessorResult>` — a `{ success, metadata?, error? }` object.
The job handler contract deliberately does **not** copy that, and the
difference is not stylistic:

| | Object processor | Job handler |
|---|---|---|
| How many run per unit of work | Several, in priority order, over one upload | Exactly one — the handler **is** the job |
| What a failure must not do | Abort the other processors | — |
| Where the outcome goes | Aggregated into the object's metadata | `Job.status`, `Job.attempts`, `Job.lastError` |

A processor needs to report a per-processor outcome because something
aggregates it. A job has nothing to aggregate: it completed or it did not, and
"did not" has to reach the retry machinery.

Throwing is also the *default* behaviour of every async call a handler makes —
a rejected promise, a Prisma error, a fetch timeout. So "throw to fail" means
a handler that writes **no error handling at all** already fails correctly,
and swallowing an error becomes the visible, deliberate act (a `try/catch`
that does not rethrow) rather than the accidental one. A result object gets
this exactly backwards: the handler that forgets to check an inner promise
returns `{ success: true }` for work that never happened, and the queue
records a green job that did nothing.

The thrown error's message is what lands in `Job.lastError` and what a human
reads in the admin job list.

**At-least-once, never exactly-once.** A handler can run twice: a retry after
a partial failure, or a lease that expired because the executing process was
killed mid-run and another worker legitimately reclaimed the row. Handlers
should be idempotent wherever the underlying operation allows it. This is a
property of any lease-based queue, not a defect to be designed away — the
alternative is a job that is never retried after a process dies, which is
strictly worse.

### 1.2 Explicit self-registration, not decorator discovery

`apps/api/src/jobs/job-handler.registry.ts` holds a `Map<string, JobHandler>`
and offers four methods: `register`, `get`, `types`, `serverOnlyTypes`. A
handler puts itself in it, from its own `OnModuleInit`:

```ts
onModuleInit(): void {
  this.registry.register(this);
}
```

**Rejected: `@JobHandler('type')` + `DiscoveryService`.** Nest can enumerate
providers by decorator metadata at boot, which would let a handler register
merely by existing — no lifecycle hook, no injected registry, one less line
per handler. Three reasons it is the wrong trade here:

- **It still needs a registry underneath.** Discovery does not replace the
  map; it replaces the `register` call with a metadata scan and keeps
  everything else. The saving is one line per handler, against a mechanism
  every reader of the codebase now has to know about.
- **It is harder to trace.** "Why is this type running?" has a grep-able
  answer today: one `register(this)` line, in the file that implements the
  type. Under discovery the answer is "a decorator you cannot see from here
  matched a scan at boot" — and a handler that failed to register looks
  identical to one that was never written.
- **It would be a third mechanism for a job this repo already does twice.**
  `NOTIFICATION_CHANNEL_SENDERS` is an explicit factory array
  (`notifications.module.ts`), and the storage object processors are explicit
  `OBJECT_PROCESSOR` providers. `notifications.module.ts` states the same
  objection in its own words — *"a channel added by an import side effect is a
  channel that appears in production without appearing in a diff"* — and it
  applies unchanged to a job type that begins executing work because a file
  was added to a directory.

**Duplicate `type`: warn and overwrite, last registration wins.** Also a
choice, and the two alternatives are both worse:

- *Throw* would turn a duplicate into a boot failure for the whole
  application. But a fork shadowing a framework handler with its own
  implementation of the same type is doing something legitimate — it is how
  you replace framework behaviour without editing framework code — and a
  template should not forbid it.
- *First-one-wins* would make which handler executes depend on
  module-resolution order, the exact invisible coupling explicit registration
  exists to avoid, and it would silently discard the handler the author most
  likely meant to win.

So the last registration wins and the collision is logged at `warn` — visible
either way, whether it was an intended override or two features that
copy-pasted the same `type` string.

### 1.3 The lifecycle constraint this places on the worker (#262)

**The worker must start from `onApplicationBootstrap`, not `onModuleInit`.**

This is a direct consequence of §1.2 and is recorded here because the issue
that builds the worker is not the issue that can discover the bug. Nest runs
every `onModuleInit` hook in one phase, in module-resolution order, and only
then runs every `onApplicationBootstrap` hook. A worker polling from
`onModuleInit` would therefore race the registrations it depends on: whether
`get(type)` finds a handler would come down to which module Nest happened to
initialise first.

And the failure is not a retryable blip. A claimed job whose type has no
registered handler is an *unknown job type* — a **permanent** failure for a
perfectly good job that would have run correctly one second later. Starting at
`onApplicationBootstrap` turns the ordering from luck into a guarantee: every
handler has registered before the first claim query runs.

## 2. Node eligibility is derived, never declared

Later in the epic (Phase 3, #267–#271), a job can be computed on a remote
worker node: the node claims work through a control plane, computes with **no
database access at all**, and posts a result back for the server to validate
and persist. Not every type can work that way — a handler that reads three
tables mid-computation, streams a file out of object storage, or writes as it
goes is server-only by nature.

The system's single source of truth for that distinction is **the presence of
the two optional members**:

| Handler carries | Meaning |
|---|---|
| Both `nodeResultSchema` **and** `persistNodeResult` | Node-eligible |
| Neither | Server-only (the default) |
| Exactly one of the two | **Server-only** |

`JobHandlerRegistry.serverOnlyTypes()` is that derivation, and it is what the
later `system` worker mode (`JOBS_WORKER_MODE=all|system|off`) reads: "claim
only the types a node could never run". There is no second list of
server-only types to maintain, and adding a node-eligible handler does not
require editing anything outside that handler.

**Why exactly one member is server-only rather than a half-eligible case.** A
schema with no persist function describes a payload nobody can store; a
persist function with no schema would have to trust an unvalidated body posted
by a remote machine. Neither is a state the node plane can act on safely, so
both collapse to the safe answer. Treating "exactly one" as a *configuration
error* — throwing at registration — was considered and rejected for the same
reason `register` overwrites rather than throws: a half-written handler should
not be able to prevent an application from booting, and the safe interpretation
costs nothing.

**Rejected: a `readonly nodeEligible: boolean` flag.** It is the obvious
design and it is wrong for one specific reason: *a flag can disagree with the
members it describes.* `nodeEligible: true` on a handler with no
`persistNodeResult` is a job dispatched to a remote machine whose result the
server then cannot store — and the failure surfaces at runtime, on a node, in
production, rather than in review. Deriving the answer from the members makes
that state **unrepresentable**: there is nothing to set inconsistently,
because there is nothing to set. This is the same argument
`notification-events.ts` makes when it derives the `NotificationChannel` type
from the channels array rather than declaring both ("so the two cannot
disagree").

### 2.1 `persistNodeResult` does the persist half and nothing else

A hard rule, not a style preference. The split is:

```
node   →  compute the result            (no DB, no app secrets, no tables)
server →  validate against nodeResultSchema, then persistNodeResult writes it
```

`persistNodeResult` must **not** recompute the work, re-download the input,
call the provider again, or "fix up" a result it dislikes. The moment it does
any of those, the node's computation stops being the source of the result: the
server is doing the work twice, the node's answer is decorative, and the
entire reason for the node plane — expensive work off the API server — is
gone. If a result cannot be persisted without redoing the work, the type is
not node-eligible; drop both members and let it run server-side.

The `result: unknown` parameter type is deliberate, and it is the same trade
`notify()`'s `data: unknown` makes: the value arrives from off-machine and is
untrusted by construction, so `nodeResultSchema` is the only thing that may
narrow it. It is a trust boundary, not a convenience.

## 3. Display labels, and why they are not on the interface

`apps/api/src/jobs/job-type-labels.ts` maps a machine `type` to a human
phrase for the admin dashboard, with `jobTypeLabel(type)` falling back to the
raw type string.

**Rejected: a required `readonly label: string` on `JobHandler`.** It would
guarantee every type has a label — and it would enlarge the contract for a
presentation concern the worker never reads. The contract's smallness is what
epic #254 is actually selling; §1 is not worth spending on a display string.

**The fallback is load-bearing, not defensive.** This map is structurally
incomplete at all times: a fork's handlers are types this repository has never
heard of, which is the whole promise. A lookup returning `undefined` would
render a blank dashboard cell for exactly the types a fork cares most about.
Falling back to the type string makes an unlabelled type merely less pretty
(`my-feature.do-the-thing`) rather than invisible, so adding a label stays
optional polish. A second reason: a `jobs` row can name a type no handler
registers any more — rows outlive handlers — and the dashboard still has to
render that historical row.

## 4. Enqueue, dedup, and the atomic claim — *#260*

> **Stub.** Filled in by #260 ("Job enqueue with index-backed dedup, and the
> atomic SKIP LOCKED claim").
>
> Already merged and in scope for that section: `buildDedupKey()`
> (`apps/api/src/jobs/job-keys.ts`) is the single definition of the
> `dedup_key` column's format, and the partial unique index
> `jobs_active_dedup_uniq_idx` — hand-written in
> `prisma/migrations/20260906120000_add_jobs/migration.sql` because Prisma's
> `@@index` DSL cannot express a `WHERE` clause — is what actually enforces
> dedup among `pending`/`running` rows. Both already carry their rationale in
> comments; #260 should bring the *enqueue-path* reasoning here (why the
> index rather than `findFirst`-then-`create`, which is racy exactly when
> dedup matters; how a nullable key gives `skipDedup` for free) and document
> `FOR UPDATE SKIP LOCKED` and why `attempts` is charged at **claim** time
> rather than at failure time.

## 5. The terminal state machine — *#261*

> **Stub.** Filled in by #261 ("Terminal state machine — retry, rate-limit
> deferral, throttle gate, settled event").
>
> To cover: the `pending → running → succeeded|failed` transitions; retry and
> backoff against the attempt budget; why rate-limit deferral moves
> `scheduledFor` and increments `rateLimitHits` **without** charging
> `attempts` (the `Job` model comment already argues this — a job waiting its
> turn must not exhaust a budget meant for a job that keeps failing); the
> per-provider throttle gate; and the job-settled event.

## 6. The in-process worker and worker modes — *#262*

> **Stub.** Filled in by #262 ("In-process worker pool, worker modes, per-job
> timeouts").
>
> Two things already fixed by this document and not up for rediscovery
> there: the worker starts from **`onApplicationBootstrap`** (§1.3 — this is
> a correctness constraint, not a preference), and the `system` mode's job
> list is `JobHandlerRegistry.serverOnlyTypes()` (§2), never a second
> hand-maintained list. To cover: the `all|system|off` modes, pool sizing,
> per-job timeouts, and shutdown behaviour for in-flight jobs.

## 7. Queue hygiene — *#263*

> **Stub.** Filled in by #263 ("Queue hygiene — lease reaper, history purge
> with lifetime rollup, temp-file janitor").
>
> To cover: the lease-expiry reaper and why `resetStuck`/`stuckRunningWhere`
> are extracted so a control-plane-only API can reap dead node leases without
> depending on the admin service; the nightly history purge; and why
> `JobStatsRollup` exists at all — it is the lifetime accumulator that
> survives that purge, so per-type stats do not reset when history is
> trimmed.

## The extension recipe

The operational version of this lives in
`apps/api/src/jobs/handlers/README.md`, which is where a fork's author will
actually look. In summary:

1. **Write the class.** Implement `JobHandler`: a unique `type` string and a
   `process(job)` that throws to fail.
2. **Self-register.** `this.registry.register(this)` in the handler's own
   `onModuleInit()`.
3. **Provide it.** Add the class to the `providers` of the module that owns
   the feature, and `imports: [JobsModule]` for the registry.
4. **Enqueue.** Call the enqueue service (#260) at the real trigger, with a
   `payload` of **identifiers**, not copies of data — the job may run minutes
   later, and a row it names should be re-read at run time rather than
   carried inside a payload that can go stale.

No migration, no enum arm, no queue wiring, and the type appears in the admin
dashboard automatically. Optionally add a display label in
`job-type-labels.ts`; an unmapped type renders as itself (§3).

To make a type node-eligible, add **both** `nodeResultSchema` and
`persistNodeResult` — and nothing else (§2).

## Rejected alternatives

- **Redis / BullMQ.** A second datastore on a template's default path, paid
  for by every fork whether or not it uses the queue. This repository already
  requires PostgreSQL, and `FOR UPDATE SKIP LOCKED` is a correct claim
  primitive.
- **`@JobHandler()` decorator + `DiscoveryService`.** More magic, harder to
  trace, still needs a registry underneath, and a third mechanism for a job
  this repo already does explicitly twice (§1.2).
- **A `nodeEligible: boolean` flag.** Can disagree with the members it
  describes; deriving eligibility makes the wrong state unrepresentable
  (§2).
- **A result object from `process` (`{ success, error }`).** Copies the
  object-processor contract into a place whose failure semantics are
  different, and makes "silently reported success for work that never
  happened" the *default* outcome of forgetting an `await` (§1.1).
- **Throwing on a duplicate `type`.** Turns a legitimate fork-level override
  into a boot failure for the whole application (§1.2).
- **A required `label` on `JobHandler`.** Enlarges the contract every future
  handler must satisfy, for something the worker never reads (§3).
- **Making the database backup a job type.** Recorded in epic #254's own
  locked decisions and repeated here because it is the obvious thing to try:
  the stuck-job threshold would reset a 30-minute `pg_dump` and start a
  *second concurrent* one. A dedicated run table with its own heartbeat is
  the correct shape, and it is why `database_backup_runs` is not a `jobs`
  row.

## Verification

What #259 actually proves, and by what:

| Claim | Covered by |
|---|---|
| The example handler self-registers and appears in `types()` | `job-handler.registry.spec.ts` — boots `JobsModule` through `Test.createTestingModule(...).init()`, so the real `onModuleInit` hook runs |
| `serverOnlyTypes()` includes a neither-member handler and excludes a both-member one | `job-handler.registry.spec.ts` |
| A handler carrying exactly one of the two members is server-only | `job-handler.registry.spec.ts`, both directions (schema-only, persist-only) |
| A duplicate `type` warns and the last registration wins | `job-handler.registry.spec.ts` — asserts the `Logger.warn` call and that `get()` returns the second instance |
| An unmapped type renders as itself | `job-type-labels.spec.ts` |
| The module graph still boots with `JobsModule` registered | `npm run openapi:dump` (preview-mode boot of `AppModule`) plus `npm run openapi:lint` |

Be honest about the limits: none of this exercises a job actually being
claimed out of Postgres and run, because #259 ships no worker and no enqueue
path — there is nothing yet that writes a `jobs` row. The concurrency
guarantee epic #254 cares about most ("two processes claiming concurrently
never receive the same row") is #260's to prove, against the real Postgres the
`*.db.spec.ts` convention and CI's smoke job provide.
