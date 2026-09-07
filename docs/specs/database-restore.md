# Database Restore

> Epic #254, Phase 7 (**#284** the cluster admin connection and the pre-flight
> gates — what is merged today; #285 the scratch-database restore and the
> atomic swap; #286 the HTTP endpoints; #287 the administrator's dialog).
> Implemented in
> `apps/api/src/db-backup/admin-connection.util.ts`,
> `apps/api/src/db-backup/restore-preflight.service.ts`,
> `apps/api/src/db-backup/migration-state.util.ts` and
> `apps/api/src/db-backup/db-backup.module.ts`, over the `restore*` columns
> `apps/api/prisma/schema.prisma` already declares on `DatabaseBackupRun` (see
> `docs/specs/database-backup.md` §1.1 — this issue adds no migration).
>
> **Be honest about what exists.** #284 ships the *knowing*, not the *doing*.
> Everything below §1–§7 is merged and tested. **There is no restore yet:**
> nothing in this repository creates, drops or renames a database, no route
> accepts a restore request, and the `restore_status` column is still written
> by nobody. §8 says what #285 adds and what it will depend on.
>
> The backup half — the model, the streaming `pg_dump` engine, retention, the
> schedule and the admin API — is `docs/specs/database-backup.md`. The
> operator-facing procedure is `docs/runbooks/database-restore.md`. Neither is
> restated here.

## Why a restore needs a pre-flight at all

A restore either works or it destroys the production database, and it is
irreversible from the moment the swap begins. What makes that tolerable is
that **almost everything which can go wrong is knowable before anything is
created**: whether the role may create a database, whether the binaries can
read the archive, whether the schema matches the running code, whether there
is room on disk. None of those questions needs a single byte to be written to
find out.

So the pre-flight is a separate, side-effect-free operation, and the rule is
absolute:

> **No pre-flight path may create, drop or rename anything.**

It is an acceptance criterion with its own test — the four mutating helpers are
spied on, and every statement the fake cluster receives is matched against
`/CREATE DATABASE|DROP DATABASE|ALTER DATABASE|pg_terminate_backend/` — because
an operator asks "can I restore this?" precisely when they have *not* decided
to. A question that leaves a half-created database behind is a question nobody
can afford to ask.

## 1. The cluster admin connection

`admin-connection.util.ts` opens a short-lived `pg.Client` to the **maintenance
database** (`postgres`), for one unit of work, closed in a `finally`.

### 1.1 Why it is outside the Prisma pool

Two structural reasons. Neither is a preference:

1. **Those pooled connections are exactly what must be gone before a rename can
   succeed.** `ALTER DATABASE ... RENAME TO` fails while *any* session is
   connected to the database being renamed, and Prisma holds a pool of exactly
   those sessions open for the process's lifetime. A restore that borrowed a
   Prisma connection would be holding open the one thing it first has to get
   rid of.
2. **A database cannot be renamed from a session connected to it.** Prisma is
   bound to one database, by URL, at startup — the application's, which is the
   one a restore renames away. There is no Prisma API that points it elsewhere,
   so the DDL has to be issued from a session attached to a *different*
   database.

`pg-version.util.ts` already carries the `pg` dependency and says the same
thing where it introduces it; this file is the second, larger use of the same
seam.

### 1.2 The maintenance database, and the case people forget

`postgres` by default — it exists on every cluster `initdb` has created, and it
is what `createdb`, `dropdb` and `psql -l` attach to for this exact reason.

**When the application's own database is called `postgres`, the connection
falls back to `template1`.** A deployment with `POSTGRES_DB=postgres` is
ordinary (several hosted images default to it), and attaching to it would put
the admin session *inside* the database the swap has to rename — the one
arrangement that cannot work.

The maintenance database is a **parameter, not a new environment variable**,
following the precedent `PG_DUMP_COMMAND` set: the deployments needing
something other than `postgres` are rare enough that a caller-supplied value is
the right seam, and an unused variable in `.env.example` is a knob nobody
maintains.

### 1.3 The connection is always closed

`withAdminConnection(config, fn)` ends the session in a `finally` on **every**
exit path: return, throw, and — via an optional wall-clock bound — a callback
that never settles. A leaked session to the cluster is what makes the later
rename fail, and it fails at the worst possible moment: after the archive has
been replayed and the application has been stopped.

