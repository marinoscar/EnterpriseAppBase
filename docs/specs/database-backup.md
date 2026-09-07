# Database Backup

> Epic #254, Phase 6 (#280 the `pg_*` process wrappers, the client/server
> version guard and the schedule translation; **#281** the
> `DatabaseBackupRun` model, the single-active-run index, the streaming
> `pg_dump` engine and this document).
> Implemented in
> `apps/api/prisma/schema.prisma` (the `DatabaseBackupRun` model and its two
> enums),
> `apps/api/prisma/migrations/20260907120000_add_database_backup_runs/migration.sql`,
> `apps/api/src/db-backup/pg-dump.util.ts`,
> `apps/api/src/db-backup/pg-restore.util.ts`,
> `apps/api/src/db-backup/pg-version.util.ts`,
> `apps/api/src/db-backup/schedule.util.ts`,
> `apps/api/src/db-backup/db-backup-storage.ts`,
> `apps/api/src/db-backup/db-backup.errors.ts`,
> `apps/api/src/db-backup/db-backup-runner.service.ts` and
> `apps/api/src/db-backup/db-backup.module.ts`.
>
> **On what is merged today.** §1–§3 describe the table and the guard that
> makes "one backup at a time" true. §4–§8 describe the engine: the claim, the
> streaming contract, verification, the heartbeat, failure ordering and
> cancellation. §9 describes the storage-provider constraint. §10 lists the
> rejected alternatives, §11 the verification.
>
> **Nothing triggers a backup yet.** `DbBackupModule` is registered in
> `app.module.ts` so a broken provider graph fails at boot, but the scheduler,
> the retention sweep and the stale sweep are #282, and the admin API is #283.
> The engine is complete and driven end to end by its own suite; what is
> missing is a caller.

## Why this is not a queue job

This epic ships a job queue (`docs/specs/job-queue.md`) and a worker fleet
(`docs/specs/worker-nodes.md`), and a database backup is obviously
"background work". It is still **not** a queue job, and the reason is not
taste — putting it on the queue corrupts backups.

1. **`jobs.stuckThresholdMinutes` defaults to 30 minutes.** A dump of a real
   production database routinely runs longer than that. `JobStuckResetTask`
   would find a `running` job whose lease had expired, conclude its executor
   had died, and **reset it to `pending`** — while `pg_dump` was still
   streaming. The next claim starts a **second `pg_dump`**, writing to the
   same derived storage key as the first, and two processes interleave their
   output into one object. The archive that results restores nothing, and
   nothing reports an error: both runs can exit 0.
2. **The in-process worker has no lease-renewal path.** `JobWorker` claims
   with a lease and never extends it, so point 1 is not a rare race — it is
   unconditional for any job that outlives the threshold. A remote node
   renews; the in-process worker, which is what a single-container deployment
   has, does not.
3. **A job has an attempt budget and automatic retry.** Re-running a failed
   multi-gigabyte dump burns hours of I/O on a database that is probably
   already unwell. The correct retry for a backup is *the next scheduled
   one*.

So `database_backup_runs` is a dedicated table with its own heartbeat, its own
staleness policy (`databaseBackup.runStaleMinutes`, an operator-set number of
minutes that starts at 120 rather than 30) and its own terminal states.

**Do not migrate this onto the queue.** If a future issue wants the queue to
*trigger* a backup, a job handler may call `startBackup()` and return
immediately — but the dump's lifetime must never be a job's lifetime.

## 1. The model

One row per attempt, `database_backup_runs`. The interesting groups:

| Group | Columns | Note |
|---|---|---|
| State | `status`, `trigger`, `started_at`, `finished_at`, `last_heartbeat_at` | `status` is `pending \| running \| completed \| failed \| stale`; `trigger` is `manual \| scheduled \| pre_restore` |
| Size | `bytes_written`, `size_bytes` | **BigInt.** `bytes_written` is live progress rewritten by the heartbeat; `size_bytes` is the final size written once, at completion |
| Storage | `storage_provider`, `storage_key`, `bucket`, `format`, `checksum_sha256` | The whole triple is recorded rather than derived on read: a bucket rename or a provider swap must not make an old archive unlocatable |
| Audit | `db_version`, `app_version`, `migration_name` | All best-effort; none may fail a backup |
| Proof | `verified_at` | Set only after the **uploaded object** passed `pg_restore --list` |
| Restore (Phase 7) | `restore_status`, `restore_error`, `restored_at`, `restored_by_id`, `restore_scratch_db`, `restore_old_db`, `swapped_at`, `pre_restore_backup_id` | Declared now, written by #285 |

