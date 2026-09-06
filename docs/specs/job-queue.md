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
> `apps/api/src/jobs/jobs.service.ts`,
> `apps/api/src/jobs/job-claim.service.ts`,
> `apps/api/src/jobs/jobs.module.ts` and
> `apps/api/src/jobs/handlers/`.
>
> **On what is merged today.** Sections 1–3 describe what #259 shipped: the
> contract, the registry, the labels map, the example handler and the module.
> Section 4 describes what #260 shipped: enqueue with index-backed dedup, and
> the atomic `SKIP LOCKED` claim. Sections 5–7 are deliberate stubs for the
> issues that fill them in, marked as such. Where an unmerged issue's
> behaviour is referenced from a merged section (the worker's lifecycle phase,
> for instance) it is stated as a **constraint that issue must satisfy**, not
> as behaviour verified in this checkout.
>
> **Nothing polls yet.** #260 adds the two halves of moving a row through the
> table, and no timer. The thing that calls `claim()` on a tick is the
> in-process worker pool (#262).

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

## 4. Enqueue, dedup, and the atomic claim

`apps/api/src/jobs/jobs.service.ts` writes rows into `jobs`;
`apps/api/src/jobs/job-claim.service.ts` takes them out. They are two
services rather than one because they have different callers — every feature
enqueues, only a worker or the node control plane claims — and different
failure modes.

### 4.1 Enqueue: the database decides dedup, not a prior `SELECT`

`enqueue()` inserts **optimistically** and treats the resulting unique
violation as "a duplicate is already in flight". There is no pre-flight
"is there already an active job with this key?" query anywhere in the enqueue
path, and adding one would be a regression rather than an optimisation:

```
INSERT  →  P2002 on jobs_active_dedup_uniq_idx  →  re-read the ACTIVE row  →  return it
```

**Rejected: `findFirst`-then-`create`.** It is a check-then-act race, and it
is racy *exactly when dedup matters*. Two concurrent enqueues both run the
`findFirst`, both see no active duplicate, and both insert — which is
precisely the outcome a dedup key exists to prevent. Under real load (a
webhook redelivered while the first delivery is still being handled, two
replicas reacting to the same event, a user double-clicking) that window is
not a rare edge case, it is the normal case. Only the database can make "is
there already an active job with this key" atomic with the insert that would
violate it. The `Job` model's own block comment in `schema.prisma` records
the same rejection from the schema side; this is the enqueue-path half of
that argument.

What makes it atomic is `jobs_active_dedup_uniq_idx` — a partial UNIQUE index
on `dedup_key` filtered to `status IN ('pending','running') AND dedup_key IS
NOT NULL`, hand-written in
`prisma/migrations/20260906120000_add_jobs/migration.sql` because Prisma's
`@@index` DSL cannot express a `WHERE` clause. The key's *format* is defined
once, in `buildDedupKey()` (`src/jobs/job-keys.ts`); the index has no opinion
on how the string was built, only that it is unique among still-active jobs.

**The caller cannot tell which happened, and that is the point.** `enqueue`
returns either the row it just inserted or the active row that beat it to the
key, with no flag distinguishing them: the postcondition is "a job for this
work is queued", and that is true either way. One consequence worth stating
plainly, because it looks like a bug the first time it is noticed: when dedup
collapses a call, the returned row's `reason`, `priority`, `payload` and
`scheduledFor` are the **first** caller's. That is the definition of dedup,
not an oversight — the work is already queued, and a second request to do the
same work is not a reason to reconfigure the job that is about to do it (or,
worse, to mutate a row a worker may already have claimed). A caller that
genuinely needs its own row wants `skipDedup: true`.

### 4.2 `skipDedup` is free, because Postgres treats every NULL as distinct

`skipDedup: true` does not disable a code path, take a different branch
through the index, or need a second insert strategy. It leaves `dedup_key`
NULL — and a NULL is never equal to another NULL for uniqueness purposes, so
any number of NULL-keyed rows coexist under the same unique index. There is
no "dedup off" mode, only a key that no other row can collide with. The
index's predicate spells `dedup_key IS NOT NULL` out explicitly so this is
documented as relied upon rather than incidental.

The mirror-image property: because the index is filtered to
`pending`/`running`, a job reaching `succeeded` or `failed` **drops out of the
predicate and frees its key**. Re-triggering the same logical work an hour
later is allowed; only work that is still in flight is collapsed. Dedup never
permanently blocks a job on its own history.

### 4.3 Two failure modes the conflict path has to get right

**A P2002 from any other constraint must propagate.** `isActiveDedupConflict()`
attributes the violation to *this* index specifically — by the constraint
fields, by the index name in the driver's original message, or by `meta.target`
on the classic query engine — and anything it does not positively recognise is
rethrown untouched. Treating every P2002 as "already queued" would make
`enqueue` return some unrelated row for a genuine constraint bug, which is the
exact class of error that must stay loud. Two metadata shapes are inspected
rather than one so that switching adapters degrades to "the P2002 propagates",
never to "an unrelated conflict is silently swallowed".

**The re-read can lose its own race.** Between the INSERT failing and the
SELECT running, the job that held the key can reach `succeeded` or `failed`,
leave the index's predicate, and free the key — leaving no active row to
return. Nothing is wrong; the world moved on between two statements. Three
answers were available:

- *Widen the re-read to any status and return the settled row.* **Rejected.**
  The caller asked for work to be QUEUED, and handing back a job that already
  finished reports success for work that will never run — the worst possible
  answer, and unrecoverable by the caller, which cannot tell that row apart
  from one about to execute.
- *Throw the P2002.* **Rejected.** The condition it describes ("a duplicate is
  in flight") is no longer true by the time it would be reported.
- *Insert again.* **Chosen.** The key is free now, so the retry normally
  succeeds outright; if it collides again, the next iteration's re-read finds
  whichever job took the key.

The retry is **bounded** (three attempts). An unbounded loop would be correct
in theory and a livelock in practice: a pathologically hot key whose jobs
settle within microseconds could spin a request thread indefinitely. Three
covers the real race — which needs a conflicting job to finish inside the few
milliseconds between a failed insert and a re-read — and turns the
pathological case into a visible error rather than a hang.

### 4.4 The claim is one statement

```sql
UPDATE jobs SET
  status = 'running', started_at = now(), scheduled_for = NULL,
  attempts = attempts + 1,
  claimed_by_node_id = $nodeId::uuid, executor = $executor,
  lease_expires_at = now() + ($leaseMs * interval '1 millisecond')
WHERE id IN (
  SELECT id FROM jobs
  WHERE status = 'pending'
    AND (scheduled_for IS NULL OR scheduled_for <= now())
    AND type = ANY($types::text[])
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $limit
)
RETURNING …
```

The inner `SELECT` picks eligible rows and locks them, skipping any row
another transaction already holds; the outer `UPDATE` marks exactly those rows
`running` and hands them back. There is no window between "I chose this row"
and "I own this row" in which a second claimer can choose it too, because
there is no gap between the two — they are the same statement, in the same
implicit transaction.

`ClaimOptions` is `{ nodeId, executor, eligibleTypes, limit, leaseMs }`, and
this method is **shared verbatim** by both claimers in this epic: the
in-process worker (#262) and the node control plane (#268). That is why the
options carry `nodeId` and `executor` rather than the service knowing which
side it is on — a second copy of this query, specialised per caller, is
exactly how the two would drift apart on the one statement that must not
drift.

**Rejected: `SELECT … FOR UPDATE` then a separate `UPDATE`.** Two statements,
two round trips, a wider window in which the claiming process can die between
them, and no gain whatsoever — the second statement re-finds rows the first
already identified. `SKIP LOCKED` plus `RETURNING` collapses both into one.

**Rejected: an advisory lock around the claim.** It works, and it serialises
every claimer in the fleet through a single lock: with N workers, N-1 wait to
run a query that takes microseconds. `SKIP LOCKED` is *the* primitive for
"give me a row nobody else is working on" — it never blocks, it steps over
contended rows.

**Rejected: an in-process mutex** — which is what the source application this
design was extracted from actually started with. It serialises claims WITHIN
one process and is completely blind outside it, so it works perfectly on a
laptop, works perfectly with one replica, and double-claims the moment a
second replica is scheduled or a remote node joins. **This is the bug this
design exists to avoid:** a correctness property that holds right up until the
first time the system is scaled.

**Two short circuits, before any round trip.** An empty `eligibleTypes` or a
`limit <= 0` returns `[]` without querying. Both are ordinary states rather
than misconfigurations — a `system`-mode worker with no server-only handlers
registered has the first, a pool with every slot busy has the second — and the
query would correctly return nothing in both cases (`type = ANY('{}')` matches
nothing, `LIMIT 0` returns nothing). This is purely about not paying for a
database round trip on every poll tick to be told what is already known.

**`ORDER BY` selects *which* rows, not the order they come back in.** The
ordering lives in the inner `SELECT`, where it decides what the claim takes:
most urgent first (`priority` ASC — see the `Job` model comment), oldest first
within a priority. SQL gives `UPDATE … RETURNING` no ordering guarantee at
all, so the returned array is a **set, not a sequence**. Nothing in this epic
needs it sorted — a worker dispatches each claimed job independently — and
"fixing" it would mean wrapping the statement to obtain an outer `ORDER BY`,
trading the single-statement atomicity the whole design rests on for an
ordering nobody wants.

### 4.5 `attempts` is charged at CLAIM time — it means "attempts started"

`attempts = attempts + 1` is in the claim statement, not in any failure path,
and this is a correctness decision rather than a convenience.

A job can take the whole process down with it: an OOM kill, a hard crash, a
container the orchestrator terminates mid-run. **None of those reach a failure
handler** — there is no handler left to reach. So if `attempts` were charged
when a job *fails*, such a job would be requeued with its budget untouched,
claimed again, kill the process again, and crash-loop the container for as
long as anyone let it. The retry budget would be unreachable by exactly the
failures it most needs to bound.

Charging at claim makes the counter mean "attempts **started**", which is the
only thing observable from outside a process that may not survive. It is what
lets the lease reaper (#263) find a job whose lease expired with its budget
spent and mark it permanently `failed` — bounding a poison pill to N crashes
instead of infinity.

The cost is honest and small: a job whose worker was killed for reasons of its
own (a deploy, a node drain) is charged an attempt it did not deserve. A retry
budget losing one of N on a redeploy is a far better failure than an unbounded
crash loop.

Two consequences that live elsewhere, recorded here so neither is
rediscovered as a bug:

- **The rate-limit deferral path (#261) explicitly UN-CHARGES this
  increment.** A provider throttling us is not an attempt at the work, and a
  job merely waiting its turn must not exhaust a budget meant for a job that
  keeps failing. That is also why `rateLimitHits` is a separate counter — §5,
  and the `Job` model's block comment, argue the same point from the schema
  side.
- **`attempts` is already 1 by the time a handler's `process()` runs.** Code
  reading it inside a handler is reading the count *including* the current
  attempt, never excluding it.

### 4.6 `RETURNING` aliases every column to its camelCase Prisma field

The table is snake_case; the generated `Job` type is camelCase. Aliasing every
column (`created_at AS "createdAt"`, and so on for all 22) means the rows
Postgres hands back **are** `Job` values — no mapping function between the
query and its callers, and therefore no mapping function to forget a field in.
`claim()` returns `Job[]` with no cast-and-hope in between.

The alias list is *derived* from `JOB_CLAIM_COLUMNS`, a map typed
`Record<keyof Job, string>`, rather than typed out inline. That is what turns
a schema change into a **compile error**: adding a column to `Job` fails to
compile until the map covers it, and renaming one fails to compile on the
stale key. Written out by hand instead, the same rename would produce a row
missing a field — silently `undefined` at every call site, surfacing as a
null-ish value somewhere downstream rather than at the line that caused it.
`test/jobs/job-model-fields.spec.ts` locks the same pairing down from the test
side, comparing the map's key set against the generated
`Prisma.JobScalarFieldEnum`.

The list is built with `Prisma.raw`, because a column list is SQL *structure*
and structure cannot be parameterised. It is safe for a reason that has
nothing to do with trusting a caller: the only input is a module-level
constant evaluated once at import time, with no path from any request,
argument or environment variable to that string. Every genuine value in the
claim — node id, executor, lease, type list, limit — goes through a real bound
placeholder.

### 4.7 `recordProvider` never throws

`recordProvider(jobId, providerKey, modelVersion)` writes the two audit
columns and swallows any failure with a `warn`. Those columns are written once
near completion and read by nobody — not the claim query, not any scheduling
decision (the `Job` model says as much). Letting a failed annotation propagate
would fail a job whose real work already succeeded, turning a missing note
into a retry of work that does not need retrying. The commonest failure is
entirely benign: queue hygiene (#263) purged the row before the audit write
ran.

### 4.8 What proving this required

The concurrency guarantee is a claim about **Postgres**, so it is asserted
against a real one. A mocked `$queryRaw` returns whatever a test told it to,
so "two claimers never receive the same row" asserted against a mock proves
only the mock's arrangement — not `SKIP LOCKED`, not row locks, not the fact
that the claim is a single statement. The `*.db.spec.ts` suites therefore run
the **real services** over two independent `PrismaClient` instances, each with
its own connection pool, which is as close to two API replicas as one process
gets. See the Verification table below for the mapping from claim to test.

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
>
> Already fixed by §4.5 and not up for rediscovery there: `attempts` is
> charged at CLAIM time and means "attempts started", so the deferral path
> must explicitly **un-charge** the increment the claim applied — it is not
> merely "declining to add one".

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
4. **Enqueue.** Call `JobsService.enqueue()` at the real trigger, with a
   `payload` of **identifiers**, not copies of data — the job may run minutes
   later, and a row it names should be re-read at run time rather than carried
   inside a payload that can go stale. Jobs of the same type against the same
   subject collapse onto one active row by default; pass `skipDedup: true`
   when several such jobs are legitimately distinct work (§4.1–4.2).

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
- **`findFirst`-then-`create` dedup.** A check-then-act race that fails
  exactly when dedup matters — two concurrent enqueues both see no duplicate
  and both insert. Superseded by the partial unique index from #255, which
  makes the check atomic with the insert (§4.1).
- **`SELECT … FOR UPDATE` then a separate `UPDATE` to claim.** Two
  statements, a wider window, and no gain — the second re-finds rows the
  first already identified (§4.4).
- **An advisory lock around the claim.** Serialises every claimer in the
  fleet through one lock; `SKIP LOCKED` is exactly the primitive for "give me
  a row nobody else is working on" (§4.4).
- **An in-process mutex around claiming.** What the source application
  started with. Serialises claims within one process only, so it double-claims
  the moment a second replica or a remote node appears — the bug this design
  exists to avoid (§4.4).
- **Charging `attempts` on failure rather than at claim.** A job that kills
  its process never reaches a failure path, so its budget would never be
  charged and it would crash-loop the container forever (§4.5).
- **Making the database backup a job type.** Recorded in epic #254's own
  locked decisions and repeated here because it is the obvious thing to try:
  the stuck-job threshold would reset a 30-minute `pg_dump` and start a
  *second concurrent* one. A dedicated run table with its own heartbeat is
  the correct shape, and it is why `database_backup_runs` is not a `jobs`
  row.

## Verification

What #259 proves, and by what:

| Claim | Covered by |
|---|---|
| The example handler self-registers and appears in `types()` | `job-handler.registry.spec.ts` — boots `JobsModule` through `Test.createTestingModule(...).init()`, so the real `onModuleInit` hook runs |
| `serverOnlyTypes()` includes a neither-member handler and excludes a both-member one | `job-handler.registry.spec.ts` |
| A handler carrying exactly one of the two members is server-only | `job-handler.registry.spec.ts`, both directions (schema-only, persist-only) |
| A duplicate `type` warns and the last registration wins | `job-handler.registry.spec.ts` — asserts the `Logger.warn` call and that `get()` returns the second instance |
| An unmapped type renders as itself | `job-type-labels.spec.ts` |
| The module graph still boots with `JobsModule` registered | `npm run openapi:dump` (preview-mode boot of `AppModule`) plus `npm run openapi:lint` |

What #260 proves, and by what. Everything in the first block runs against a
**real Postgres** (`npm run test:db`, which CI's `smoke` job invokes after
`prisma:migrate`); everything in the second runs without one:

| Claim | Covered by |
|---|---|
| Two claimers racing for one row: exactly one wins, every round | `test/jobs/job-claim.db.spec.ts` — two independent `PrismaClient`s, ten rounds, deterministic |
| Concurrent claimers over a seeded batch get a disjoint partition: no id twice, none lost | `test/jobs/job-claim.db.spec.ts` — an eight-way overlapping burst, then a drain; the union is asserted against what was seeded |
| `ORDER BY priority ASC, created_at ASC` is honoured: a priority-0 job enqueued later is claimed before a priority-100 job enqueued earlier | `test/jobs/job-claim.db.spec.ts` |
| Oldest-first within one priority (asserted as a **set** — see §4.4 on `RETURNING` ordering) | `test/jobs/job-claim.db.spec.ts` |
| A job scheduled for the future is not claimed; the same job is once that time passes | `test/jobs/job-claim.db.spec.ts` |
| `attempts` is 1 immediately after the claim, before any handler runs, and is durable | `test/jobs/job-claim.db.spec.ts` |
| A claimed row carries `running`, `startedAt`, the lease, the executor and the node id | `test/jobs/job-claim.db.spec.ts` |
| Every `RETURNING` alias matches a generated `Job` field | `test/jobs/job-claim.db.spec.ts` (key set of a row Postgres produced) and `test/jobs/job-model-fields.spec.ts` (key set of `JOB_CLAIM_COLUMNS` against `Prisma.JobScalarFieldEnum`) |
| Concurrent `enqueue` of one dedup key yields ONE row and BOTH callers receive it | `test/jobs/jobs-enqueue.db.spec.ts` — two clients head-to-head, plus a ten-way burst |
| `skipDedup: true` yields two rows, both with a NULL key | `test/jobs/jobs-enqueue.db.spec.ts` |
| Dedup collapses onto a `running` job, and a settled job frees its key | `test/jobs/jobs-enqueue.db.spec.ts` |

| Claim | Covered by |
|---|---|
| Both claim short circuits return `[]` **without a round trip** | `src/jobs/job-claim.service.spec.ts` — asserts `$queryRaw` was never called, which a database test cannot see |
| Every runtime value is a bound parameter; none appears in the SQL text | `src/jobs/job-claim.service.spec.ts` — asserts on `Prisma.Sql`'s `values` and `sql` |
| A P2002 on any other constraint propagates; a non-conflict error propagates | `src/jobs/jobs.service.spec.ts` |
| The re-read losing its own race retries rather than returning a settled job | `src/jobs/jobs.service.spec.ts` |
| The retry is bounded and gives up loudly | `src/jobs/jobs.service.spec.ts` |
| `recordProvider` swallows a failed audit write | `src/jobs/jobs.service.spec.ts`, and end to end in `test/jobs/jobs-enqueue.db.spec.ts` |
| Enqueue never pre-checks with `findFirst` before inserting | `src/jobs/jobs.service.spec.ts` |
| `JOB_CLAIM_COLUMNS` covers exactly the generated `Job` field set | `test/jobs/job-model-fields.spec.ts` (the compile-time half is the `Record<keyof Job, string>` type itself) |

Be honest about the limits: nothing yet exercises a claimed job being **run**.
There is no worker and no terminal state machine — a claimed row stays
`running` with a lease until #261 and #262 arrive. What is proved is that a
row can be written exactly once under concurrency, and taken exactly once
under concurrency.