A failing `end()` never masks the failure that caused it. A close error on top
of a refused password would send an operator to entirely the wrong runbook.

### 1.4 `statement_timeout` is deliberately 0

Not "left at the default" — **set** to zero, explicitly, on every admin session,
so no server-side default (a managed provider's, a `postgresql.conf`, an
`ALTER ROLE ... SET`) can apply to this one.

A timeout firing part-way through `CREATE DATABASE` or `ALTER DATABASE ...
RENAME` does not undo the statement. It cancels the *client's wait* for it, and
what the caller then holds is **ambiguity** — a rename that may or may not have
happened, on the database the application is about to be pointed at. There is
no safe automated response to that. An unbounded wait is the better failure: it
is visible, a human can interrupt it, and the cluster's state stays knowable.

The bound that *does* exist is a wall-clock one on the whole callback,
defaulting to **off**. Pre-flight passes 15 seconds because every query it
issues is a trivial catalog read and it runs inside an HTTP request; #285's
swap passes none.

### 1.5 Identifiers: rejected, never escaped

**DDL cannot use bind parameters.** `CREATE DATABASE $1` is a syntax error — the
parameter machinery works on values, and a database name is a name — so every
identifier reaching a statement is interpolated, and `quoteIdentifier` is the
only thing between a stored string and arbitrary SQL.

It **rejects** anything outside `^[A-Za-z_][A-Za-z0-9_$]*$` (and anything over
63 bytes) rather than escaping it. The standard escape — doubling an embedded
`"` — is correct as far as it goes, but it *accepts every name*, and the
statement's safety then depends on that implementation being right about every
case forever: embedded NULs, invalid UTF-8, a 64-byte name the server silently
truncates into something else. An allowlist has the opposite failure mode. The
worst it can do is refuse a legal name, loudly, in a code path somebody is
watching. Every name this subsystem uses is the configured database name or one
derived from it, so the allowlist costs nothing real.

### 1.6 Name builders trim the base, never the tail

`<live>_restore_<timestamp>` and `<live>_old_<timestamp>`, both UTC, both using
the same `compactTimestamp` the storage keys use.

**PostgreSQL does not reject an over-long identifier — it truncates it**, to 63
bytes, with a notice nobody reads. So for a database whose name is already near
the limit, `<63-char name>_restore_20260907T120000Z` and the same name with
tomorrow's timestamp truncate to the **same physical name**: two restores
silently sharing one scratch database, the second finding the first's
half-restored contents. Trimming the *base* keeps the disambiguating part,
which is the only part that disambiguates. There is a test with a maximally
long database name asserting the suffix survives, the result is ≤ 63 bytes, and
two timestamps still produce two names.

### 1.7 What is exported, and who may call it

| Operation | Reads or mutates | Called by pre-flight? |
|---|---|---|
| `probeCreateDatabasePrivilege` | read | yes |
| `probePgExtensionAvailable` | read | yes |
| `readDatabaseSizeBytes` | read | yes |
| `readDataDirectory` | read | yes |
| `countDistinctClientAddresses` | read | yes |
| `databaseExists` | read | no — #285, before `CREATE DATABASE` |
| `createDatabase` | **mutates** | **never** |
| `dropDatabase` | **mutates** | **never** |
| `terminateConnections` | **mutates** | **never** |
| `renameDatabase` | **mutates** | **never** |

The mutating four live here, beside the reads, because they share the
connection contract and the identifier rules — not because pre-flight has any
use for them.

## 2. The gates

Seven, evaluated in one round and **all seven reported**, including the ones
that passed. #287's dialog renders the whole list: an operator about to replace
their production database is entitled to see what was checked, and a gate that
returns nothing when it is happy leaves no way to tell "checked, fine" from
"never ran".

| Gate | Kind | On failure |
|---|---|---|
| `pg_client_version` — client major vs server major | capability | **blocks**, non-overridably |
| `admin_connection` — maintenance database reachable | capability | → `guided` |
| `createdb_privilege` — **probed, never assumed** | capability | → `guided` |
| `extensions` — every installed extension is available | capability | → `guided` |
| `disk_space` — free ≥ ~1× database (+1× when retaining) | disk | **downgrades**, never refuses |
| `replicas` — distinct client addresses | replicas | **warning only** |
| `schema_compatibility` — archive vs live migration | overridable | **blocks** unless overridden |

