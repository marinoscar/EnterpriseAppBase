# Runbook: Restore the Database From a Backup

**Read this assuming the application is down.** That is when it is read, so
nothing below requires the admin UI, a browser session, or the API being able
to serve a request. Every step has a form you can run from a shell with `psql`
and the PostgreSQL client tools.

Source of truth for every claim below:

- `apps/api/src/db-backup/restore-preflight.service.ts` — the seven gates, the
  three outcomes, and the command block the `guided` outcome produces.
- `apps/api/src/db-backup/admin-connection.util.ts` — the maintenance
  connection, the identifier rules and the scratch/old name builders.
- `apps/api/src/db-backup/pg-restore.util.ts` — the `pg_restore` flags, and why
  `--exit-on-error` is load-bearing.
- `apps/api/src/db-backup/db-backup-admin.service.ts` — the backup list and the
  five-minute signed download URL.
- `docs/specs/database-restore.md` — the design, and the rejected alternatives.
- `docs/specs/database-backup.md` — where the archives come from.

**What exists today (#284).** The application can *tell you* whether a restore
would work, and hand you a complete command block when it cannot do it for you.
**It cannot yet perform the restore itself** — the scratch-database replay and
the swap are #285. Until then, section 4 is the procedure, and it is the whole
procedure.

---

## 1. Before you start

- **Know which archive you want.** Every backup is a `database_backup_runs` row
  with a `migration_name` on it — the schema that archive contains. Restoring
  an archive from a different migration than the running code expects is a
  decision, not an accident; see section 6.
- **Know the two prerequisites in section 7.** They are about the deployment,
  not the restore, and they have to be true *before* you start. Getting them
  wrong turns a successful restore into an outage.
- **Have a way back.** Until the swap is done and verified, the way back is the
  displaced database. After it is dropped, the way back is the `pre_restore`
  archive — measured in hours, not seconds.
- **Do not delete anything until you have verified the restore.** Not the
  scratch database, not the displaced one, not the archive.

## 2. What the pre-flight tells you

The pre-flight is side-effect free: it creates nothing, drops nothing, renames
nothing. Run it as often as you like.

It reports **seven gates**, each with a verdict and, when there is something to
do, an action:

| Gate | What it means when it is unhappy |
| --- | --- |
| PostgreSQL client version | The `pg_restore` in the API image is older than the server. **Nothing can restore until the image is rebuilt** — see `postgres-client-version.md`. |
| Cluster admin connection | The API cannot open a session on the `postgres` maintenance database. It cannot automate a restore; you still can. |
| `CREATE DATABASE` privilege | The application's role may not create databases. **Normal on managed PostgreSQL.** You still can, with a superuser. |
| Required extensions | The server does not offer an extension the database uses. `pg_restore` would stop on that line. Install the package on the server. |
| Free disk space | There is not room for a full copy (twice over, if the displaced database is being kept). **Never a refusal** — see section 3. |
| Connected clients | More than one client address is attached. Usually a second API replica, sometimes just a `psql` window. **A hint, not a verdict.** |
| Schema compatibility | The archive's migration and the live one differ, in either direction. **Blocks** until you accept it — see section 6. |

And **one of three outcomes**:

- **`ok`** — go ahead.
- **`guided`** — the application cannot do it, so it hands you a complete,
  paste-ready command block for doing it yourself. **This is a normal outcome,
  not an error.** Managed PostgreSQL denies `CREATEDB` as a matter of course.
- **`blocked`** — something would break. Only the schema gate can be
  overridden.

### 2.1 Running it without the UI

Once #286 lands, the pre-flight is an endpoint on the admin API and the CLI
reaches it with:

```bash
appctl api POST /api/admin/db-backup/runs/<run id>/restore/preflight
```

**If the API is not serving**, you cannot run it — and you do not need it. The
gates only tell you what section 4 would tell you anyway; go straight there and
read the errors as they happen. The two facts worth checking by hand first:

```bash
# Can this role create a database?
psql --host=<db host> --port=<db port> --username=<db user> --dbname=postgres \
  -c "SELECT rolsuper OR rolcreatedb AS can_create FROM pg_roles WHERE rolname = current_user;"

# Is the client new enough for the server?
pg_restore --version
psql --host=<db host> --port=<db port> --username=<db user> --dbname=postgres \
  -c 'SHOW server_version_num;'
```

The client major must be **greater than or equal to** the server major
(`server_version_num / 10000`). Older will not work at all.

## 3. Disk space, and the downgrade

A restore needs roughly **one full copy** of the database for the scratch
replay, and **a second** if the displaced database is being kept.

`databaseBackup.restoreRollbackMode` says which you asked for:

- `retain_database` — the displaced database is kept, renamed to
  `<database>_old_<timestamp>`, and deleted later by
  `oldDatabaseRetentionHours`. Rolling back is **one rename: seconds**.
- `drop_database` — it is not kept. Rolling back means restoring the
  `pre_restore` archive: **hours**.

**When disk is short, the pre-flight downgrades `retain_database` and tells
you.** It does not refuse. An administrator mid-incident must never be left
without a path forward, and what the downgrade costs you is a real, statable
thing: the recovery guarantee changes from seconds to hours. If you would
rather keep the fast rollback, free disk on the database server and run the
pre-flight again.

If the pre-flight says free space **could not be checked**, that is expected —
the database is usually on a host the API container cannot see the disks of.
Check by hand:

```bash
# On the database host:
df -h "$(psql --username=<db user> --dbname=postgres -tAc 'SHOW data_directory')"
```

## 4. The manual restore (the `guided` path, end to end)

This is the procedure the `guided` command block automates the parameters of.
Run it **as a role that may create databases** — a superuser, or any role
holding `CREATEDB`. On managed PostgreSQL this is usually the provider's admin
user, not the application's.

Throughout: `<live>` is the application's database (`POSTGRES_DB`), `<scratch>`
is `<live>_restore_<UTC timestamp>` and `<old>` is `<live>_old_<UTC timestamp>`.
Use the exact names the pre-flight printed when you have them.

### 4.0 Credentials

```bash
export PGPASSWORD='<the POSTGRES_PASSWORD this deployment uses>'
```

The application never prints this — putting a live database credential in an
HTTP response would leave it in a browser's memory, a screenshot, and probably
a support ticket.

### 4.1 Get the archive

With the API serving:

```bash
appctl api GET /api/admin/db-backup/runs/<run id>/download
curl -fSL -o /tmp/<archive>.dump "<the URL that command printed>"
```

The URL expires in **five minutes** and is a complete copy of the database to
anyone holding it. Treat it as a credential.

**With the API down**, fetch the object directly from the bucket. The run row
records `bucket` and `storage_key` precisely so the archive stays findable when
nothing else works:

```bash
aws s3 cp "s3://<bucket>/<storage key>" /tmp/<archive>.dump
```

If you cannot reach the database to read those columns either, backup keys are
laid out as
`database-backups/<app slug>/<YYYY>/<MM>/<app slug>-<UTC timestamp>-<run id>.dump`,
which lists in time order:

```bash
aws s3 ls "s3://<bucket>/database-backups/" --recursive | tail -20
```

### 4.2 Sanity-check the archive before you touch anything

```bash
pg_restore --list /tmp/<archive>.dump | head -20
```

An archive whose table of contents is **empty** would restore an empty
database. The backup engine already verifies this at upload time, but a file
that travelled through a laptop is worth re-checking.

### 4.3 Create the scratch database and replay into it

Nothing here touches the live database.

```bash
createdb --host=<db host> --port=<db port> --username=<admin role> <scratch>

pg_restore --host=<db host> --port=<db port> --username=<admin role> \
  --dbname=<scratch> \
  --no-owner --no-acl --exit-on-error --jobs=4 \
  /tmp/<archive>.dump
```

**`--exit-on-error` is load-bearing.** Without it `pg_restore` logs each
failure, carries on, and **exits 0** — so a database missing half its tables is
indistinguishable from a good one, and you would swap it into place believing
it worked.

`--no-owner --no-acl` mirror how the archive was dumped: it carries no
ownership, and the restore must not try to reapply any. Without them a restore
onto a fresh machine fails on the first `ALTER ... OWNER TO` naming a role that
does not exist there — which is exactly the restore that matters.

Then look at what you have before you commit to it:

```bash
psql --host=<db host> --username=<admin role> --dbname=<scratch> \
  -c "SELECT count(*) FROM users;" \
  -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;"
```

### 4.4 Stop the application

**Everything below renames databases out from under any process still
connected**, and a rename fails while a session is open. Stop every API
instance, not just one — see section 7.

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml stop api
```

### 4.5 Swap

Three statements, from the **maintenance** database (`postgres`) — a database
cannot be renamed from a session connected to it:

```bash
psql --host=<db host> --port=<db port> --username=<admin role> --dbname=postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '<live>' AND pid <> pg_backend_pid();" \
  -c 'ALTER DATABASE "<live>" RENAME TO "<old>";' \
  -c 'ALTER DATABASE "<scratch>" RENAME TO "<live>";'
```

The `pg_terminate_backend` is not optional: the rename fails while anything is
connected, including a pooler, a metrics exporter, or an API replica you
thought was stopped.

Each rename is a catalog update — it either happens or it does not. If the
second one fails, you are in the state described in section 5.2.

### 4.6 Migrate, if the schemas differed

Only when the pre-flight reported a schema mismatch (or you know the archive
predates the running code):

```bash
cd apps/api && npm run prisma:migrate
```

### 4.7 Start, and verify

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml start api
curl -fsS http://localhost:3535/api/health/ready
```

Then log in and look at real data. **Do not delete the displaced database until
you have.**

### 4.8 Clean up, later

```sql
-- Only after you are satisfied. This is the fast way back until it is gone.
DROP DATABASE "<old>";
```

## 5. When it goes wrong

### 5.1 `pg_restore` failed part way

Nothing has happened to the live database — the scratch database is a separate
database and the swap has not run. Drop the scratch and start again:

```sql
DROP DATABASE IF EXISTS "<scratch>";
```

Common causes, in order of likelihood: an extension the server does not have
(the pre-flight's extensions gate), a client older than the server, and a
truncated download (`pg_restore --list` in step 4.2 catches it).

### 5.2 The swap half-completed

The live database was renamed to `<old>` and the second rename failed. **There
is now no database called `<live>`,** and the application will not start.

```bash
# Look at what exists:
psql --host=<db host> --username=<admin role> --dbname=postgres -c '\l'
```

Then either finish the swap (`ALTER DATABASE "<scratch>" RENAME TO "<live>";`)
or undo it (`ALTER DATABASE "<old>" RENAME TO "<live>";`). Undoing is always
safe: `<old>` is the original database, untouched.

### 5.3 The restore was wrong (bad archive, wrong point in time)

While `<old>` still exists — **seconds**:

```sql
ALTER DATABASE "<live>" RENAME TO "<scratch>";
ALTER DATABASE "<old>"  RENAME TO "<live>";
```

Once `<old>` has been dropped, the way back is the `pre_restore` archive, and
you are running section 4 again from the top — **hours**. This is exactly the
difference the disk downgrade in section 3 warns you about.

### 5.4 "database is being accessed by other users"

Something is still connected. Re-run the `pg_terminate_backend` statement, and
check for the things that reconnect on their own: a second API replica, a
worker, a pooler (PgBouncer will reopen server connections immediately), a
metrics exporter, an open `psql`.

## 6. Restoring across a schema boundary

The pre-flight **blocks** when the archive's migration and the live one differ,
in **either** direction, and only a human can clear it.

- **Archive older than live.** The restored database lacks columns the running
  code selects. Run the migrations after the swap (step 4.6) — that is the
  supported path.
- **Archive newer than live.** This looks harmless and is the more dangerous
  one: the running code has never seen that schema, and the migration runner
  will consider it up to date and apply nothing, so nothing tells you. Deploy
  the matching application version *first* wherever possible.

To proceed deliberately, re-send the pre-flight (and, from #285, the restore)
with the override. It clears **that gate and nothing else** — it does not, and
cannot, grant a role `CREATEDB` or make an old client read a new server.

## 7. Two prerequisites for the automated restore (#285)

Both are about the deployment, both have to be true *in advance*, and both turn
a successful restore into an outage when they are not.

### 7.1 A restart policy

The automated swap ends in **`process.exit(0)`**. That is deliberate: a process
whose database was renamed out from under it holds a connection pool pointing
at a database that no longer exists under that name, and cannot be trusted to
keep serving. Exiting hands the problem to the supervisor.

**Without a supervisor that restarts it, a *successful* restore leaves the
application down.** Make sure the API service has:

```yaml
services:
  api:
    restart: unless-stopped
```

or, on Kubernetes, a Deployment (whose default `restartPolicy: Always` does the
same thing) rather than a bare Pod or a Job.

Verify before you restore:

```bash
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' <api container>
# want: unless-stopped  (or always)
```

### 7.2 A single API replica

**The maintenance flag is per-process.** The instance performing the restore
puts *itself* into maintenance; every other replica keeps serving traffic,
gets its database connections terminated mid-request by the swap, and then
finds itself talking to a database that has been renamed.

Scale to one before restoring:

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up -d --scale api=1
# Kubernetes:
kubectl scale deployment/<api deployment> --replicas=1
```

The pre-flight's `replicas` gate *warns* when it sees more than one client
address, but it cannot enforce this: it counts a bastion host and a `psql`
window too, and it cannot see two replicas behind one NAT at all. It is a hint.
You are the check.

## 8. Related

- `docs/specs/database-restore.md` — why the admin connection is outside the
  Prisma pool, why `guided` is a normal outcome, and what was rejected.
- `docs/specs/database-backup.md` — where archives come from, and the retention
  rules that decide how long they last.
- `docs/runbooks/postgres-client-version.md` — fixing a client/server major
  mismatch.
- `docs/runbooks/maintenance-mode.md` — opening and closing a window by hand,
  and recovering from one that locked you out.