`bytes_written` and `size_bytes` are `BigInt` because a dump crossing 2 GiB is
ordinary and a signed 32-bit column overflows at 2147483647 — the failure
would land on the largest backups, which is exactly the deployments this
feature exists for. The cost is real and belongs to #283: a Prisma `BigInt`
field is the JS `bigint` primitive, which `JSON.stringify` refuses outright,
so the response DTO must convert both explicitly. (`JobStatsRollup
.sumDurationMs` decided the same question the other way, and its own comment
says why: it is a running average, not a byte count that must stay exact.)

### 1.1 Why the restore audit lives on the backup's own row

There is no `database_restore_runs` table, and there should not be. **A
restore is always defined in terms of exactly one backup:** there is no
restore without an archive, no archive is restored twice concurrently, and
every question anyone asks about a restore — which dump was this, how big was
it, what schema was it on — is answered by the backup's own columns. A
separate table would buy a join on a strict 1:1 relationship and would let the
two rows disagree about which archive was replayed.

The cost is honest: a backup restored twice (a restore that failed, then was
retried) overwrites the first attempt's audit fields. That is the right trade —
the interesting record is the state of the *last* restore, and the full
history of attempts is in `audit_events`.

`pre_restore_backup_id` is a **self-FK**: before a restore swaps a database
away, #285 takes a `pre_restore` backup, and this column points the restore at
the safety net it took. `onDelete: SetNull`, so pruning that safety backup by
retention never deletes the restore record that referenced it.

## 2. The single-active-run guard is in the database

```sql
CREATE UNIQUE INDEX "database_backup_runs_active_uniq_idx"
  ON "database_backup_runs" ("status") WHERE "status" IN ('pending','running');
```

`DatabaseBackupRunnerService.startBackup` **inserts optimistically** and turns
the loser's Prisma `P2002` into a typed `DatabaseBackupAlreadyRunningError`
carrying the winner's run id, which #283 will render as a 409. There is
deliberately no `findFirst({ where: { status: 'running' } })` anywhere in that
path.

**Rejected: a pre-flight check.** It is check-then-act, and it is racy exactly
when it matters — a scheduled tick on replica A and an administrator's click
on replica B, in the same second. Both would see no active run, both would
insert, and two `pg_dump` processes would stream into two objects while the
settings say one backup a night. Only the database can make "is one already
active" atomic with the insert that would violate it. This is the same
argument, and the same shape, as `jobs_active_dedup_uniq_idx`.

**Prisma cannot express this index.** The schema language has no syntax for a
partial index, so it exists only in the migration, written by hand, and
`prisma migrate dev`/`diff` will want to drop it on the next diff. That drift
is intentional and permanent; both the migration and the `DatabaseBackupRun`
model carry the warning. `src/db-backup/db-backup-active-index.db.spec.ts`
proves against a real Postgres that it is applied and that it arbitrates.

**What it admits, precisely.** A UNIQUE index on `status` filtered to two
values permits at most one `pending` row *and* at most one `running` row. The
runner claims directly as `running` and never writes `pending`, so today the
ceiling is exactly one active run. `pending` exists in the enum as a declared
lifecycle state (claimed, dump not yet spawned) and is covered by the
predicate so a future path that does insert one is still arbitrated by the
database. A future design that needs both states populated at once must
**tighten** this index to a constant expression — never relax the guard into
application code.

## 3. Indexes

`[created_at DESC]` and `[started_at DESC]` are the admin list's two orderings
("when was it requested" and "when did it actually run" are different
questions for anything that waited). `[status]` backs the stale sweep and the
active-run lookup. `[status, created_at DESC]` is the retention query — the
completed runs, newest first, keep N — which neither single-column index
answers without a sort.

## 4. The claim is awaited; the dump is detached

`startBackup` awaits the INSERT and returns a real run, then lets the dump
continue in the background. It has to: a multi-gigabyte dump takes tens of
minutes and every reverse proxy between a browser and this process has a
response timeout measured in seconds. A synchronous `POST /backups` would 504
on exactly the databases worth backing up, the operator would retry, and the
retry would be refused by the index while the first dump — now unwatched —
carried on.