Each verdict is `pass`, `warning` or `block` and carries its own `action` item,
because a `guided` outcome routinely has two or three findings with different
remedies and flattening them into one string is how an operator fixes the first
and is surprised by the second.

### 2.1 `CREATEDB` is probed, never assumed

`SELECT (rolsuper OR rolcreatedb) FROM pg_roles WHERE rolname = current_user`.
Superuser implies the privilege without the attribute being set, and
`current_user` rather than the configured user name because `SET ROLE`, a
connection pooler or a `DATABASE_URL` override can all make the session's role
something other than what the environment says.

Managed PostgreSQL withholds `CREATEDB` from application roles as a matter of
course. Assuming it means discovering the truth at the moment a restore starts
— after the operator has committed to it, during an incident.

### 2.2 The version gate is the one capability gate that blocks

Every other capability failure has a manual answer: a superuser can create the
database the API's role may not. But the guided block's `pg_restore` is still a
`pg_restore`, and a client older than the server refuses to read the archive
whoever runs it. The fix is an image rebuild
(`docs/runbooks/postgres-client-version.md`), not a command to paste, so it
blocks — and it is **not overridable**, because overriding it produces a
restore that fails on the first byte having already stopped the application.

`unknown` proceeds, exactly as it does for a backup. An unparseable version
banner is not evidence that a restore would fail, and it must never be the
reason a recovery did not happen.

### 2.3 The extensions gate reads two catalogs

`pg_extension` in the **live database** (through Prisma — it is a per-database
catalog, and the admin session is attached to the maintenance database) says
what the archive will try to `CREATE EXTENSION`. `pg_available_extensions` on
the **cluster** says what the server's filesystem can offer.

In the ordinary case an archive is dumped and restored inside one cluster and
this passes. It earns its place the day the target is a *new* server,
provisioned from a different image, where `pgcrypto` or `postgis` is simply not
installed — `pg_restore --exit-on-error` would stop on that line, having
already created a scratch database.

### 2.4 A short disk downgrades; it never refuses

`restoreRollbackMode: retain_database` keeps the displaced database on disk. It
costs a second full copy and buys a rollback measured in **seconds** (one
`ALTER DATABASE ... RENAME`). When there is not room, pre-flight downgrades the
**effective** mode to `pre_restore_dump` — the safety backup #285 takes
immediately before swapping — and **reports the downgrade**.

An administrator mid-incident must never be left with no path forward. What the
downgrade costs is reported in those terms: *the recovery guarantee changes
from seconds to hours*, because rolling back now means restoring an archive
rather than renaming a database. That is a decision they can act on. "Not
enough disk, refused" is not.

Two related rules:

- **An invisible data directory is a warning, never a false block.** `SHOW
  data_directory` needs superuser or `pg_read_all_settings`, which a managed
  platform will not grant; and even when the path is readable it usually
  belongs to a *host this container has never seen*, because
  `infra/compose/base.compose.yml` declares no `db` service. Refusing a
  recovery on the strength of a `statfs` against somebody else's filesystem
  would be indefensible.
- **When the numbers are unreadable, the configured mode stands.** Downgrading
  on a guess would silently remove a rollback guarantee the operator asked for.

The requirement is deliberately approximate — one copy for the scratch replay,
plus one for the displaced database when retained. A restored database is
usually a little *smaller* than the original (no bloat, fresh indexes), and
WAL, sort files and index builds all want space this does not model. The number
exists to catch "there is nowhere near enough", and it never blocks.

### 2.5 The replica count is a heuristic, so it only warns

`COUNT(DISTINCT client_addr)` on the live database approximates "more than one
API instance is connected", and #285's swap assumes exactly one — the
maintenance flag is per-process, so a second replica keeps serving traffic,
gets terminated mid-request by the swap, and then talks to a database that has
been renamed out from under it. Worth telling an operator.

Not worth blocking on. The count also rises for a bastion host, a `psql`
window, a metrics exporter or a migration runner, and it *undercounts* every
replica behind one NAT. Refusing a legitimate recovery because somebody left a
query window open would be the wrong failure.

