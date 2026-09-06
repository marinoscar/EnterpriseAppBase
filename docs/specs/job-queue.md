# Background Job Queue

> Epic #254, issues #255, #256, #259–#266. Implements a generic
> Postgres-backed background job queue in a new `apps/api/src/jobs/` module,
> backed by a new `jobs` table. Sibling specs:
> [Worker Nodes](worker-nodes.md) (epic #254, #267–#279) builds the
> distributed claim/execute plane *on top of* this queue, and
> [Database Backup & Restore](database-backup.md) (epic #254, #280–#287)
> deliberately does **not** use this queue — see
> [§2](#2-relationship-to-the-other-two-specs) for why.

**Status: design specification for planned work. Nothing in this document
exists in the codebase yet.** There is no `apps/api/src/jobs/` directory, no
`jobs` table, no `JobHandler` interface, and no admin API under
`/api/admin/jobs`. This document is what issues #255, #256 and #259–#266
build against; a child issue may discover a better answer to a specific
sub-problem, but it must keep the contracts this document promises to the
two sibling specs (the `JobHandler` shape, the claim statement's column
names, the terminal-state event, the settings namespace).

## Contents

1. [Why Postgres, not Redis/BullMQ](#1-why-postgres-not-redisbullmq)
2. [Relationship to the other two specs](#2-relationship-to-the-other-two-specs)
3. [Data model](#3-data-model)
4. [The handler contract](#4-the-handler-contract)
5. [Claiming a job](#5-claiming-a-job)
6. [The terminal state machine](#6-the-terminal-state-machine)
7. [The worker](#7-the-worker)
8. [Hygiene: reaping, purging, and the temp-file janitor](#8-hygiene-reaping-purging-and-the-temp-file-janitor)
9. [Admin API](#9-admin-api)
10. [Insights](#10-insights)
11. [Adding a new job type](#11-adding-a-new-job-type)
12. [Settings and environment reference](#12-settings-and-environment-reference)
13. [The six hand-maintained settings places](#13-the-six-hand-maintained-settings-places)
14. [Rejected alternatives](#14-rejected-alternatives)
15. [Open questions for the child issues](#15-open-questions-for-the-child-issues)

## 1. Why Postgres, not Redis/BullMQ

This repository requires Postgres already — every environment that can run
this template has it, and `common/database-url.ts` derives a connection
string for it from five environment variables with no service of its own in
`infra/compose/base.compose.yml`. A background queue is exactly the kind of
feature a template ships turned on by default, and requiring a *second*
datastore (Redis, for BullMQ or any of its cousins) on that default path is a
real adoption cost for every fork of this repository: one more service in
compose, one more connection string in `.env.example`, one more thing that
can be down when the API boots.

The primitive that makes a second datastore unnecessary is one line of SQL:

```sql
SELECT ... FROM jobs WHERE status = 'pending' ... FOR UPDATE SKIP LOCKED LIMIT $n
```

`FOR UPDATE SKIP LOCKED` gives exactly what a job queue needs from
concurrent claimants — each competing `SELECT` skips rows another
transaction already has locked, rather than blocking on them or double
returning them — without a broker, without a separate protocol, and without
anything to keep alive besides the database this application already
depends on. Postgres has offered it since 9.5; there is no version floor
this template does not already clear.

The trade this accepts, and accepts deliberately: Postgres is not as fast as
Redis at the pure "pop a message" operation, and a queue table under heavy
write load needs the same vacuum/index attention any other hot table needs.
For the volume a template application and its forks actually produce —
enrichment-style background work measured in the tens of jobs per second at
the very most, not a general-purpose message bus — that ceiling is not
reachable in practice, and the operational simplicity of "the queue lives in
the database you already have" outweighs it. A fork that genuinely
outgrows this (a high-throughput event pipeline, not a background-job queue)
has outgrown the entire *category* this feature is in and should reach for
a purpose-built broker, not push Postgres past what `SKIP LOCKED` is good
for.

## 2. Relationship to the other two specs

This queue is the shared substrate [Worker Nodes](worker-nodes.md) claims
jobs from — a node's `POST /api/nodes/:id/claim` call and this module's
in-process worker loop both go through the *same* claim statement
([§5](#5-claiming-a-job)), with `executor` recording which one won. Nothing
in this document assumes a node exists; the queue is fully useful with zero
nodes registered, running every job type in-process. Worker Nodes is
additive: it widens *who* can run a `pending` row, not what a row is.

[Database Backup & Restore](database-backup.md) deliberately does **not**
enqueue a `jobs` row for a `pg_dump`/`pg_restore` run, and that document
explains why in its own words, but the short version belongs here too
because it is this queue's own limitation, not a quirk of backups: this
queue's stuck-job threshold (`jobs.stuckThresholdMinutes`,
[§12](#12-settings-and-environment-reference)) is designed around
enrichment-style work — seconds to low minutes — and a legitimate 30-minute
`pg_dump` would be flagged stuck, reset to `pending`, and reclaimed by a
second worker slot while the first `pg_dump` is still running against the
same storage key. This queue also has no lease-*renewal* path for its own
in-process worker (only [Worker Nodes](worker-nodes.md)'s remote claimants
renew a lease); a job that legitimately runs long has no way to say "I am
still alive, don't reap me" short of finishing. A backup run needs a
dedicated table with its own heartbeat instead, which is exactly the shape
`database_backup_runs` takes. Anyone tempted to route a long-running,
single-flight, heartbeat-shaped piece of work through this queue instead of
giving it its own run table should re-read that reasoning first.

## 3. Data model

One table, `Job` → `jobs`, generic across every job type this template or
any fork of it will ever add:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `type` | `text` | Discriminates which `JobHandler` processes the row |
| `subjectType` | `text?` | The generic replacement for a domain FK — see below |
| `subjectId` | `text?` | See below |
| `dedupKey` | `text?` | Backs the partial unique index in [§3.1](#31-dedup-is-an-index-not-a-query) |
| `status` | `JobStatus` enum: `pending`\|`running`\|`succeeded`\|`failed` | |
| `reason` | `JobReason` enum: `upload`\|`rerun`\|`backfill` | Audit of why the row exists |
| `priority` | `Int @default(0)` | **Ascending = more urgent.** `0` runs before `100`. |
| `providerKey` | `text?` | Which external provider handled it, if any (audit) |
| `modelVersion` | `text?` | Which model/version handled it, if any (audit) |
| `payload` | `JsonB` | Handler-defined input |
| `attempts` | `Int @default(0)` | Charged at **claim** time — see [§5](#5-claiming-a-job) |
| `lastError` | `text?` | Set on every failed/deferred attempt |
| `createdAt` / `startedAt` / `finishedAt` | `DateTime` | |
| `scheduledFor` | `DateTime?` | `NULL` = eligible now; the claim query skips rows in the future |
| `rateLimitedAt` | `DateTime?` | Timestamp of the most recent rate-limit hit |
| `rateLimitHits` | `Int @default(0)` | Tracked separately from `attempts` — see [§6](#6-the-terminal-state-machine) |
| `claimedByNodeId` | `uuid?` | FK → `worker_nodes` (see [Worker Nodes](worker-nodes.md)), `onDelete: SetNull` |
| `leaseExpiresAt` | `DateTime?` | Set at claim time; consumed by the reaper ([§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor)) |
| `executor` | `text?` | `'server'` \| `'node'` — which side ran it |

### 3.1 Dedup is an index, not a query

The obvious way to prevent a duplicate enqueue is `findFirst({ where: {
dedupKey, status: { in: ['pending', 'running'] } } })` followed by a
`create` when nothing came back. That is exactly the design this spec
rejects, because it is racy precisely when dedup matters most: two
concurrent enqueue calls for the same `dedupKey` can both run the
`findFirst` before either `create` lands, and both create a row. The whole
point of `dedupKey` — collapsing "auto-tag this item" fired twice into one
row — silently fails under the load that makes duplicate enqueues likely in
the first place (a bulk import, a retried request).

Enforce it in the database instead, with a raw-SQL partial unique index that
Prisma's schema DSL cannot express:

```sql
CREATE UNIQUE INDEX jobs_dedup_key_live_uniq_idx
  ON jobs (dedup_key)
  WHERE status IN ('pending', 'running') AND dedup_key IS NOT NULL;
```

An enqueue becomes an ordinary `INSERT`. The loser of a race gets a
Postgres `P2002` unique-violation, which the enqueue service catches and
turns into "already queued — here is the existing row's id," never a second
row. This is deliberately **better** than a design built around
`findFirst`-then-`create`: the database is the single source of truth for
"does a live job with this key already exist," so there is no window in
which two callers can both believe the answer is no.

The `dedup_key IS NOT NULL` clause is not incidental — Postgres unique
indexes (and the underlying B-tree) treat every `NULL` as distinct from
every other `NULL`, so a caller that passes no `dedupKey` gets `skipDedup`
behaviour for free: any number of `NULL`-keyed rows can coexist without
touching the index at all. A handler that wants deduplication passes a key;
a handler that wants N independent rows for N items simply does not.

Two further raw-SQL partial indexes exist purely to keep the admin surfaces
in [§9](#9-admin-api) and [§10](#10-insights) fast without a full-table
scan:

```sql
CREATE INDEX jobs_retried_idx ON jobs (type) WHERE attempts > 1;
CREATE INDEX jobs_succeeded_duration_idx
  ON jobs (type, finished_at)
  WHERE status = 'succeeded' AND started_at IS NOT NULL;
```

...plus a covering index `jobs_status_type_id_idx (status, type, id)` so
that the two unconditional admin `groupBy` counts on the stats endpoint
(total count, by-status breakdown) are index-only scans rather than a heap
visit per row. All of the above are intentional schema drift — not
representable in Prisma's `schema.prisma` DSL — and must be documented as
such in a comment above the `Job` model, the same convention this repo
already uses for hand-authored indexes elsewhere (raw migrations that a
`prisma migrate diff` would otherwise want to "fix").

### 3.2 `subjectType`/`subjectId` are the generic replacement for a domain FK

This is a template with no domain model of its own — the concrete thing a
job acts on could be a storage object, a user, a settings key, or something
a fork adds next year that this repository has never heard of. A real
foreign key would need one column per domain table (`storageObjectId`,
`userId`, ...), each nullable, each meaningless for every job type but its
own — the schema equivalent of the `features: Record<string, boolean>` bag
this repo already uses for exactly this kind of forward-compatibility
problem. `subjectType` + `subjectId` is the same move applied to a queue
row: a job names *what kind* of thing it is about and *which one*, and nothing
in this table needs to know what a `"storage_object"` is.

**`subjectId` is `text`, not `uuid`.** A polymorphic reference has no
foreign key either way — there is no single table it could reference — so
typing it `uuid` buys no referential integrity and only forbids a
legitimate non-UUID subject: a settings key (`"geo.provider"`), a storage
key (`"uploads/2026/06/photo.jpg"`), an email address. The cost of the
looser type is real and accepted: an orphan job whose subject was deleted
is possible, since there is no FK to cascade from. That is bounded by the
history purge ([§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor))
— an orphan cannot accumulate forever — and every handler is written under
the assumption that its subject may have vanished by the time the job runs;
`process()` must treat a missing subject as a normal (if unusual) outcome,
not an exception that burns a retry.

### 3.3 `JobStatsRollup`

```prisma
model JobStatsRollup {
  type            String   @id
  succeededCount  Int      @default(0)
  failedCount     Int      @default(0)
  sumDurationMs   Float    // double precision — see below
  durationSamples Int      @default(0)
  updatedAt       DateTime @updatedAt
}
```

One row per job `type`, folded from terminal rows the nightly history purge
is about to delete ([§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor)),
so lifetime analytics survive purging. Only **exactly-mergeable** aggregates
live here: counts, and a running total of duration that divides back into an
average. Percentiles (p50/p95, [§10](#10-insights)) are *not* stored, because
they cannot be merged from two summaries — the p95 of two datasets is not a
function of their two individual p95s — and remain computed live over a
recent window that has not yet been purged.

`sumDurationMs` is `Float` (Postgres `double precision`), **never**
`BigInt`. Prisma maps a `BigInt` database column to the JavaScript `BigInt`
primitive, which `JSON.stringify` throws on — "Do not know how to serialize
a BigInt" — the moment any endpoint tries to return it. The failure mode is
exactly the kind this repository has been bitten by before with large
integers: an object-comparing unit test (`expect(row).toEqual({...})`) never
serializes anything and passes cleanly, while the real HTTP response 500s.
A running sum of millisecond durations for even a very large job count fits
comfortably inside a `double precision`'s 53 bits of exact integer
precision (2^53 ms is over 285,000 years), so there is no precision
argument for `BigInt` here in the first place — only the serialization trap
it would introduce for free.

## 4. The handler contract

The entire extension point — everything a job type is — is one interface:

```ts
export interface JobHandler {
  readonly type: string;

  /** Do the work. Throw to fail; the worker's terminal-state machine
   *  ({@link 6}) decides whether that throw becomes a retry, a rate-limit
   *  deferral, or a permanent failure. */
  process(job: Job): Promise<void>;

  /** Present ONLY on a node-eligible handler. The shape a node's submitted
   *  result must satisfy before it is trusted. */
  readonly nodeResultSchema?: z.ZodType;

  /** Present ONLY on a node-eligible handler. Persists an already-validated
   *  node result — no recompute, no downloads, no calls back out to any
   *  provider. This is the ENTIRE reason a node needs no database access
   *  and no storage credentials: everything it cannot be trusted to do
   *  itself, this method does on its behalf, server-side. */
  persistNodeResult?(job: Job, result: unknown): Promise<void>;
}
```

A handler carrying **both** optional members is node-eligible; a handler
carrying **neither** is server-only. There is no third state, and there is
no separate boolean flag (`nodeEligible: true`) sitting beside the two
methods that could disagree with them — `serverOnlyTypes()` (the function
[Worker Nodes](worker-nodes.md)'s claim endpoint calls to exclude ineligible
types from what it advertises) *derives* the list by checking which
registered handlers have both members, rather than reading a flag a handler
author could set inconsistently. Making eligibility a derived fact instead
of an independently-set flag is what makes "eligible flag set, but no
`persistNodeResult`" — the actually dangerous half-configured state — a
type the compiler refuses to construct rather than a bug the reviewer has to
notice.

`persistNodeResult` doing *only* the persist half, with the recompute and
the download left entirely to `process()`'s in-process path, is the load
bearing design decision the whole node plane depends on: it is what lets a
node run with no database connection and no storage secret at all (see
[Worker Nodes §1](worker-nodes.md#1-security-model-first)). A handler author
who is tempted to have `persistNodeResult` "just double check by
recomputing one field" has reintroduced the dependency this split exists to
remove.

Handlers self-register from their own module's `OnModuleInit`, appending
themselves to a `Map<string, JobHandler>` the worker and the node-result
endpoint both read from — never a hand-maintained array a new handler must
remember to append itself to. This is the same "one registry, several
consumers" shape this repository already uses for
`apps/api/src/notifications/notification-events.ts` and
`apps/api/src/openapi/tags.ts`: a job type that exists but is not in this
map is invisible to the worker, the admin API, and the node claim endpoint
alike, which is a much easier failure to notice (nothing ever runs it) than
a job type registered in three places that quietly disagree about what it
is.

## 5. Claiming a job

One raw SQL statement, run inside a transaction, is the entire claim
primitive — and it is the *same* statement whether the caller is this
module's own in-process worker or [Worker Nodes](worker-nodes.md)'s
`POST /api/nodes/:id/claim` route, parameterized only by `$nodeId` (`NULL`
for the in-process worker) and `$executor`:

```sql
UPDATE jobs SET
  status = 'running',
  started_at = now(),
  scheduled_for = NULL,
  attempts = attempts + 1,
  claimed_by_node_id = $nodeId::uuid,
  executor = $executor,
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
RETURNING
  id, type, "subjectType", "subjectId", status, reason, priority,
  "providerKey", "modelVersion", payload, attempts, "lastError",
  "createdAt", "startedAt", "finishedAt", "scheduledFor",
  "rateLimitedAt", "rateLimitHits", "claimedByNodeId", "leaseExpiresAt",
  executor;
```

The `RETURNING` list is aliased to the camelCase Prisma field names
explicitly, so a raw `$queryRaw` call hands back objects shaped exactly like
every other Prisma read in this codebase, and a handler never has to know
whether the `Job` it received came from a typed Prisma query or a raw claim
statement.

Sharing one statement between the in-process worker and the node HTTP route
is deliberate, not an implementation convenience: it is what guarantees the
in-process worker and every registered node are drawing from the *same*
pending pool with the *same* locking discipline, so a fork can add nodes to
a deployment that has run in-process-only for months with zero risk of a
job being claimed twice by the two different code paths racing each other
under two different locking strategies.

### 5.1 `attempts` is charged at claim time

This is the single most important invariant in this document, and it is
worth stating twice: `attempts` means **"attempts started,"** not "attempts
that reached a failure branch." A job whose process is OOM-killed mid-run
never reaches any in-process failure handler at all — the process simply
stops existing — so if `attempts` were only ever incremented from inside a
`catch` block, that job's counter would never move, the reaper
([§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor)) would reset it
to `pending` forever, and a poison-pill job (one whose payload reliably
crashes the whole process, not just the one `await`) would crash-loop the
container indefinitely with no way for the retry budget to ever catch it.

Charging at claim time closes that gap for free: the reaper compares
`attempts` against `JOBS_MAX_ATTEMPTS` and marks an over-budget stuck row
**permanently failed** instead of resetting it to `pending` yet again,
which bounds a poison-pill job to exactly `JOBS_MAX_ATTEMPTS` container
crashes rather than an unbounded number.

**Rejected: an in-process mutex or claimed-ids `Set` instead of a database
lock.** This only serializes claims within one process. The moment a
second API replica exists — which this queue must support on day one, since
horizontal scaling of the API is a normal deployment shape this template
already assumes — two replicas' in-memory mutexes know nothing of each
other, and both can claim the same `pending` row in the same instant. The
moment [Worker Nodes](worker-nodes.md) adds a *third* kind of claimant
(a remote node over HTTP), an in-process mutex on the API side protects
against nothing at all on that path. `FOR UPDATE SKIP LOCKED` is correct
under every one of those topologies simultaneously, for free, because it is
enforced by the one thing every claimant already talks to: the database.

## 6. The terminal state machine

One service — `job-terminal.service.ts` — is the single chokepoint both the
in-process worker and the node result-ingestion route
([Worker Nodes §5](worker-nodes.md#5-two-shared-guards-in-the-service))
settle a job through. Splitting this logic between two call sites (one for
the in-process worker's own retry loop, one for a node reporting failure)
is exactly how the two executors would drift: a bug-fix to the backoff
formula applied to only one of them would leave a node-reported failure
retried on a different schedule than a server-reported one, silently, until
someone compared the two by hand.

Two genuinely different kinds of failure exist, and the state machine treats
them differently on purpose:

- **A normal failure** (a bug, a malformed input, an unhandled exception in
  the handler) should burn a small attempt budget quickly. There is no
  reason to wait — the job is either going to succeed on a retry moments
  later or it is broken and should fail out soon so an operator sees it.
- **A rate limit** (an upstream provider returning 429, or an
  overload-style 5xx) is not a bug in the job at all. It should back off
  for minutes, not seconds, and — critically — it must **not** consume the
  same attempt budget a bug would, because a provider having a bad five
  minutes is not evidence the job itself is broken.

```ts
// Rate-limit branch: an ABSOLUTE write, never a decrement.
await tx.job.update({
  where: { id: job.id },
  data: {
    status: 'pending',
    attempts: job.attempts - 1,      // undo the claim-time charge
    rateLimitedAt: new Date(),
    rateLimitHits: { increment: 1 },
    scheduledFor: nextBackoffTime,
    lastError: message,
  },
});
```

Writing `attempts: job.attempts - 1` as an **absolute** value, computed from
the `job` snapshot the caller already holds, rather than `{ decrement: 1 }`,
is deliberate: `safeTerminalUpdate` (below) may retry this exact write once
on a transient database error, and a `decrement` re-applied on that retry
would subtract twice for one logical rate-limit hit. An absolute value
computed once from a value already in hand is idempotent under a retried
write in a way a relative one is not.

`safeTerminalUpdate` wraps every terminal write: it retries the write itself
once, and if that also fails, it logs the failure and swallows it rather
than propagating — freeing the worker's slot immediately and leaving the row
exactly where it is (still `running`, with a stale lease) for the reaper to
pick up on its own schedule, rather than holding the slot open indefinitely
while it argues with the database about how to record a failure. A slot
wedged forever because writing "this job failed" itself failed is a worse
outcome than one job's terminal state arriving a few minutes late via the
reaper.

### 6.1 Backoff: equal-jitter exponential

```
exp   = min(maxMs, baseMs * 2^(attemptNumber - 1))
delay = max(retryAfterMs ?? 0, exp / 2 + random() * (exp / 2))
```

Jitter is not cosmetic. Without it, every job deferred by the same outage
(a provider's whole API going down for sixty seconds) computes the *exact
same* backoff delay and therefore retries in the same millisecond, turning
one outage into a synchronized thundering herd against a provider that has
just told every caller to slow down. Equal jitter — half the exponential
value, fixed, plus up to another half chosen at random — keeps the *worst
case* delay identical to plain exponential backoff (so recovery is not
slower on average) while spreading the retries across a window instead of a
point.

`retryAfterMs`, when the provider supplied one, is a **floor**, not a
suggestion folded into the formula: the provider is telling this system the
earliest moment retrying could possibly succeed, and a jittered backoff that
computed to less than that would just fail again for a reason already known
in advance.

### 6.2 Classifying a rate limit

```ts
function classifyRateLimit(err: unknown): { isRateLimit: boolean; retryAfterMs?: number } {
  const status = err?.status ?? err?.response?.status ?? err?.$metadata?.httpStatusCode;
  // 429 and overload-flavoured 5xx (528/529/529-style vendor overload codes)
  // both mean "not now," not "this call was wrong."
  const isRateLimit = status === 429 || isOverloadStatus(status) || isAwsThrottleError(err);
  const retryAfterMs = parseRetryAfter(err?.headers?.['retry-after']); // seconds OR an HTTP-date
  return { isRateLimit, retryAfterMs };
}
```

Reading `err.status`, then `err.response?.status` (axios-shaped clients),
then `err.$metadata?.httpStatusCode` (AWS SDK v3-shaped clients), in that
order, is what lets one classifier serve every provider a fork plugs a
handler into without that handler having to know how to unwrap its own SDK's
error shape. `Retry-After` is parsed as *either* an integer number of
seconds *or* an HTTP-date, because the header is legitimately specified both
ways and a parser that only accepts one will silently ignore the other half
of what real providers send. AWS-specific throttle *names* (e.g.
`ThrottlingException`, `TooManyRequestsException`) are recognized
independently of status code, because some AWS services throttle with a 400
that carries no numeric signal at all that a bare status check would catch.

A **per-provider cooperative throttle gate** sits in front of this — when
one call at `JOBS_WORKER_CONCURRENCY > 1` gets rate-limited, the gate backs
off every *other* in-flight or about-to-start call against the same
provider key, rather than letting nine siblings independently hammer a
provider that has just said "slow down" to the tenth. Without this, raising
concurrency to speed up a bulk operation makes rate-limit storms *more*
likely, not less, exactly when a provider is already stressed.

A `job.settled` event fires from — and only from — the genuinely terminal
branches (`succeeded`, and `failed` once the attempt/rate-limit budget is
exhausted), **after** the corresponding write has committed, from inside a
`try`/`catch` that never lets a subscriber's own failure roll back or mask
the job's own outcome. An intermediate retry or a rate-limit deferral is
*not* terminal and does not fire this event — a future notification
producer or audit listener subscribing to it inherits "only ever told once,
only ever told the truth" for free, with no chance of ever seeing a job's
terminal state twice or seeing it early.

## 7. The worker

The in-process worker is N independent slot loops — not a batch that claims
a page of jobs and waits for the whole page before claiming the next one.
Each slot repeatedly: claim one job (or none, and sleep) → run it under a
per-job timeout → settle it → loop. Independent loops rather than a shared
batch barrier matters for the same reason it matters in
[Worker Nodes §7](worker-nodes.md#7-the-nodeengine-loop-is-a-continuous-top-up-pool-not-a-batch-drain):
a batch design collapses effective concurrency toward whichever job in the
batch takes longest, because every slot sits idle waiting for the slowest
one before any of them can pick up new work.

**Slot loops start from `OnApplicationBootstrap`, never `OnModuleInit`.**
Handlers self-register from their own `OnModuleInit`
([§4](#4-the-handler-contract)), and Nest does not guarantee module
initialization order across independent feature modules — the jobs module's
own `OnModuleInit` could run before, after, or interleaved with a handler
module's. Starting the worker from `OnModuleInit` therefore races
registration: on an unlucky boot order, the worker's first poll finds a
handler map that does not yet contain a type that genuinely exists, treats
the corresponding pending jobs as "no handler for this type," and — because
that failure looks exactly like a normal handler exception —
permanently fails otherwise-good jobs through the ordinary retry-exhaustion
path before the handler that would have processed them correctly has even
finished registering. `OnApplicationBootstrap` fires only after *every*
module's `OnModuleInit` has resolved, which is what makes "the handler map
is complete before the worker's first poll" a guarantee instead of a race
this codebase would otherwise have to get lucky about on every boot.

`JOBS_WORKER_MODE` selects what this instance's in-process worker claims:

| Value | Behaviour |
|---|---|
| `all` (default) | Claims every registered type. Correct for a single-instance deployment with no worker nodes. |
| `system` | Claims only server-only types (handlers with neither `nodeResultSchema` nor `persistNodeResult` — [§4](#4-the-handler-contract)) plus any types named in `JOBS_SYSTEM_MODE_EXTRA_TYPES`. Node-eligible types are left entirely to registered nodes. |
| `off` | Claims nothing. Every claimable job type must be served by a node ([Worker Nodes](worker-nodes.md)). |

An unrecognised value (a typo — `systm`, `System`) **warns once at boot and
falls open to `all`**, never falls closed to `off`. A typo silently
stopping *all* background work in a production deployment, discovered only
when someone notices jobs never finish, is a far worse failure than that
same typo being logged loudly and the worker running with its safest
default. Fail-open is the correct direction specifically because the failure
mode of "runs more than intended" (a redundant in-process claimant
alongside a node fleet) is a performance question, while "runs nothing"
silently stalls every feature that depends on background work.

Per-job execution has a hard timeout enforced with `Promise.race` against
the handler's own promise — JavaScript has no way to forcibly cancel an
in-flight `await`, so "timing out" a job means the *worker* stops waiting
and frees the slot for the next claim, while the abandoned handler promise
is left to settle (or never settle) on its own, in the background, with its
eventual result discarded. This is a real, accepted limbo state — a
handler that ignores an `AbortSignal` (if it is even passed one) keeps doing
whatever it was doing, consuming whatever resources it was consuming, after
the queue has already moved on and marked the job failed for exceeding its
budget. Handler authors are expected to accept and honour cancellation
where the underlying operation supports it (an HTTP client's
`AbortController`, a child process's `SIGKILL`); the queue cannot force
this from the outside.

## 8. Hygiene: reaping, purging, and the temp-file janitor

**The lease/stuck reaper** runs on a cron and resolves three independent
signals, any one of which marks a `running` row as needing attention:

1. `startedAt` older than `jobs.stuckThresholdMinutes` — the ordinary
   "this has been running suspiciously long" case.
2. `startedAt IS NULL` on a `running` row — a zombie row from a crash
   between the claim `UPDATE` and the handler actually starting; aged by
   `createdAt` instead, since `startedAt` never got set.
3. `leaseExpiresAt` in the past — a node-claimed job whose lease was never
   renewed (see [Worker Nodes](worker-nodes.md) for the renewal contract);
   this is the *only* signal that fires for a node-executed job, since a
   node's own process lifetime is invisible to this reaper.

A row matching any of the three, with `attempts >= JOBS_MAX_ATTEMPTS`, is
marked `failed` outright ([§5.1](#51-attempts-is-charged-at-claim-time));
otherwise it is reset to `pending` for reclaiming.

The reaper honours only `JOBS_REAPER_ENABLED`, **never** `JOBS_WORKER_MODE`.
Reaping is a control-plane duty, not a work-execution one — it is exactly
as necessary under `JOBS_WORKER_MODE=off` (an API instance with zero
in-process work, entirely fed by nodes) as it is under `all`, because a
control-plane-only deployment is *precisely* where a node dies mid-job and
leaves an expired lease with nobody local watching for it. Coupling the
reaper's kill switch to the worker mode would silently disable the one
mechanism a fleet-only deployment most needs.

**The nightly history purge** deletes terminal (`succeeded`/`failed`) rows
older than `jobs.history.retentionDays`, in batches of 5,000 to stay
lock-friendly on a busy table, gated by `jobs.history.purgeEnabled`. Each
batch is folded into `JobStatsRollup` ([§3.3](#33-jobstatsrollup)) — counts
incremented, `sumDurationMs`/`durationSamples` accumulated — **in the same
transaction** as the batch's own deletion, so a crash between "fold the
rollup" and "delete the rows" is impossible: either both happened or
neither did, and lifetime analytics can never silently lose a batch that
was deleted without ever being folded.

**A temp-file janitor** sweeps a well-known temp-file prefix (any handler
that streams a large download to disk before processing it is expected to
name its temp files with a shared, greppable prefix) for files older than a
few hours, cleaning up orphans left behind when a job is killed mid-download
before its own `finally` block runs. This mirrors the precedent this
template's design already anticipates for any handler doing large-file work
— a crash between "downloaded the bytes" and "cleaned up the temp file" must
not accumulate disk usage forever.

## 9. Admin API

All routes under `/api/admin/jobs`, gated by `jobs:read`/`jobs:write`
([§12](#12-settings-and-environment-reference)).

| Method & path | Permission | Notes |
|---|---|---|
| `GET /stats` | `jobs:read` | Total, by-status, by-type breakdown, `stuckRunning` count. Cached in-process for 2s — deliberately *shorter* than any reasonable admin dashboard poll interval, so the cache smooths repeated polling without ever showing data staler than the poll itself would tolerate. |
| `GET /?status=&type=&page=&pageSize=&scheduled=&processedWithin=` | `jobs:read` | `processedWithin` filters on `COALESCE(finishedAt, createdAt)` so a still-pending job created inside the window is not hidden just because it has no `finishedAt` yet. `scheduled=true` forces `status=pending` (a scheduled job is definitionally pending) and composes with `type`. |
| `POST /:id/retry` | `jobs:write` | Resets one failed/succeeded job to `pending`. 400 if the job is currently `running` — retrying a job that has not finished is a race with itself. |
| `POST /retry-failed` | `jobs:write` | Bulk-retries every `failed` job, optionally scoped to one `type`. |
| `POST /reset-stuck` | `jobs:write` | Manually fires the reaper's logic on demand. `olderThanMinutes` in the body is **optional with no hard-coded default** — an empty body defers to `jobs.stuckThresholdMinutes`, so the admin API and the cron can never silently disagree about what "stuck" means unless the caller explicitly asks for a different window. |
| `DELETE /:id` | `jobs:write` | Deletes a job row outright. 400 if `running`. |

## 10. Insights

A read-only, on-demand aggregate — no snapshot table, no background
computation beyond what the rollup already folds. Every query behind this
endpoint is a pure `SELECT`, taking only `ACCESS SHARE` locks, so it can
never block the worker's row-claiming `UPDATE`s regardless of how often an
admin dashboard polls it.

- **Windowed** p50/p95 duration and throughput, computed live over
  `succeeded` rows inside a caller-chosen recent window (bounded — this is
  not an unbounded historical scan).
- **ETA**, with an explicit `basis: 'live' | 'partial' | 'none'` field
  rather than a bare number: `'live'` means the estimate is built from
  enough recent same-type samples to trust; `'partial'` means there were
  some but few; `'none'` means there is nothing to estimate from yet (a
  brand-new job type, or one that has never succeeded). A caller that
  silently treated every ETA as equally trustworthy would show a
  confident-looking number backed by a single sample.
- **Lifetime** counts and average duration, merged from `JobStatsRollup`
  ([§3.3](#33-jobstatsrollup)) with whatever live terminal rows have not
  yet been purged — this is what lets lifetime analytics survive the
  nightly purge without needing to scan history that has already been
  deleted.

## 11. Adding a new job type

This is the section a fork's engineer actually reads. The steps, in order:

1. **Write the handler.** Implement `JobHandler` ([§4](#4-the-handler-contract)).
   `process(job)` does the work and throws to signal failure — the terminal
   state machine ([§6](#6-the-terminal-state-machine)) decides what a throw
   means, so a handler never needs its own retry logic. If the handler
   should ever be node-eligible, add `nodeResultSchema` (a `z.ZodType`
   describing exactly what a node's submitted result must contain) and
   `persistNodeResult` (which does *only* the persist half —
   [§4](#4-the-handler-contract) explains why nothing else belongs there)
   from the start; adding them later is a compatible change, but designing
   `process()` as if it will always run in-process, then bolting on
   node-eligibility, tends to leave `process()` doing work
   `persistNodeResult` cannot cleanly reuse.
2. **Register it.** In the owning module's `OnModuleInit`, append the
   handler instance to the shared handler registry
   ([§4](#4-the-handler-contract)). There is no second list to update — the
   worker, the admin API, and (if node-eligible) the node claim/result
   routes all read the same registry.
3. **Decide priority and dedup.** Pick a `priority` band consistent with the
   rest of the queue: real-time/interactive work near `0`, routine
   scheduled work near `100`, with room between for anything in-between.
   Decide whether this job type should ever be deduplicated, and if so what
   `dedupKey` collapses distinct enqueue calls into one row
   ([§3.1](#31-dedup-is-an-index-not-a-query)).
4. **Enqueue it.** Call the enqueue service with `type`, `payload`,
   `subjectType`/`subjectId` if the job is about a concrete thing
   ([§3.2](#32-subjecttypesubjectid-are-the-generic-replacement-for-a-domain-fk)),
   and `reason` (`upload`/`rerun`/`backfill`) so the row's provenance is
   legible later.
5. **Add settings, if the handler needs any tunables.** Follow
   [§12](#12-settings-and-environment-reference)'s pattern, and read
   [§13](#13-the-six-hand-maintained-settings-places) *before* writing a
   single new setting — a namespace added to only some of the six places
   validates cleanly in a unit test and silently no-ops on every real
   request.
6. **Write the recovery story, if the job type is server-only and
   long-running.** If a job type genuinely cannot fit this queue's
   assumptions (needs its own heartbeat, needs to survive a stuck-threshold
   that would be wrong for it, needs single-flight enforcement stronger than
   `dedupKey` gives), it may not belong in this queue at all — see
   [§2](#2-relationship-to-the-other-two-specs) and
   [Database Backup & Restore](database-backup.md) for the worked example of
   exactly that decision.

## 12. Settings and environment reference

**Settings namespace `jobs.*`** (persisted in the existing system-settings
JSONB, editable through the existing settings endpoints):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `jobs.history.retentionDays` | integer | 30 | Days a terminal row survives before the nightly purge deletes it. |
| `jobs.history.purgeEnabled` | boolean | `true` | When `false`, the nightly purge cron does not enqueue/run at all — an escape hatch for forensic investigation. |
| `jobs.stuckThresholdMinutes` | integer | 5 | Threshold the reaper and `POST /reset-stuck` both use when no explicit `olderThanMinutes` is given. Must exceed the longest legitimate single-job runtime for every handler registered — too low a value resets a still-running job, which then gets claimed and run a *second* time concurrently with the original. |

**Environment variables** (bare/unprefixed, matching this API's existing
convention — `POSTGRES_*`, `JWT_SECRET` — never the CLI's `envVar()`-derived
prefix, which is a *client-side* concern the API never shares):

| Variable | Default | Meaning |
|---|---|---|
| `JOBS_WORKER_MODE` | `all` | `all`\|`system`\|`off` — [§7](#7-the-worker). |
| `JOBS_WORKER_CONCURRENCY` | `1` | Number of independent slot loops. |
| `JOBS_POLL_MS` | `5000` | Poll interval for an idle slot. |
| `JOBS_MAX_ATTEMPTS` | `3` | Attempt budget before a normal failure is permanent. |
| `JOBS_RETRY_BASE_MS` | `2000` | Base delay for the first normal-error retry ([§6.1](#61-backoff-equal-jitter-exponential)). |
| `JOBS_RETRY_MAX_MS` | `60000` | Backoff cap for normal-error retries. |
| `JOBS_RATELIMIT_MAX_HITS` | `10` | Rate-limit deferrals before a job is permanently failed — tracked separately from `JOBS_MAX_ATTEMPTS`. |
| `JOBS_RATELIMIT_BASE_MS` | `30000` | Base delay for the first rate-limit deferral. |
| `JOBS_RATELIMIT_MAX_MS` | `900000` | Backoff cap for rate-limit deferrals (15 minutes). |
| `JOBS_LEASE_MS` | `1800000` | Lease duration granted at claim time (30 minutes). |
| `JOBS_JOB_TIMEOUT_MS` | `600000` | Per-job execution timeout ([§7](#7-the-worker)), `0` disables. |
| `JOBS_REAPER_ENABLED` | `true` | Kill switch for the reaper, independent of `JOBS_WORKER_MODE` ([§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor)). |
| `JOBS_SYSTEM_MODE_EXTRA_TYPES` | *(empty)* | Comma-separated job types additionally claimed under `JOBS_WORKER_MODE=system` even though they are node-eligible — an operator's escape hatch for a type they would rather keep server-side despite it being node-capable. |

## 13. The six hand-maintained settings places

This is the single easiest way for a new `jobs.*` setting (or any other
namespace) to look correct and do nothing. The system-settings surface in
this codebase is **six separate, hand-maintained places**, and a namespace
present in only some of them validates cleanly in a unit test while every
real `PATCH`/`PUT` against it silently no-ops:

1. `systemSettingsSchema` (`common/schemas/settings.schema.ts`) — the full
   validation shape and defaults.
2. `systemSettingsPatchSchema` (same file) — its all-optional twin for
   partial updates.
3. `updateSystemSettingsSchema` (`settings/dto/update-system-settings.dto.ts`)
   — the wire-facing PUT DTO `nestjs-zod` validates the request body
   against. **This is the trap**: `createZodDto` builds the documented
   OpenAPI request schema from *this* file, which deliberately restates
   rather than imports `settings.schema.ts`
   (`update-system-settings.dto.ts`'s own header explains why: it is the
   OpenAPI-visible contract, and the service validates against the shared
   schema again on the way in — both copies move together by convention,
   not by the compiler). A key present in `systemSettingsSchema` but
   forgotten here is **silently stripped from the request body before
   the handler ever sees it**.
4. `patchSystemSettingsSchema` (same file) — the wire-facing PATCH DTO,
   with the identical trap.
5. `SystemSettingsValue` type + `DEFAULT_SYSTEM_SETTINGS` constant
   (`common/types/settings.types.ts`) — the TypeScript shape and the seeded
   defaults a fresh row is created with.
6. The hand-written per-key merge inside `patchSettings`
   (`settings/system-settings/system-settings.service.ts`) — this service
   does **not** perform a generic deep merge; it copies each known
   namespace by name (`ui: {...}, features: {...}, notifications: {...}`,
   and so on). A namespace present in every schema above but missing from
   this hand-built object is validated, accepted, and then **never
   returned by a subsequent `GET`**, because nothing copied it into the
   merged result.

Issue #256 adds a parity spec — one test that walks all six places and fails
by *naming the specific missing key* when any of them disagree — precisely
so that a future `jobs.*` setting (or any other namespace added after this
document is written) cannot repeat this failure silently. Until that spec
exists, the discipline is manual: add a setting in all six places, in the
same commit, or do not add it at all.

## 14. Rejected alternatives

- **Redis + BullMQ (or any broker-backed queue).** Requires a second
  datastore on this template's default path for every fork —
  [§1](#1-why-postgres-not-redisbullmq).
- **`findFirst`-then-`create` for dedup.** Racy under exactly the load
  where dedup matters most — [§3.1](#31-dedup-is-an-index-not-a-query).
- **A real foreign key per domain table instead of `subjectType`/`subjectId`.**
  This is a template with no fixed domain model; a concrete FK column per
  possible subject is the same anti-pattern the `features` bag already
  avoids elsewhere in this codebase —
  [§3.2](#32-subjecttypesubjectid-are-the-generic-replacement-for-a-domain-fk).
- **`attempts` incremented on failure instead of on claim.** Never charges a
  job the process itself killed, so a poison-pill job crash-loops forever
  instead of being bounded — [§5.1](#51-attempts-is-charged-at-claim-time).
- **An in-process mutex for claiming.** Only serializes one process; two API
  replicas, or a replica plus a node, can both claim the same row —
  [§5.1](#51-attempts-is-charged-at-claim-time).
- **A batch-drain worker loop (`claim N`, `await all N`, repeat) instead of
  independent slot loops.** Collapses effective concurrency toward the
  slowest job in the batch — [§7](#7-the-worker); see also
  [Worker Nodes §7](worker-nodes.md#7-the-nodeengine-loop-is-a-continuous-top-up-pool-not-a-batch-drain)
  for the CLI-side version of the same mistake.
- **Coupling the reaper's kill switch to `JOBS_WORKER_MODE`.** A
  control-plane-only (`off`) deployment is exactly where an unrenewed node
  lease most needs reaping — [§8](#8-hygiene-reaping-purging-and-the-temp-file-janitor).
- **An unrecognised `JOBS_WORKER_MODE` value falling closed to `off`.**
  Silently stopping all background work on a typo is worse than the same
  typo running the safest default loudly logged — [§7](#7-the-worker).
- **Routing `pg_dump`/`pg_restore` through this queue.** This queue's
  stuck-threshold and lack of an in-process lease-renewal path would
  duplicate a legitimate long-running dump — [§2](#2-relationship-to-the-other-two-specs)
  and [Database Backup & Restore](database-backup.md).

## 15. Open questions for the child issues

- **Exact index names and migration ordering** for the raw-SQL partial
  indexes in [§3.1](#31-dedup-is-an-index-not-a-query) — this document
  fixes their `WHERE` predicates and the invariant they enforce, not their
  literal migration file names.
- **Whether `JOBS_SYSTEM_MODE_EXTRA_TYPES` is needed at all** before a real
  fork has a concrete reason to keep a node-eligible type server-side
  despite having nodes registered; it is included here as a documented
  escape hatch, not a requirement that ships on day one.
- **The exact shape of the parity spec** in
  [§13](#13-the-six-hand-maintained-settings-places) (issue #256) — whether
  it walks the AST of each file or asserts against a hand-written manifest
  of expected keys is left to that issue.