**The detached promise carries a terminal `.catch()`.** Without one, an
*expected* failure becomes an unhandled promise rejection, and an unhandled
rejection terminates the Node process by default. A failed backup must not be
able to take the API down with it.

The client/server version check runs inside that detached body, **before a
single byte is dumped**. `pg_dump` refuses to dump a server newer than itself;
checked first, that becomes a run whose `lastError` says "rebuild the image
with `postgresql<N>-client`" and points at
`docs/runbooks/postgres-client-version.md`. Checked never, it becomes an
opaque non-zero exit after a partial object has already been written. It runs
after the claim rather than before it so that a blocked deployment gets a
**visible failed run** in the admin list every night instead of an exception
swallowed by a cron with no row to point at. An *unreadable* version pair
warns and proceeds — see `pg-version.util.ts` for why that asymmetry is
deliberate.

## 5. The streaming contract

```ts
const hash = createHash('sha256');
let bytes = 0n;
const meter = new Transform({
  transform(c, _e, cb) { hash.update(c); bytes += BigInt(c.length); cb(null, c); },
});

dump.done.catch(err => meter.destroy(err));   // a dead dump must tear the upload down
dump.stdout.pipe(meter);
await Promise.all([provider.upload(key, meter, opts), dump.done]);
```

The archive is **never materialised**. There is no buffer, no temp file and no
second read: the checksum and the byte count are produced by the same single
pass the upload is already making. Buffering "just to hash it first" would put
an entire production database in the API process's heap.

**`Promise.all` on both halves is load-bearing, not belt-and-braces.** The two
failure modes are independent and each is invisible to the other side:

- A dump that dies mid-stream simply **ends** its stdout. The upload sees a
  clean EOF and reports a perfectly successful upload of a **truncated
  archive**. Only `dump.done`'s exit code distinguishes that from a complete
  dump — which is why `pg-dump.util.ts` calls it "the authority on success".
- A dump can exit non-zero **after** its last byte landed (a failure during
  cleanup), and an upload can fail after the dump finished cleanly.

Two cross-teardowns close the remaining leaks. A dead dump destroys the
metering stream, or the provider waits forever on bytes that will never come;
a dead upload SIGKILLs the dump, or `pg_dump` keeps reading a whole database
for an archive nobody is storing. Both streams also carry no-op `error`
listeners, because a Node stream that emits `error` with nothing listening
throws it as an **uncaught exception** — and both are destroyed on purpose in
these paths.

## 6. Verification reads the stored object back

Before a run is `completed`, the **uploaded object** is streamed out of
storage and through `pg_restore --list`; an empty table of contents fails the
run and the object is deleted.

The backup-time hash proves the bytes we *sent*. This proves the bytes that
*arrived* are a readable archive — which catches a truncated upload, a
zero-byte object, and a dump that ran against the wrong (empty) database, none
of which any exit code or byte count can see. `pg_restore --list` opens no
database connection at all, which is what makes it usable here.

The cost is one extra read of the object, and it buys the property that makes
the whole feature worth having: a run marked `completed` is a run whose
archive has been proven restorable-shaped at least once.

## 7. The heartbeat

Every ~20 seconds, one indexed UPDATE writes `last_heartbeat_at` and the live
`bytes_written`. It is the liveness signal this table has **instead of** a job
lease, and it doubles as the progress an operator watches move.

Twenty seconds is bounded on both sides by things that already exist:
`runStaleMinutes` can be set as low as 1, so the interval must sit comfortably
inside the smallest stale window; and each beat is one UPDATE by primary key,
so a tighter interval would be affordable but pointless for a number a human
reads. It is a **constant, not an environment variable** — no operator setting
would be a better answer than "well inside the smallest stale window", and a
knob whose only wrong settings are silent is a knob worth not having.

A heartbeat write that fails is **swallowed**. A connection recycled, a brief
failover, a lock wait — none of those is evidence that a dump streaming
perfectly well should be abandoned, and aborting a two-hour backup over one
progress UPDATE would be a self-inflicted outage. A *sustained* failure is not
silent either: the heartbeat stops advancing, which is precisely what #282's
stale sweep looks for. The timer is cleared in a `finally`, on every path: a
heartbeat outliving its run would keep writing to a settled row forever, which
is the exact signal that sweep trusts.

## 8. Failure ordering, and cancellation