### 2.6 The schema gate blocks in **both** directions

The archive's recorded `migration_name` (written best-effort by #281 on every
run row) against the live latest applied migration. One query, in
`migration-state.util.ts`, used by **both** the backup engine and this gate —
two copies with different `rolled_back_at` handling would make the comparison
meaningless in either direction.

- `archive_older` is the obvious mismatch: the restored database lacks columns
  the running code selects, and the first request after the swap fails.
- `archive_newer` is the **dangerous** one, because it looks harmless. The
  archive has columns the code does not know about — fine, until the deployment
  that produced it also removed or renamed something, or changed a constraint
  the old code violates. And the migration runner will consider the schema up
  to date and apply nothing, so nobody is ever told.

Both block. A restore across a schema boundary is a decision, and it has to be
made by a person, once, deliberately — by re-sending with the override, which
accepts the restore-then-`migrate deploy` path.

An archive with **no** recorded migration is a `warning`, not a block: #281
records it best-effort, and refusing to restore an archive whose audit read
failed would make a best-effort field load-bearing after the fact.

## 3. Three outcomes, and all three are normal

**`ok`** — proceed. Warnings may still be attached; the dialog renders them.

**`guided`** — a capability gate failed, so the response carries a
ready-to-paste, fully parameterised **command block** and a runbook link
*instead of an error*.

> This is a **designed-in path, not a fallback**. Managed PostgreSQL routinely
> denies `CREATEDB`, and an operator on such a platform must still be able to
> restore — with a superuser, by hand, from the same archive. A 4xx here would
> tell them their platform is unsupported when it is not, in the middle of an
> incident.

**`blocked`** — something would make the restore fail or silently corrupt the
deployment. Only the schema gate is overridable; the block carries
`overridable` and the name of the parameter that unblocks it, so the API and
this service cannot disagree about what unblocks what.

### 3.1 Precedence

Non-overridable block → `guided` → overridable block.

`guided` outranking the schema block is deliberate. A `blocked` result tells
the operator to re-send with the override; if the automated path could not run
anyway (no `CREATEDB`), that instruction sends them round a loop. The guided
instructions carry the schema mismatch as an extra step instead, and the schema
gate's own verdict is still in `gates` for the dialog to render.

The version block outranks everything, because nothing else matters if the
binaries cannot read the archive.

### 3.2 The override unblocks exactly one gate

`overrideSchemaMismatch` clears the schema gate and **nothing else**. No amount
of accepting makes a role without `CREATEDB` able to create a database, and an
override that silenced everything would turn the one deliberate escape hatch in
this subsystem into a way to skip all of it. There is an explicit negative test
for each direction.

## 4. The guided command block is the deliverable

On the `guided` path the command block **is** the answer, so it must be
complete, correctly parameterised and paste-ready: real host, real port, real
user, real database names, real run id, real archive filename. A block with
`<your-host>` in it is not instructions — it is homework, handed to somebody
whose application is down, and every substitution they make by hand is a chance
to point a `RENAME` at the wrong database. **It is asserted by string in the
tests** for exactly that reason.

Two values are deliberately *not* interpolated, and neither is a placeholder in
the "fill this in" sense:

- **The password.** Printing it would put a live database credential into an
  HTTP response, a browser's memory, a screenshot and quite possibly a support
  ticket. The block exports it from the environment the operator already has.
- **The signed download URL.** It does not exist yet: it is minted, with a
  five-minute expiry, by the command on the line above it.

The block ends with the way back — the two renames that undo the swap while the
displaced database still exists — and a pointer to the runbook. When the schema
also mismatches it gains a migration step; when it does not, it does not.

Nothing in it hard-codes an application, product or repository name: every
name is derived from the deployment's own configuration.

## 5. What pre-flight deliberately does **not** check

**The archive's bytes.** Proving an archive readable means streaming the whole
object out of storage through `pg_restore --list` — the object is the size of
the database, so that is gigabytes and minutes to hours. An HTTP request cannot
wait on it, and a pre-flight that sometimes takes an hour is a pre-flight
nobody runs. It is the **first phase of #285's asynchronous restore run**, where
there is a row to record progress on and a heartbeat to prove it is alive.
There is a comment in the service saying so, so nobody adds it here.

