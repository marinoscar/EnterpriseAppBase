# Database Backup & Restore

> Epic #254, issues #280–#287. Implements `pg_dump`/`pg_restore`-based full
> database backup and restore in a new `apps/api/src/db-backup/` module,
> backed by a new `database_backup_runs` table, admin API under
> `/api/admin/db-backup/*`, and `postgresql17-client` added to the `base`
> stage of `apps/api/Dockerfile`. See [Job Queue](job-queue.md) (epic #254,
> #255/#256/#259–#266) for the background-job substrate this feature
> deliberately does **not** use, and [§2](#2-why-this-is-not-a-queue-job-type)
> for why. [Worker Nodes](worker-nodes.md) (epic #254, #267–#279) is
> unrelated: a database backup or restore never runs on a node — it needs a
> direct network connection to this deployment's own Postgres and, for
> restore, an administrative connection outside the application's own
> pool, neither of which a node could ever be trusted with.

**Status: design specification for planned work. Nothing in this document
exists in the codebase yet.** There is no `apps/api/src/db-backup/`
directory, no `database_backup_runs` table, no `postgresql17-client`
package in `apps/api/Dockerfile`, and no `/api/admin/db-backup/*` routes.
This document is what issues #280–#287 build against.

## Contents

1. [Two environment facts that drive everything](#1-two-environment-facts-that-drive-everything)
2. [Why this is not a queue job type](#2-why-this-is-not-a-queue-job-type)
3. [`spawnPgProcess`](#3-spawnpgprocess)
4. [The single-active-run guard](#4-the-single-active-run-guard)
5. [The streaming backup contract](#5-the-streaming-backup-contract)
6. [Verification before `completed`](#6-verification-before-completed)
7. [Heartbeat, failure, and cancellation](#7-heartbeat-failure-and-cancellation)
8. [Storage destination](#8-storage-destination)
9. [Scheduling](#9-scheduling)
10. [Retention: two clocks](#10-retention-two-clocks)
11. [Restore: the governing fact](#11-restore-the-governing-fact)
12. [Why in-place `pg_restore --clean` is rejected outright](#12-why-in-place-pg_restore---clean-is-rejected-outright)
13. [The scratch-database-and-rename design](#13-the-scratch-database-and-rename-design)
14. [Pre-flight gates](#14-pre-flight-gates)
15. [The admin connection](#15-the-admin-connection)
16. [The swap](#16-the-swap)
17. [Catalog carry-over and migration roll-forward](#17-catalog-carry-over-and-migration-roll-forward)
18. [Two operational requirements](#18-two-operational-requirements)
19. [Rollback](#19-rollback)
20. [API](#20-api)
21. [BigInt](#21-bigint)
22. [Permissions and settings reference](#22-permissions-and-settings-reference)
23. [Rejected alternatives](#23-rejected-alternatives)
24. [Open questions for the child issues](#24-open-questions-for-the-child-issues)

## 1. Two environment facts that drive everything

**Fact one: `infra/compose/base.compose.yml` declares no `db` service.**
This template's own dev/test compose files run Postgres only as a scoped
convenience (`postgres:16-alpine` in `infra/compose/otel.compose.yml` and
`infra/compose/test.compose.yml`) — the *application's* base compose stack
has no database service of its own, by design: `common/database-url.ts`
builds a connection string from `POSTGRES_HOST`/`POSTGRES_PORT`/etc., and a
real deployment is expected to point those at Postgres it runs, manages, and
backs up by whatever means it already has — a managed cloud database, a
separately-operated cluster, anything. This feature therefore connects to
Postgres **over the network, with `pg_dump`/`pg_restore` run as ordinary
child processes of the API container**, exactly the same way the
application itself connects — never `docker exec` into some Postgres
container this codebase does not assume exists at all.

**Fact two: because the database is external, the API image's `pg_dump`
version and the target server's version drift independently of each
other**, and `pg_dump` **refuses to dump a server newer than itself** —
silently, from the caller's point of view, in the sense that the failure
looks like an ordinary tool error rather than anything this application
predicted. An operator who upgrades their managed Postgres instance to a
new major version, without also rebuilding this application's image, gets a
backup feature that has quietly stopped working, permanently, until the
image catches up — the single worst way for a backup system to fail, because
the failure is discovered only at the moment a backup is actually needed.

The fix is to **pin the client major explicitly** —
`apps/api/Dockerfile`'s `base` stage installs `postgresql17-client` via
`apk add`, not a floating meta-package (`postgresql-client`) whose resolved
major silently tracks whatever the Alpine base image's own release happens
to carry — and bind that pin to a single named constant,
`MIN_PG_CLIENT_MAJOR`, that a Doctor-style check
(`core.pgClientVersion`-shaped, comparing the image's `pg_dump --version`
major against the live server's `server_version_num` major) can compare
against at runtime. A test reading `apps/api/Dockerfile` as text — the same
pattern `apps/api/test/production-image.spec.ts` already establishes for
"does this image contain the script it needs" — asserts the installed
package name matches `MIN_PG_CLIENT_MAJOR`, so bumping the constant without
also bumping the Dockerfile line (or the reverse) fails CI instead of
failing silently in production months later.

## 2. Why this is not a queue job type

Say this loudly, in its own section, because it is the design decision most
likely to look wrong to someone who has not read the reasoning and decides
to "clean it up" by moving it onto [Job Queue](job-queue.md): **a database
backup does not enqueue a `jobs` row, on purpose.**

Two specific mismatches make the queue the wrong tool here, not merely a
suboptimal one:

1. [Job Queue](job-queue.md)'s stuck-job threshold
   (`jobs.stuckThresholdMinutes`, default 5 minutes) exists to catch
   enrichment-style work that legitimately takes seconds to low minutes. A
   real `pg_dump` against a production-sized database legitimately runs for
   tens of minutes. Run it as a queue job and the reaper — doing exactly
   what it is supposed to do — flags the still-running dump as stuck,
   resets it to `pending`, and a **second** `pg_dump` starts against the
   same storage key while the first one is still writing to it. Raising the
   threshold app-wide to accommodate one feature's runtime would then make
   every genuinely-stuck enrichment job in every other feature take that
   much longer to be noticed.
2. [Job Queue](job-queue.md)'s in-process worker has **no lease-renewal
   path of its own** — only a remote node ([Worker Nodes](worker-nodes.md))
   can call `POST /:id/jobs/:jobId/renew` to keep a long job's lease alive.
   A backup run inside the in-process worker would therefore be racing its
   own fixed lease duration (`JOBS_LEASE_MS`, default 30 minutes) with no
   way to say "I am still here, give me more time," regardless of the
   stuck threshold above.

The correct shape — the one this document builds — is a **dedicated run
table with its own heartbeat**, exactly the same shape [Job Queue's own
sibling spec chose](job-queue.md#2-relationship-to-the-other-two-specs) for
the identical reason: `database_backup_runs`, not `jobs`.

## 3. `spawnPgProcess`

One shared child-process wrapper is used for every `pg_dump` and
`pg_restore` invocation this feature makes. Five details, each earning its
place independently:

1. **`stdout` is exposed as a live `Readable`, never buffered.** Buffering
   the child's stdout before handing it to a caller would reintroduce
   exactly the multi-gigabyte in-memory footprint this whole streaming
   design exists to avoid — see [§5](#5-the-streaming-backup-contract).
2. **`PGPASSWORD` is set in the child's environment, and *never* appears in
   `argv`.** A process's argv is world-readable on a Linux host via `ps
   aux` and `/proc/<pid>/cmdline` — visible to any other user or process on
   the same machine, container isolation aside. Passing a password as a
   `-p`-style flag would leak it to anything with read access to `/proc`,
   for the entire duration of the child process's life. This is a security
   requirement with its own dedicated test asserting the constructed argv
   array never contains the password string.
3. **`SIGKILL` on timeout, not `SIGTERM`.** A `pg_dump` wedged on a stuck
   socket (a network partition mid-transfer, a server that stopped
   responding without closing the connection) is not guaranteed to honour
   `SIGTERM` promptly, or at all, if it is blocked inside a syscall.
   `SIGKILL` is the only signal a process cannot choose to ignore.
4. **A `settled` guard** ensures that once a process has been killed (or
   has exited on its own), any subsequent event from it — a late `stderr`
   chunk, a delayed `exit` — is a no-op rather than double-firing whatever
   callback the caller registered for completion or failure.
5. **Bounded, tail-only `stderr` capture.** `pg_dump` can emit an unbounded
   number of per-object warnings on a database with enough tables/functions
   to complain about; capturing all of it in memory for a multi-hour run is
   its own unbounded-memory bug. Only the most recent N kilobytes are
   retained, which is enough to diagnose a real failure without letting a
   noisy-but-otherwise-successful dump grow the process's memory footprint
   unboundedly.

Backup invocation: `pg_dump -Fc --no-owner --no-acl -Z <compressionLevel>`,
with **no `-f` flag** — omitting the output-file flag is what makes
`pg_dump` write to `stdout` instead of a file, which is the entire
precondition for piping it anywhere in [§5](#5-the-streaming-backup-contract).
`--no-owner --no-acl` strip role/ownership metadata that would otherwise tie
a restored database to role names that may not exist in whatever cluster
the restore eventually targets.

Restore invocation includes **`--exit-on-error`**, and this one flag is
load-bearing in a way easy to miss: **without it, `pg_restore` logs errors,
continues past them, and still exits `0`.** A partially-populated database
— some tables restored, others silently skipped because their `CREATE
TABLE` or data-copy statement failed — reported as a *successful* restore
is far more dangerous than an honest failure, because the swap in
[§16](#16-the-swap) would then promote that half-restored database to
"live" believing it to be good.

## 4. The single-active-run guard

At most one backup run may be in flight at a time, enforced the same way
[Job Queue's dedup](job-queue.md#31-dedup-is-an-index-not-a-query) is
enforced — a raw-SQL partial unique index, not an application-level
check-then-write:

```sql
CREATE UNIQUE INDEX database_backup_runs_active_uniq_idx
  ON database_backup_runs (status)
  WHERE status IN ('pending', 'running');
```

Because a partial unique index over a single-valued expression (`status`
alone, with no run-scoping column) can have **at most one matching row at
any moment**, this is a full "there can be only one active run, period" gate
enforced by the database itself rather than by apparently-safe application
logic that races under concurrency. Whichever caller loses a concurrent
attempt to insert a second `pending`/`running` row gets a `P2002`
unique-violation, which the service catches and turns into a typed
`DatabaseBackupAlreadyRunningError` carrying the id of the run that won —
never a bare database error surfaced to an admin who just wanted to know
why their manual trigger did nothing.

## 5. The streaming backup contract

`pg_dump`'s `stdout` is piped, with backpressure honoured end-to-end,
through a metering `Transform` stream that computes a running **sha256**
and a running **byte count** on the **same single pass** — never a second
read of the data to compute a checksum after the fact, which for a
multi-gigabyte dump would double the time and I/O cost for no benefit — and
from there straight into `provider.upload(key, meteringStream, ...)`
against whatever `StorageProvider`
(`apps/api/src/storage/providers/storage-provider.interface.ts`) this
deployment has configured. **The archive is never materialized in memory or
on local disk during the backup itself** — only during a later restore
([§13](#13-the-scratch-database-and-rename-design)) does a copy touch disk
at all, and only because `pg_restore -j` requires a seekable file.

The completion condition is **`await Promise.all([uploadPromise,
dumpDonePromise])`**, waiting on *both* halves, never either one alone.
Waiting on the upload alone is wrong because an upload can report success
having received a **truncated** stream if the dump process itself died
partway through — the storage provider only knows it received *some* bytes
and closed cleanly, not that those bytes are the *whole* intended archive.
Waiting on the dump alone is wrong for the opposite reason: `pg_dump` can
exit `0` after writing its very last byte to the pipe, while the upload
consuming that pipe is still flushing the tail of it to the storage
backend — declaring success the instant the child process exits would race
the upload's own completion. **A dump that exits non-zero destroys the
metering stream**, which tears the in-flight upload down rather than
letting it complete against a definitely-incomplete archive.

## 6. Verification before `completed`

A run is not marked `completed` on a successful upload alone. The
**uploaded object** is streamed back down and piped through `pg_restore
--list`, and an **empty table of contents** is treated as a verification
failure. The backup-time sha256 ([§5](#5-the-streaming-backup-contract))
proves the bytes *this process sent* were what it intended to send; this
second check proves the bytes *that actually landed in storage* are a
readable, well-formed archive — a distinction that matters because a
storage provider's own transfer, encoding, or truncation bug between "we
sent it" and "it is durably stored" is exactly the kind of failure a
same-process checksum can never catch, since the checksum is computed
before the bytes ever leave this process.

## 7. Heartbeat, failure, and cancellation

A heartbeat writes `lastHeartbeatAt` and the current `bytesWritten` on a
fixed interval while the dump streams, and **swallows any transient write
failure** rather than aborting the backup over it — a single missed
heartbeat write (a momentary database blip) must never abort an otherwise
successful, still-progressing multi-gigabyte dump. `runStaleMinutes`
([§22](#22-permissions-and-settings-reference)) is set comfortably above
the heartbeat interval, so a genuinely alive run's heartbeat never brushes
up against the staleness threshold by accident.

**On failure, the partial storage object is deleted first, best-effort,
before the row is marked `failed`** — never the reverse order. Deleting
first means a delete failure (storage transiently unreachable, say) is
logged but never masks or replaces the *original* failure reason recorded
on the row; marking the row failed first and deleting second would risk
leaving an orphaned, billable partial object behind if the process crashed
between the two steps, with no row left pointing at it to explain why it
exists.

There is **no automatic retry** of a failed backup. The next *scheduled*
run is the retry — a design choice that keeps the failure-handling story
simple (no separate retry-count/backoff logic duplicating what
[Job Queue](job-queue.md) already owns for the workloads that actually
belong there) and correct: retrying a backup that just failed, immediately,
against a database or storage provider that may still be in whatever state
caused the failure, is not obviously better than waiting for the next
scheduled attempt with fresh state.

**Cancellation** uses a **process-local** map of in-flight abort handles —
only the process that spawned a given `pg_dump` child can signal it, so a
cancel request arriving at a *different* API replica than the one running
the backup has no handle to act on (`signalled: false` in that case,
distinct from "there was nothing to cancel"). A successful cancel routes
through the **ordinary failure path** — SIGTERM the child, destroy the
metering stream, let the existing failure handling in
[§7](#7-heartbeat-failure-and-cancellation) do its normal cleanup (delete
the partial object, mark the row) — deliberately **not** a second, parallel
teardown path that would have to be kept in sync with the first one by
hand.

## 8. Storage destination

The feature injects the existing `STORAGE_PROVIDER` token
(`apps/api/src/storage/providers/storage-provider.interface.ts`) and reads
`provider.getBucket()` for the destination bucket, exactly like every other
storage-consuming feature in this codebase — no separate storage
configuration surface of its own. The **provider identifier is recorded on
the run** for provenance (which provider produced this archive), and the
persisted `databaseBackup.storageProvider` setting is validated to be
either `null` (use whatever the currently-active provider is) or **exactly
equal to** the currently-active provider — any other value is a 400 at
write time, not a silent no-op discovered only when a scheduled backup
tries to resolve a provider that does not exist.

This template ships **one** storage provider implementation today, so a
general multi-provider resolver (the kind a media-heavy fork with several
configured providers might eventually want, letting a backup schedule pin
to a specific provider independent of whichever one is currently "active"
for new uploads) is **explicitly out of scope**. The validation rule above
is written so that a fork which *does* add multi-provider support later
finds the `storageProvider` field already present, already validated, and
already recorded per run — porting in a real resolver is a matter of
loosening the "must equal the active provider" check, not inventing a new
field or a new migration.

## 9. Scheduling

A cron tick every 10 minutes, gated by its **own** kill switch
(`DB_BACKUP_SCHEDULE_ENABLED`) **independent of
[Job Queue](job-queue.md)'s `JOBS_WORKER_MODE`** — this task is not a queue
worker at all ([§2](#2-why-this-is-not-a-queue-job-type)), and a
control-plane-only deployment (`JOBS_WORKER_MODE=off`, every claimable job
type served by nodes) still very much needs its own database backed up on
schedule.

Each tick does two things, in order:

1. **Release any stale run first** — a `running` row whose heartbeat has
   not moved in `databaseBackup.runStaleMinutes` is marked `stale`
   ([§7](#7-heartbeat-failure-and-cancellation) covers why `stale` is
   terminal rather than auto-requeued).
2. **Then check whether a new run should fire.** Rather than storing a
   `lastRunAt` column and comparing it against "now," the tick computes
   `previousFireBoundary(cronExpression, now, timezone)` — the most recent
   moment the configured schedule *should* have fired, walking backward
   from "now" — and compares it against the most recent run's own
   `startedAt`. If the most recent run started at or after that boundary,
   nothing fires; otherwise, a new run starts. This yields **exactly one
   run per schedule boundary, statelessly** — no extra column to keep in
   sync, and critically, **no drift after a restart**: an API instance that
   was down across a scheduled 02:00 boundary and comes back up at 02:47
   recomputes the same boundary from the cron expression and the clock
   alone, and correctly still fires the missed run, with nothing that
   needed to have survived the restart in order to know that.

**Timezone is passed explicitly to every boundary computation** —
`databaseBackup.timezone`, never the server process's own local timezone —
because a server's own timezone is an operational accident (whatever the
host or container happens to be configured with), not a fact about when an
admin configured "02:00" to mean. Omitting it and letting the computation
fall back to the server's local zone would silently move the intended fire
time from what the admin configured in `/admin` to whatever the deployment
environment's zone happens to be.

**Day/frequency translation clamps rather than rejects.**
`databaseBackup.dayOfMonth` is capped at **28**, so a `monthly` schedule
never has to decide what "the 31st" means in February — clamping the input
range up front is simpler and more honest than accepting 31 and silently
skipping months that lack it. And whichever day field the configured
`frequency` does not use is emitted as `*` in the generated cron
expression, deliberately, rather than left at some default numeric value —
because setting **both** a day-of-week and a day-of-month field to specific
values is interpreted as an **AND** by some cron implementations and an
**OR** by others, and this feature has no reason to depend on which
convention whatever cron library it uses happens to pick.

## 10. Retention: two clocks

Retention runs on **two independent clocks**, because the two kinds of run
it prunes mean genuinely different things:

- **Normal (`scheduled`/`manual`) runs are retained by *count*** —
  `databaseBackup.retentionCount` newest `completed` runs survive; older
  ones are pruned after each new successful run completes.
- **`pre_restore` runs are retained by *age*** —
  `databaseBackup.oldDatabaseRetentionHours`. A `pre_restore` dump is not an
  ordinary backup an admin scheduled for its own sake; it exists because,
  in one of the two rollback modes ([§19](#19-rollback)), it **is** the
  rollback path for a restore that just happened, and its useful lifetime
  is bounded by "how long after a restore would anyone plausibly still want
  to roll it back," not by "how many backups deep is our normal history."

Pruning always deletes the **storage object before the database row**,
never the reverse: a crash between the two steps must leave behind a
row that is visible and can be pruned again on the next pass, never an
invisible object with no row pointing at it — the same ordering argument
[§7](#7-heartbeat-failure-and-cancellation) makes for failure cleanup,
applied to routine pruning instead. Pruning only ever runs **after** a
successful backup completes, and it **never throws** — a pruning failure
is logged, not propagated, because failing to delete an old backup must
never be mistaken for, or allowed to mask, a failure of the *new* backup
that just succeeded.

## 11. Restore: the governing fact

Everything about restore follows from one fact: **a `pg_dump -Fc` archive
stores `CREATE INDEX` statements, not index data.** Restoring means
*rebuilding* every index from scratch — and on a database of any real
size, with any vector/full-text/GIN-style indexes in its schema, that
rebuild is plausibly **hours**, not minutes. A design that assumed restore
was fast — "just restore into the live database" — would be wrong the
moment the database it was designed for grew past a toy size, and every
subsequent decision in this section is a direct consequence of taking the
hours-long number seriously from the start rather than discovering it in
production.

## 12. Why in-place `pg_restore --clean` is rejected outright

**Do not reintroduce this. It is rejected, not merely "not chosen."**

`pg_restore --clean` drops every object in the archive before recreating
it — including, unavoidably, `database_backup_runs` itself, since it is an
ordinary table in the same database being restored. A restore run that
in-place `--clean`-restores its own tracking table **destroys the row
recording its own progress**, mid-restore, with no way to report what
happened or recover cleanly.

Worse than the mechanism failing is *how* it fails: an in-place restore
that goes wrong partway through — a constraint violation, a disk-full
condition, a killed process — leaves the live database in an
**indeterminate, partially-dropped, partially-recreated state**: some
tables gone, some half-restored, the application unable to boot against it,
no admin UI reachable (the very tables the UI needs may be among the
dropped ones), and no catalog of backups to restore *from* to fix it,
because that catalog just got dropped too. The tool meant to recover from a
bad state has destroyed itself in the process of trying, across a window
that — per [§11](#11-restore-the-governing-fact) — could be **hours** wide
rather than the seconds a well-designed swap takes.

## 13. The scratch-database-and-rename design

Restore never touches the live database directly. Instead:

1. **Download** the archive to a **seekable temp file** — `pg_restore -j
   N` (parallel restore, essential for the hours-long index-rebuild phase
   in [§11](#11-restore-the-governing-fact)) requires random access into
   the archive to hand different objects to different worker processes;
   streaming it would forfeit *all* of that parallelism on precisely the
   phase that dominates the total runtime.
2. **Re-verify** the downloaded bytes: recompute the checksum and re-run
   `pg_restore --list` against the file **as it exists right now**, not
   trusting the checksum recorded at backup time — a backup-time checksum
   proves the bytes were readable *then*; storage can silently corrupt or
   partially serve a large object between then and now, and a restore is
   exactly the moment that distinction matters.
3. **Optionally** take a `pre_restore` dump of the live database first
   (mode-dependent — [§19](#19-rollback)).
4. **`CREATE DATABASE <live>_restore_<timestamp>`** in the **same
   cluster**.
5. **`pg_restore -j N`** into that scratch database.
6. **The application stays fully up, serving traffic on the live database,
   for this entire multi-hour phase.** Nothing about steps 1–5 touches the
   live database at all.
7. **Verify** the restored scratch database (schema-compatibility and a
   sanity read).
8. Only then: **quiesce and swap** ([§16](#16-the-swap)) — a window measured
   in **seconds**, not hours.

## 14. Pre-flight gates

Pre-flight runs the **cheap** checks before the async, potentially
multi-hour restore proper begins, and reports one of three **normal**
outcomes — none of which is "just fail":

| Outcome | Meaning |
|---|---|
| `ok` (`mode: 'running'`) | Every gate passed; the restore proceeds in the background. |
| `guided` | A **capability** gate failed — something this process cannot do regardless of the archive's contents. The response body carries a ready-to-paste, fully parameterized manual command sequence plus a runbook link, **instead of an error**. This is a designed-in path, not a fallback of last resort: managed Postgres offerings routinely deny `CREATEDB` to the application's own database role, and an admin on such a platform needs a documented manual procedure, not a dead end. |
| `blocked` | The **schema-compatibility** gate failed — the archive's recorded migration name differs from the live database's latest applied migration, in either direction. Re-sending the request with an explicit override proceeds anyway (restore, then run migrations forward). |

The gates, in the order that matters (cheapest and most decisive first):

- **Client-vs-server Postgres major** — blocks outright; this is
  [§1](#1-two-environment-facts-that-drive-everything)'s failure mode
  applied to the restore path instead of the backup path.
- **`CREATEDB` — PROBED, never assumed.** The connecting role's actual
  `pg_roles.rolcreatedb` (or superuser) status is checked live, not
  inferred from configuration — `guided` on failure.
- **Required extensions available** — `guided` on failure, if the archive's
  schema depends on an extension the target cluster does not have
  installed.
- **An administrative connection can actually be opened** — `guided` on
  failure ([§15](#15-the-admin-connection)).
- **Free disk on the Postgres data volume** — needs roughly **1×** the
  database size for the scratch copy, plus another **1×** if the
  configured rollback mode is `retain_database` ([§19](#19-rollback)), since
  that mode keeps the old database around for the whole retention window
  rather than dropping it immediately. A cluster where the data directory
  is not visible from the API container (a managed offering, again)
  **warns rather than falsely blocking** — the check genuinely cannot be
  performed there, and reporting a false block would be worse than
  reporting an honest "could not check."
- **Distinct client addresses in `pg_stat_activity`** — a **warning only**,
  a heuristic hint at a second replica that might be connected against the
  same database (relevant to [§18](#18-two-operational-requirements)'s
  single-replica assumption), never a hard block, because it is only ever
  a heuristic.

**Deliberately absent from pre-flight: byte-verifying the archive against
its checksum.** That check needs a multi-gigabyte *download*
([§13](#13-the-scratch-database-and-rename-design), step 2), and an HTTP
request that triggers a restore must not block on it — it happens as the
first phase of the async restore itself, not before the request returns.

**A short disk specifically in `retain_database` mode auto-downgrades to
`pre_restore_dump` and reports the downgrade**, rather than simply
refusing to proceed. An admin mid-incident, staring at a restore that
cannot start because there is not enough disk for the safer rollback mode,
must never be left with *no* path forward at all — the honest tradeoff
(their recovery-from-a-bad-restore guarantee just changed from seconds to
hours, per [§19](#19-rollback)) is reported plainly rather than the whole
restore being blocked on a resource constraint that has a real, if less
convenient, alternative.

## 15. The admin connection

A short-lived `pg.Client` connects directly to the cluster's **maintenance
database** (typically `postgres`, overridable via `PG_MAINTENANCE_DB`) —
**outside the Prisma connection pool entirely**. This is not an
implementation convenience; it is a structural necessity: the two `ALTER
DATABASE ... RENAME` statements in [§16](#16-the-swap) require that
**nothing** is connected to the database being renamed, and the Prisma
pool's own pooled connections are exactly the connections that must be gone
before a rename can succeed — you cannot rename a database from a session
that is connected to it, and you cannot ask the pool that *is* connected to
it to close itself and then also be the thing performing the rename.

The connection is always closed in a `finally` block. `statement_timeout`
is deliberately set to `0` (no timeout) on this connection — a timeout
firing partway through a `CREATE DATABASE` or a rename would leave the
cluster in an ambiguous state (did it complete? did it not?) that is harder
to reason about than simply letting a slow-but-correct DDL statement run to
completion.

**DDL cannot use bind parameters** — `CREATE DATABASE $1` is not valid SQL
— so every identifier this connection interpolates into a statement (a
scratch database name, a temporary "old" name) passes through a
**strict-allowlist quoter** rather than naive string concatenation. Name
builders that need to append a disambiguating suffix (a timestamp, an
`_old` marker) **trim the base name, not the tail**, so the suffix that
makes two otherwise-identical names distinct always survives Postgres's
63-character identifier length limit rather than being the part silently
truncated away.

## 16. The swap

The sequence, in order, once the scratch database has been restored and
verified:

1. Write the run's status to `swapping`.
2. **Export the catalog carry-over rows** ([§17](#17-catalog-carry-over-and-migration-roll-forward))
   — with this run's own post-swap audit fields (its terminal status, its
   completion timestamp) **already applied to the exported data**, so the
   row re-inserted after the swap already reflects the restore having
   happened, rather than needing a second post-swap write to correct it.
3. **Enable a readiness gate with `allowAdmins: false`, using an
   in-memory-only override** — see the boxed note below for why this is
   *not* a general, persisted "maintenance mode" feature.
4. `$disconnect` the Prisma pool.
5. `pg_terminate_backend` any remaining connections to the live database
   (a defensive backstop — step 4 should have already closed everything
   this process itself opened).
6. `ALTER DATABASE <live> RENAME TO <old>`.
7. `ALTER DATABASE <scratch> RENAME TO <live>`. **If this second rename
   fails, the first is undone** — the original database is renamed back
   into place immediately, so a failure here never leaves the cluster with
   *no* database under the expected name.
8. **Re-insert** the catalog carry-over rows from step 2 into the
   now-live (formerly scratch) database.
9. `process.exit(0)` — deliberately, to force a full process restart and
   rebuild the Prisma connection pool against the (now different, though
   identically-named) underlying database. A pool that kept its existing
   connections would keep talking to whatever physical database those
   connections were opened against, which after the rename is the **old**
   one, not the live one — an in-place pool "reset" cannot substitute for
   an actual process restart here.

**Between the two renames in steps 6 and 7, there is no database under the
live name at all.** This is precisely why the readiness gate in step 3 must
already be in effect *before* step 6 runs: any request arriving in that
window would find nothing to connect to, and a request that had already
been let past a readiness check has no correct way to fail gracefully at
that point.

> **Why an in-memory-only gate, not a persisted maintenance-mode feature.**
> A general, admin-toggleable, persisted maintenance mode — the kind meant
> to survive a deliberate restart during a deploy — is not a feature this
> template has today, and this restore feature does not introduce one. The
> gate this swap needs is narrower and self-contained: a single in-process
> boolean a global guard checks, set immediately before step 6 and cleared
> automatically by the `process.exit(0)` in step 9 (a fresh process starts
> with the gate off). It does not need to survive a restart at all, because
> the *only* restart in this whole sequence is the one the swap itself
> performs on purpose, and the gate's job is done by the time that restart
> happens. Building the general, persisted, admin-facing maintenance-mode
> feature this narrower mechanism deliberately resembles — one an admin
> could flip on ahead of an unrelated deploy and expect to survive it — is
> real, useful, out-of-scope work for a different epic, not a prerequisite
> for this one.

## 17. Catalog carry-over and migration roll-forward

The swap introduces two problems, both handled explicitly rather than
discovered later:

- **Catalog carry-over.** The restored (formerly scratch) database holds
  `database_backup_runs` **as of backup time** — meaning this very restore
  run's own row, and every backup taken *after* the archive being restored
  was made, would simply vanish the instant the swap completes, because
  the table that would list them was itself overwritten by the restore.
  The fix: export the relevant rows from the **live** database
  immediately before the swap, and re-insert them into the newly-live
  database immediately after, using `ON CONFLICT (id) DO UPDATE` so a row
  that happens to already exist in both (the archive's own row, if the
  backup being restored was itself already tracked) is reconciled rather
  than duplicated. User-referencing foreign keys on the carried-over rows
  are resolved through a `(SELECT id FROM users WHERE id = $n)` subselect
  rather than a bare value, so a user created **after** the archive was
  taken — who therefore does not exist in the restored database's own
  `users` table — resolves to `NULL` instead of aborting the entire
  carry-over over one foreign-key violation. The self-referencing
  `preRestoreBackupId` column is carried over in a **second pass**, after
  every row's own id already exists, so a chain of restores referencing
  each other resolves correctly regardless of insertion order.
- **Migration roll-forward.** `_prisma_migrations` also comes from the
  backup — it is an ordinary table like any other. This is exactly what
  the `blocked` pre-flight gate in [§14](#14-pre-flight-gates) detects (the
  restored archive's latest migration disagrees with what the running
  code expects), and exactly what the override path fixes by running
  `prisma migrate deploy` against the newly-live database immediately
  after the swap completes.

## 18. Two operational requirements

Documented explicitly, rather than silently assumed and discovered the hard
way during an actual incident:

- **The swap assumes a single API replica.** The readiness gate in
  [§16](#16-the-swap) is per-process and in-memory; a second replica has no
  way to know the swap is happening, keeps serving requests against what is
  about to become a stale connection, gets forcibly disconnected by
  `pg_terminate_backend`, and then reconnects to a database that has been
  renamed out from under it mid-request. Pre-flight's distinct-client-
  addresses check ([§14](#14-pre-flight-gates)) only **warns** about this,
  because it is a heuristic — scaling to a single replica before restoring
  is the documented operator responsibility, not something this feature
  can enforce from inside one of the replicas.
- **The deployment must set a restart policy** (`restart: unless-stopped`
  in compose, or an equivalent orchestrator setting) on the API container.
  The swap's own final step is `process.exit(0)`
  ([§16](#16-the-swap)) — **on purpose**, to force the pool rebuild — and a
  container with no restart policy simply stays exited. A *successful*
  restore, with everything above working exactly as designed, leaves the
  application down forever without this in place.

## 19. Rollback

Which of two modes is configured (`databaseBackup.restoreRollbackMode`)
decides the *entire* shape of undoing a restore, and the two are
genuinely different tradeoffs, not two names for the same thing:

- **`retain_database`** — the pre-swap live database is **kept**, renamed
  aside rather than dropped, for `databaseBackup.oldDatabaseRetentionHours`
  ([§10](#10-retention-two-clocks)). Rolling back is then just **another
  rename** — the retained database is renamed back into the live slot.
  This is **seconds**, and that speed is the *entire* justification for
  the real, ongoing cost this mode imposes: roughly **2× the Postgres
  volume's disk usage** for the whole retention window, since two full
  copies of the database exist simultaneously.
- **`pre_restore_dump`** — no retained database exists at all; instead, an
  ordinary backup (tagged `trigger: 'pre_restore'`) was taken immediately
  before the restore began. Rolling back means there is **nothing to
  rename** — the rollback simply delegates straight back into
  `startRestore(preRestoreBackupId)`, a **full restore of the pre-restore
  dump**, with the same hours-long index-rebuild cost as any other restore.
  This mode costs no extra standing disk, at the price of a rollback that
  is exactly as slow as the restore it is undoing.
- **`unavailable`** — reported, honestly, when neither a retained database
  nor a pre-restore backup id exists to roll back to (for instance, a
  restore performed before either mechanism had anything to capture, or
  one whose retention window for the retained database already expired).

The rollback endpoint's response names which of the three actually
happened (`renamed` | `restore_started` | `unavailable`), so a caller never
has to infer from timing alone whether it just got the fast path or the
slow one.

## 20. API

All routes under `/api/admin/db-backup/*`.

| Method & path | Permission | Notes |
|---|---|---|
| `GET /config` | `db_backup:read` | Current `databaseBackup.*` settings. |
| `PUT /config` | `db_backup:write` | Update schedule/retention/rollback-mode settings. |
| `POST /runs` | `db_backup:write` | Trigger a manual backup. **409, carrying `details.activeRunId`**, if [§4](#4-the-single-active-run-guard)'s guard is held. |
| `GET /runs` | `db_backup:read` | List runs, paginated. |
| `GET /runs/:id` | `db_backup:read` | One run's detail/progress. |
| `POST /runs/:id/cancel` | `db_backup:write` | Cooperative cancel — [§7](#7-heartbeat-failure-and-cancellation). |
| `DELETE /runs/:id` | `db_backup:write` | Delete a run and its stored archive. |
| `POST /runs/:id/restore` | `db_backup:restore` | Body `{ confirmation: "RESTORE", overrideSchemaCheck? }` — see below. |
| `POST /runs/:id/rollback` | `db_backup:restore` | Body `{ confirmation: "ROLLBACK" }` — [§19](#19-rollback). |

**`confirmation` is a typed literal, checked exactly** — `"RESTORE"` and
`"ROLLBACK"` respectively, not a boolean `confirm: true`. A retried or
mis-fired `POST` with no `confirmation` field, or with an inexact value, is
a plain **400**, never an accidental real restore of a production database.
A boolean flag defaults false and fails safe on *omission*, but a client
bug that accidentally sends `confirm: true` on every request (a copy-pasted
request body, a default that crept into a shared client wrapper) sails
straight through — a literal string a caller has to have deliberately typed
is a meaningfully higher bar against exactly that class of accident.

**The 409 on `POST /runs` must carry `activeRunId` under `details`, never
as a top-level field.** `apps/api/src/common/filters/http-exception.filter.ts`
rebuilds the entire JSON error body itself: it reads `message` and
`details` off the thrown exception's response and derives `code` purely
from the HTTP status, discarding anything else a handler tried to attach at
the top level. `throw new ConflictException({ message, activeRunId })` —
`activeRunId` sitting beside `message` rather than nested under `details`
— **validates cleanly, type-checks cleanly, and is silently dropped by the
filter before it ever reaches the client.** A unit test asserting against
`exception.getResponse()` directly proves nothing about what actually
crosses the wire, because `getResponse()` runs *before* the filter's own
rebuild; the only trustworthy assertion sends the exception **through** the
real filter (mirroring this codebase's own `http-exception.filter.spec.ts`)
and inspects the response the filter actually produced.

## 21. BigInt

`sizeBytes` and `bytesWritten` on `database_backup_runs` are Prisma
`BigInt` columns — genuinely necessary here, since a database dump can
exceed the 2^53 exact-integer range a `double precision` column can
represent losslessly, unlike [Job Queue](job-queue.md)'s
`sumDurationMs`([Job Queue §3.3](job-queue.md#33-jobstatsrollup)), which
deliberately avoids `BigInt` because it never needs the extra range. **Every
response DTO maps both fields explicitly to strings** via one shared
`toRunDto` function — returning a raw Prisma row throws "Do not know how to
serialize a BigInt" the moment `JSON.stringify` touches it, while an
object-comparing unit test (`expect(row).toEqual({...})`) never serializes
anything and passes cleanly regardless, which is exactly how this class of
bug reaches production having looked green the whole way. A spec that
`JSON.stringify`s a real constructed response object, asserting no raw
`BigInt` escapes anywhere in it, is the actual guard.

## 22. Permissions and settings reference

| Permission | Meaning |
|---|---|
| `db_backup:read` | View backup configuration, run history, and signed download URLs. |
| `db_backup:write` | Configure the schedule/retention, trigger a manual backup, cancel one, delete a run and its stored archive. |
| `db_backup:restore` | Restore the database from a backup, and roll a restore back. |

`db_backup:restore` is **deliberately separate from `db_backup:write`**:
writing is routine, low-stakes scheduling and housekeeping, while restoring
**renames the live database and restarts the process**
([§16](#16-the-swap)) — a capability worth an admin being able to grant (or
withhold) independently of "can configure the backup schedule," in the same
spirit this codebase already splits `system_settings:read` from
`system_settings:write` rather than folding read-and-write into one grant.

**Settings namespace `databaseBackup.*`:**

| Key | Type | Default | Meaning |
|---|---|---|---|
| `databaseBackup.enabled` | boolean | `false` | Master on/off for the scheduled cron. Manual triggers via the API work regardless. |
| `databaseBackup.frequency` | enum | `daily` | `daily`\|`weekly`\|`monthly`. |
| `databaseBackup.dayOfWeek` | integer 0–6 | `0` | Used only when `frequency='weekly'`. |
| `databaseBackup.dayOfMonth` | integer 1–28 | `1` | Used only when `frequency='monthly'`; capped at 28 — [§9](#9-scheduling). |
| `databaseBackup.timeOfDay` | `HH:mm` | `'02:00'` | Local fire time, in `databaseBackup.timezone`. |
| `databaseBackup.timezone` | IANA string | `'UTC'` | See [§9](#9-scheduling) for why this must never fall back to the server's own zone. |
| `databaseBackup.retentionCount` | integer 1–100 | `7` | [§10](#10-retention-two-clocks). |
| `databaseBackup.storageProvider` | string \| null | `null` | Must be `null` or exactly the active provider — [§8](#8-storage-destination). |
| `databaseBackup.runStaleMinutes` | integer 5–240 | `30` | Heartbeat staleness window before the schedule task marks a `running` run `stale` and frees the guard. |
| `databaseBackup.compressionLevel` | integer 0–9 | `1` | `pg_dump -Z` level. |
| `databaseBackup.restoreRollbackMode` | enum | `retain_database` | `retain_database`\|`pre_restore_dump` — [§19](#19-rollback). |
| `databaseBackup.oldDatabaseRetentionHours` | integer 1–720 | `168` | Age-based retention for `trigger='pre_restore'` runs — [§10](#10-retention-two-clocks). |

**Environment variables:**

| Variable | Default | Meaning |
|---|---|---|
| `DB_BACKUP_SCHEDULE_ENABLED` | `true` | Kill switch for the entire scheduling cron, independent of `JOBS_WORKER_MODE` — [§9](#9-scheduling). |
| `DB_BACKUP_HEARTBEAT_MS` | `20000` | Heartbeat write interval during a running dump. |
| `DB_BACKUP_PG_DUMP_TIMEOUT_MS` | `14400000` (4h) | Hard `SIGKILL` ceiling on one `pg_dump` — generous by design, since a real run legitimately takes tens of minutes; this bounds a genuinely wedged process, not a slow-but-alive one. |
| `DB_BACKUP_PG_RESTORE_LIST_TIMEOUT_MS` | `1800000` (30m) | Ceiling on the post-upload `pg_restore --list` verification pass — [§6](#6-verification-before-completed). |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | `pg_dump`/`pg_restore` on `PATH` | Override the resolved binary path. |
| `PG_RESTORE_EXIT_ON_ERROR` | `true` | Escape hatch to disable `--exit-on-error` for diagnostic purposes only — [§3](#3-spawnpgprocess) explains why this must never be the default. |
| `PG_MAINTENANCE_DB` | `postgres` | The database the admin connection ([§15](#15-the-admin-connection)) connects to for DDL. |

## 23. Rejected alternatives

- **Enqueuing a backup as a `jobs` row.** Duplicated dumps under the
  reaper's stuck-threshold, and no lease-renewal path for a legitimately
  long-running dump — [§2](#2-why-this-is-not-a-queue-job-type).
- **In-place `pg_restore --clean` against the live database.** Destroys
  the run's own tracking table mid-restore, and a partial failure leaves an
  unbootable application with no catalog of backups to recover from —
  [§12](#12-why-in-place-pg_restore---clean-is-rejected-outright).
- **A general, persisted, admin-toggleable maintenance mode built as a
  prerequisite for the swap.** The swap needs a narrower, self-contained,
  in-memory-only readiness gate that does not need to survive a restart,
  because the only restart in the sequence is the one the swap itself
  performs — [§16](#16-the-swap)'s boxed note.
- **Streaming the restore archive directly from storage instead of
  downloading to a temp file first.** `pg_restore -j N`'s parallelism —
  essential for the hours-long index-rebuild phase — requires a seekable
  file; streaming would forfeit it entirely on exactly the phase that
  dominates runtime — [§13](#13-the-scratch-database-and-rename-design).
- **Trusting the backup-time checksum as sufficient proof of restorability
  at restore time.** Storage can corrupt or partially serve a large object
  between backup and restore; the archive is re-verified against the bytes
  as they exist right now — [§13](#13-the-scratch-database-and-rename-design),
  [§14](#14-pre-flight-gates).
- **A boolean `confirm: true` instead of a typed literal `confirmation`
  string for restore/rollback.** Fails safe only on omission, not against a
  client bug that defaults the flag true — [§20](#20-api).
- **A single retention clock for both normal and `pre_restore` runs.** The
  two answer different questions — "how much history do we want" vs. "how
  long could this restore's rollback path plausibly still be needed" —
  [§10](#10-retention-two-clocks).

## 24. Open questions for the child issues

- **Exact `PG_RESTORE_EXIT_ON_ERROR=false` use case** — this document
  treats it purely as a diagnostic escape hatch and does not specify a UI
  surface for it; whether it is ever exposed outside a raw environment
  variable is left to whichever issue implements [§3](#3-spawnpgprocess).
- **Whether `core.pgClientVersion`-shaped Doctor tooling exists yet in this
  template** to host the client/server major-version check named in
  [§1](#1-two-environment-facts-that-drive-everything) — if this template
  has no Doctor-style diagnostics surface at the time issue #280 lands, the
  check may need its own small home rather than slotting into an existing
  one.
- **Whether a fork with multiple configured storage providers needs the
  full multi-provider resolver** described as out-of-scope in
  [§8](#8-storage-destination) before this feature ships, or whether the
  single-provider validation rule is acceptable for an initial release —
  left to the epic owner's judgment at implementation time.