On failure the partial object is deleted **first**, then the row is marked
`failed`. In that order, always: the row is the only index of what exists in
the bucket, so a run marked `failed` while its object is still there is an
orphan nothing will ever look for, billed forever. Deleting first means the
worst case is the opposite — an object already gone while the row still says
`running` — which the stale sweep resolves.

The delete is best-effort and **never masks the original error**. Why the
backup failed is what the operator needs; "and the cleanup also failed" is a
log line.

**There is no automatic retry.** The next scheduled run is the retry.

`cancel(runId)` works through a **process-local abort map**: only the process
that spawned the child can signal it. It kills the child and destroys the
metering stream, which tears the upload down, which fails the `Promise.all`,
which reaches the **ordinary** failure path — same delete, same mark, same
heartbeat cleanup. Cancellation is deliberately not a second teardown
mechanism; a bespoke "cancelled" cleanup would be a second chance to leave a
half-written object in the bucket.

When this process holds no handle — the run belongs to another replica, or it
already settled — `cancel` returns `{ outcome: 'not_running_here' }` rather
than pretending. Reporting success there would tell an operator their dump had
stopped while it is still streaming.

## 9. The storage destination

The runner injects `STORAGE_PROVIDER` directly and reads `getBucket()`. It
imports `StorageProvidersModule`, **not** `StorageModule` — the same choice
`JobsModule` and `NodesModule` made, and for the same reason plus one of its
own: routing a backup through `ObjectsService` would give every archive a
user-facing `storage_objects` row an administrator could delete by hand,
outside the retention policy that is supposed to own its lifetime.

**The server chooses the key.** No caller supplies any part of it:

```
database-backups/<slug>/<YYYY>/<MM>/<slug>-<YYYYMMDDTHHMMSSZ>-<runId>.dump
```

`database-backups/` is a fixed, descriptive prefix — what these objects are,
not whose — and it is what a bucket lifecycle rule or an IAM policy targets.
`<slug>` is `APP_NAME` slugified, because **nothing in this repository may
hard-code an application, product or repository name** and because two
applications built from this template must be able to share one bucket without
colliding (the same argument `jobs/job-temp.ts` makes for its temp-file
prefix). `<YYYY>/<MM>` keeps the prefix listable by month, which the retention
sweep pays for otherwise. The compact UTC timestamp sorts lexicographically in
time order. The run id makes the key collision-free rather than merely
unlikely.