**Whether the derived names are free.** The timestamp in a scratch name is
generated when the name is built, so a pre-flight check would prove nothing
about the name #285 builds later. `databaseExists` is exported for #285 to use
at the point it matters.

**The run's status, the caller's permission, and the 404.** #286's endpoint
owns those, exactly as `getDownloadUrl`'s `completed`-only refusal lives in the
admin service. This service answers a question about a row it is given.

## 6. Wiring

`DatabaseRestorePreflightService` is a **provider in `DbBackupModule`, not
exported, and bound to no controller**: #286 owns the restore endpoints, and a
service reachable over HTTP before the route that authorizes it exists is a
surface nobody has reviewed.

It needs no new module import. `SettingsModule` already supplies
`SystemSettingsService` (it reads `restoreRollbackMode`), `PrismaModule` is
`@Global()`, and the cluster work goes through a `pg.Client` outside the pool.
It notably does **not** take `StorageProvidersModule`: pre-flight never touches
the archive's bytes.

`RESTORE_PREFLIGHT_SEAM` and `RESTORE_ADMIN_CLIENT_FACTORY` are optional tokens
left **unbound**, the same discipline `DB_BACKUP_ENGINE`, `DB_BACKUP_TIMERS`,
`JOB_CLOCK` and `JOB_RANDOM` follow. The application always probes a real
cluster; only a test constructing the service directly can substitute one. A
stubbed cluster connection in production would report a clean pre-flight
against nothing at all, which is the single most dangerous lie this subsystem
could tell.

**No migration.** The `restore*` columns were declared by #281.

## 7. Rejected alternatives

**Assuming `CREATEDB`.** The natural shortcut: the application connects as an
owner, so of course it can create a database. It cannot, on any managed
PostgreSQL, and the discovery happens at the moment a restore starts — after
the operator committed to it, during an incident. Probing costs one catalog
read and turns a mid-restore failure into a pre-flight verdict with
instructions attached.

**Reusing the Prisma pool for the admin work.** There is already a database
connection; opening another looks like duplication. Those pooled connections
are precisely what must be gone before the rename can succeed, and Prisma
cannot be pointed at another database anyway — the swap would be issued from a
session attached to the database being renamed, which Postgres refuses. See
§1.1.

**A non-zero `statement_timeout` on the admin session.** The defensive-looking
choice, and it buys ambiguity rather than safety: a cancelled `CREATE DATABASE`
or `ALTER DATABASE ... RENAME` still may have happened, on the database the
application is about to be pointed at, and there is no safe automated response
to "maybe". See §1.4.

**Refusing on a short disk.** The conservative-looking choice, and it is the
one that leaves an administrator mid-incident with no path forward. The
downgrade to `pre_restore_dump` is a smaller loss, honestly reported: the
recovery guarantee changes from seconds to hours. See §2.4.

**Blocking on the replica heuristic.** `COUNT(DISTINCT client_addr)` cannot
tell an API replica from a `psql` window, and collapses every replica behind
one NAT into a single address. Blocking on it would refuse legitimate restores
for reasons the operator cannot even see, while still missing the case it
exists for. See §2.5.

**Truncating identifiers from the tail** (or letting the server do it). Silent,
and it makes two restores of a near-63-character database share one physical
scratch database. Trimming the base keeps the only part that disambiguates. See
§1.6.

**Escaping identifiers instead of rejecting them.** Accepts every name and then
depends on being right about every case forever. An allowlist's worst failure
is refusing a legal name, loudly. See §1.5.

**Verifying the archive during pre-flight.** It is the check people most expect
to be here, and it requires downloading multiple gigabytes inside an HTTP
request. It belongs to #285's first phase. See §5.

**A `guided` result as a 4xx.** It reads like a failure — the automated restore
cannot run — and answering it as an error would tell an operator on managed
PostgreSQL that their platform is unsupported. It is a normal outcome carrying
a different set of instructions. See §3.

## 8. What #285 adds, and what it will need from the operator

Not merged. Recorded here so this document is honest about the shape of the
thing the gates are gating:

1. Verify the archive (phase one of the async run — see §5).
2. Take a `pre_restore` backup; point the restore row at it via
   `pre_restore_backup_id`.
3. `CREATE DATABASE <live>_restore_<ts>`, `pg_restore --exit-on-error` into it.
4. Open the maintenance window, terminate the live database's sessions, and
   swap with two renames.
5. Keep or drop the displaced database per the **effective** rollback mode this
   pre-flight computed.

Two prerequisites an operator has to satisfy in advance, both documented in
`docs/runbooks/database-restore.md`:

- **A restart policy** (`restart: unless-stopped`, or a Kubernetes equivalent).
  The swap ends in `process.exit(0)` — a process whose database was renamed
  under it cannot be trusted to keep serving — so without a supervisor that
  restarts it, a **successful** restore leaves the application down.
- **A single API replica.** The maintenance flag is per-process. Other replicas
  keep serving, get terminated mid-request by the swap, and then talk to a
  renamed database. The `replicas` gate warns about this; it cannot enforce it.

## 9. Verification

| Claim | Covered by |
|---|---|
| The connection is closed on the success path, the throw path, and when the callback never resolves | `src/db-backup/admin-connection.util.spec.ts` |
| A failing `end()` does not mask the failure that caused it; a failed `connect()` still closes | `src/db-backup/admin-connection.util.spec.ts` |
| `statement_timeout` is set to 0 on every session; the callback bound is off by default | `src/db-backup/admin-connection.util.spec.ts` |
| The maintenance database falls back to `template1` when the application's is `postgres`; a `DATABASE_URL` override still wins; the password arrives decoded | `src/db-backup/admin-connection.util.spec.ts` |
| `quoteIdentifier` **rejects** quotes, terminators, spaces, newlines, NULs, non-ASCII, a leading digit, an empty string and a 64-byte name | `src/db-backup/admin-connection.util.spec.ts` |
| A maximally long database name still yields a legal, unique scratch name whose suffix survived, ≤ 63 bytes | `src/db-backup/admin-connection.util.spec.ts` |
| Every cluster read parses what the driver actually returns (`int8` as text, a missing row, an unreadable `data_directory`) | `src/db-backup/admin-connection.util.spec.ts` |
| Every mutation goes through the allowlist and refuses an identifier outside it **before** issuing anything | `src/db-backup/admin-connection.util.spec.ts` |
| Each gate independently produces the documented outcome | `src/db-backup/restore-preflight.service.spec.ts` |
| `CREATEDB` denied yields `guided` with a command block that is complete, correctly parameterised and paste-ready — **asserted by string** | `src/db-backup/restore-preflight.service.spec.ts` |
| The block never prints the password, contains no placeholder to invent, and gains the migration step only on a mismatch | `src/db-backup/restore-preflight.service.spec.ts` |
| A schema mismatch blocks in **both** directions; the override unblocks that gate and **never** a capability gate or the version pair | `src/db-backup/restore-preflight.service.spec.ts` |
| A short disk in `retain_database` downgrades to `pre_restore_dump` and reports it; an unreadable data directory warns and leaves the configured mode alone | `src/db-backup/restore-preflight.service.spec.ts` |
| The replica heuristic warns and never blocks | `src/db-backup/restore-preflight.service.spec.ts` |
| **No pre-flight path creates, drops or renames anything**, on every outcome — asserted with spies *and* against the SQL the cluster received | `src/db-backup/restore-preflight.service.spec.ts` |
| All reads happen in one session; an unreachable cluster is a verdict, not a throw; the archive is never fetched | `src/db-backup/restore-preflight.service.spec.ts` |

### 9.1 The limits

Be honest about them. **Nothing here talks to a real PostgreSQL.** The seam
stands in for the cluster, so what is proved is that this service asks the
right questions and reports the answers correctly — not that
`pg_available_extensions` behaves as assumed on every provider, nor that
`SHOW data_directory` fails in exactly the way the disk gate expects. The
identifier rules are proved against the *documented* 63-byte limit, not against
a server.

And the whole point of the pre-flight is that it is a prediction. A clean `ok`
means every question that could be asked cheaply was asked and answered well;
it does not mean the restore will succeed. That is what #285's `pre_restore`
backup is for.