`databaseBackup.storageProvider` must be **empty (meaning "whatever is
active") or exactly the active provider's id**; anything else is a 400. This
template binds one provider, so the field cannot select anything today — but
it is the field a fork that grows a second provider will use, and today it is
what catches an operator who set it to `gcs` and believed their backups were
going to Google Cloud Storage. The rule lives in one helper called from **both**
sides: #283's config write (so a wrong value is rejected as it is typed) and
the runner itself (so a wrong value that predates the check cannot quietly
redirect tonight's backup).

Multi-provider backup destinations are **out of scope**. A fork that wants one
adds a provider registry and reads this field to select from it; nothing here
has to change shape for that, which is why the column exists now.

## 10. Rejected alternatives

**Run the backup as a queue job.** See the section at the top. Two concurrent
`pg_dump` processes writing one key, and no error.

**Buffer the archive and upload it afterwards.** Simpler code, and it makes
`Content-Length` available. It also puts the entire database in the API
process's heap (or on a container filesystem that may not have room), and it
fails on precisely the deployments that need a backup most. Every property in
§5 exists to avoid this.

**Write the dump to a temp file, then upload the file.** Bounded memory, but
unbounded *disk*: the container needs as much free space as the database, the
file survives a SIGKILL (the failure `job-temp.ts`'s janitor exists for), and
the archive is then read twice. It buys nothing the streaming path does not
already have.

**Await only the upload.** The tempting simplification, and the one that
silently stores truncated archives forever — see §5.

**Verify with the checksum alone.** It proves the bytes we sent were hashed
correctly and says nothing about what the bucket holds. A zero-byte object has
a perfectly good checksum of nothing.

**Verify by restoring into a scratch database.** The strongest possible
check, and it is what #285 does deliberately, on demand. As a step in every
nightly backup it would need a second database, the privileges to create one,
and roughly the runtime of the dump again — turning a two-hour backup into a
four-hour one on the deployments least able to afford it.

**A `findFirst` guard instead of the index.** Check-then-act; see §2.

**An in-process mutex instead of the index.** Correct on one replica and
worthless on two, which is the only configuration where the race is likely.

**A separate `database_restore_runs` table.** A join on a strict 1:1
relationship, and two rows that can disagree; see §1.1.

**`DB_BACKUP_HEARTBEAT_MS` as an environment variable.** See §7 — the only
settings a fork could choose are silently wrong ones.

**Cancel by marking the row `cancelled`.** A status the runner would then have
to poll for, on a path whose whole point is that it is streaming. And it could
not stop the child: only the process holding the handle can. The abort map is
honest about that; a status column would not be.

## 11. Verification for this part

| Claim | Covered by |
|---|---|
| The index is applied, is UNIQUE, and carries the documented predicate | `src/db-backup/db-backup-active-index.db.spec.ts` (real Postgres) |
| Two concurrent active inserts from two independent clients: exactly one succeeds, and the loser's error is `P2002` | `src/db-backup/db-backup-active-index.db.spec.ts` — ten deterministic rounds, not sampling |
| The slot frees as soon as the holder settles; settled runs are unconstrained | `src/db-backup/db-backup-active-index.db.spec.ts` |
| A `P2002` becomes `DatabaseBackupAlreadyRunningError` carrying the active id, and the lookup happens **only after** the insert failed | `src/db-backup/db-backup-runner.service.spec.ts` — asserted on call order, which is what makes "no pre-check" testable |
| An unrelated unique violation stays loud | `src/db-backup/db-backup-runner.service.spec.ts` |
| The provider receives a `Readable`, never a buffer, string or array, and no `contentLength` | `src/db-backup/db-backup-runner.service.spec.ts` |
| The archive is never materialised: in-flight bytes stay under 8 MiB while 64 MiB streams, and process memory (heap **and** external) does not grow by the archive's size | `src/db-backup/db-backup-runner.service.spec.ts` |
| Checksum and byte count are one pass and match an independently computed sha256; the stored object is read exactly once | `src/db-backup/db-backup-runner.service.spec.ts` |
| A dump that dies mid-stream fails the run **even though the upload resolved** | `src/db-backup/db-backup-runner.service.spec.ts` |
| An upload that dies fails the run **even though the dump exited 0**, and the dump is SIGKILLed | `src/db-backup/db-backup-runner.service.spec.ts` |
| A run is not `completed` until the uploaded object passes `pg_restore --list`; an empty TOC fails it and deletes the object | `src/db-backup/db-backup-runner.service.spec.ts` |
| The heartbeat advances `bytes_written` mid-dump without touching `size_bytes`; a write failure does not abort the run; the timer is cleared on both terminal paths | `src/db-backup/db-backup-runner.service.spec.ts` |
| The default timer seam beats on a real interval and stops when cleared | `src/db-backup/db-backup-runner.service.spec.ts` (Jest fake timers) |
| Failure deletes the partial object **before** marking the row failed, and a failed delete does not mask the original error | `src/db-backup/db-backup-runner.service.spec.ts` — asserted on call order |
| A failed run keeps how far it got, and nothing retries | `src/db-backup/db-backup-runner.service.spec.ts` |
| A blocked version pair fails the run before any dump or upload, with the runbook message; an unreadable pair proceeds | `src/db-backup/db-backup-runner.service.spec.ts` |
| Cancel routes through the ordinary failure path; cancelling a run this process does not hold reports `not_running_here` | `src/db-backup/db-backup-runner.service.spec.ts` |
| A `storageProvider` naming a non-active provider is rejected before any row exists; empty means "active"; the same helper serves #283 | `src/db-backup/db-backup-runner.service.spec.ts` and `src/db-backup/db-backup-storage.spec.ts` |
| The key is server-chosen, prefixed, month-partitioned, time-sortable, run-id-unique, UTC, and derives its name component from `APP_NAME` | `src/db-backup/db-backup-storage.spec.ts` |
| The audit trio is recorded on completed **and** failed runs, and an audit read failure never fails a backup | `src/db-backup/db-backup-runner.service.spec.ts` |

Be honest about the limits of #281. Nothing here runs a real `pg_dump` against
a real database — the engine seam stands in for both, so what is proved is
that this service treats a dump's stream and its exit code correctly, not that
`pg_dump`'s argv is right (which `pg-dump.util.spec.ts` asserts separately, at
the layer that owns it). The real-Postgres suite proves the index and nothing
about the engine. And no test asserts an end-to-end restore of a backup this
engine produced; that is #285's to prove, with a real archive.
