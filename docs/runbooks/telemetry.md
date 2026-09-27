# Runbook: Enable, Configure and Operate Telemetry

> **Audience:** operators · **Spec:** [telemetry.md](../specs/telemetry.md) · **Admin UI:** `/admin/settings/telemetry`, `/admin/settings/telemetry/explorer` · **Permission:** `telemetry:read`/`telemetry:write`/`telemetry:query`

This runbook covers turning telemetry on for a deployment (local or VPS),
setting its policy, verifying it, rotating GreptimeDB's passwords, and
connecting a BI tool to it over SSH. It does not cover the design — see
[the spec](../specs/telemetry.md) for the architecture, the two switches, and
the security model.

Source of truth for every claim below:

- `infra/compose/telemetry.compose.yml`, `infra/compose/vps.telemetry.compose.yml`
- `infra/otel/otel-collector-config.yaml`
- `infra/compose/.env.example` (the `GREPTIME_*` block)
- `apps/api/src/telemetry/` (settings, status, retention, explorer, assistant)
- `apps/cli/src/deploy/compose-files.ts`, `env-metadata.ts` (the `observability` group)

**Telemetry ships off.** A fresh deployment has `telemetry.enabled: false`
and no telemetry overlay running; nothing in this codebase turns it on by
itself.

---

## 1. Before you start

- **Know which environment you are enabling this in.** Development uses
  `infra/compose/telemetry.compose.yml` directly; a VPS deployment opts in
  through the `observability` group at install time (or a later
  `appctl deploy update --group observability`).
- **You need `telemetry:write`** to change the policy, `telemetry:read` to
  view it, and `telemetry:query` to use the explorer or the assistant. All
  three are Admin-only by default.
- **Decide your retention before the first run.** `retentionDays` (1–3650,
  default 30) is applied as a database-level TTL; changing it later is cheap
  (§5), but it is worth choosing deliberately for a deployment that expects
  real load.
- **The AI assistant needs the AI platform on.** If you plan to configure it
  (§6), have AI enabled and at least one provider/model available first —
  see [ai-configuration.md](ai-configuration.md).

## 2. Enable the overlay

### 2.1 Development

From `infra/compose`:

```bash
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml \
  -f telemetry.compose.yml up
```

This starts `otel-collector` and `greptimedb` alongside the usual stack, and
sets `OTEL_ENABLED=true` on the `api` service (switch 1 of 2 — see the
spec's §2). Before running it, set the `GREPTIME_*` passwords in
`infra/compose/.env` (§3) — compose refuses to start `greptimedb` or
`otel-collector` if any `GREPTIME_*_PASSWORD` is empty, naming the missing
key.

- GreptimeDB HTTP API / SQL dashboard: http://localhost:14000/dashboard
- GreptimeDB PostgreSQL wire protocol: `localhost:14003` (`psql`, BI tools)
- Collector OTLP: `localhost:4327` (gRPC), `localhost:4328` (HTTP)

### 2.2 VPS deployment

The telemetry overlay is the `observability` group. On a fresh install:

```bash
appctl deploy install --domain app.example.com --group observability
```

On an existing deployment, add it later:

```bash
appctl deploy update --group observability
```

The environment wizard then prompts for the `GREPTIME_*` keys (§3).
`apps/cli/src/deploy/compose-files.ts` adds `telemetry.compose.yml` and
`vps.telemetry.compose.yml` to the compose invocation whenever the
`observability` group is recorded for the deployment — every subsequent
`update`/`status`/`uninstall` picks it up automatically, with no flag to
repeat. On a VPS, GreptimeDB's Postgres wire port is published on
**`127.0.0.1:${GREPTIME_BIND_PG_PORT}` only** (default `14003`); nothing
about the telemetry store is reachable from outside the host. See
[deploy-to-vps.md](deploy-to-vps.md) for the rest of the install/update flow.

## 3. Set the GreptimeDB passwords

Three accounts, in `infra/compose/.env` (or supplied to the VPS wizard):

| Variable | Used by | Privilege |
|---|---|---|
| `GREPTIME_WRITER_USER`/`PASSWORD` | the collector, to ingest | write-only |
| `GREPTIME_READER_USER`/`PASSWORD` | the API — status, explorer, assistant; also BI tools | read-only |
| `GREPTIME_ADMIN_USER`/`PASSWORD` | the API, only to set retention | DDL (`ALTER DATABASE`) |

`.env.example` ships development placeholders (`change-me-writer`, etc.).
**Change all three before running the overlay anywhere reachable off your
own machine.** There is no compose-level default: an empty password fails
`docker compose up` outright rather than silently starting GreptimeDB with a
well-known credential.

## 4. Turn telemetry on

1. Sign in as an Admin and open **Admin → Settings → Observability →
   Telemetry** (`/admin/settings/telemetry`), or call the API directly:

   ```bash
   curl -sS -X PUT https://<your-deployment>/api/admin/telemetry/config \
     -H "Authorization: Bearer <admin access token>" \
     -H 'Content-Type: application/json' \
     -d '{"enabled": true, "retentionDays": 30,
          "query": {"maxRows": 10000, "timeoutSeconds": 30},
          "assistant": {"enabled": false, "provider": null, "modelId": null,
                        "shareResults": true, "maxResultRowsToModel": 100, "maxSteps": 6}}'
   ```

2. This takes effect on the instance that served the request immediately,
   and on every other instance in a fleet within about five seconds (the
   settings cache and the export gate both refresh on that interval — see
   [the spec, §2](../specs/telemetry.md#2-the-two-switches)).
3. The save also enqueues a `telemetry.retention.apply` job, so the
   retention you chose reaches GreptimeDB right away rather than at the next
   nightly run.

## 5. Set retention

Change `retentionDays` (1–3650) the same way — a `PUT` with just that field:

```bash
curl -sS -X PUT https://<your-deployment>/api/admin/telemetry/config \
  -H "Authorization: Bearer <admin access token>" \
  -H 'Content-Type: application/json' \
  -d '{"retentionDays": 90}'
```

The change is applied as `ALTER DATABASE <db> SET 'ttl'='90d'` by the queued
job, and re-asserted every night at 04:00 UTC regardless — so if GreptimeDB
was down when you saved, or its volume was later recreated, retention
self-heals on the next run without any action from you.

## 6. Configure the AI assistant

1. Confirm AI is enabled for the deployment (`/admin/settings/ai`) and at
   least one provider/model is available.
2. In the telemetry policy, set `assistant.enabled: true` and pick
   `assistant.provider`/`assistant.modelId` (both `null` clears them back to
   "not configured"). Optionally adjust `assistant.shareResults`,
   `assistant.maxResultRowsToModel` (≤ 100) and `assistant.maxSteps` (≤ 12).
3. The assistant spends the asking user's own AI key, or the organisation
   key, per the deployment's key policy — nothing further to configure per
   user.
4. Try it from the explorer's assistant drawer (`/admin/settings/telemetry
   /explorer`), or `POST /api/admin/telemetry/assistant/stream` directly.
   `telemetry:query` and `ai:use` are both required.

## 7. Verify

1. **Status card.** `GET /api/admin/telemetry/status` (or the settings page)
   reports `configured: true`, `reachable: true`, a `version` string, the
   `ttl` currently in force, and the store's tables with row estimates. This
   endpoint always answers `200` — an unreachable store shows up as fields,
   not an error — so a `configured: false` or `reachable: false` here is the
   first thing to read on any problem below.
2. **A starter query.** Open the explorer and run one of the starter
   queries (or `SELECT count(*) FROM opentelemetry_traces` if the app has
   served any traffic since telemetry was enabled). An empty result with no
   error usually means the gate has not opened yet — wait a few seconds and
   retry, or see §9.
3. **The assistant**, if configured: ask it a simple question ("how many
   requests failed in the last hour?") and confirm you get a `step` stream
   ending in an `answer` event with a `sql` and `explanation`.

## 8. Rotate GreptimeDB passwords

1. Pick new values for the accounts you are rotating (§3 lists them).
2. Edit `infra/compose/.env` (or the VPS deployment's `.env`) with the new
   `GREPTIME_*_PASSWORD` values. Rotate the reader and admin passwords
   together with the writer's if you are doing a full rotation — GreptimeDB
   is reconfigured from the same `--user-provider` flag on every restart, so
   a stale password left in `.env` for one role locks that role out.
3. Recreate the affected containers so they pick up the new environment:

   ```bash
   docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml \
     -f telemetry.compose.yml up -d --force-recreate greptimedb otel-collector api
   ```

   (On a VPS, use the equivalent `-f` set from `appctl deploy update`, or run
   `appctl deploy update` after editing `.env` so it recreates the right
   services for you.)
4. GreptimeDB reads its accounts from `--user-provider` at startup, so the
   old passwords stop working the moment it restarts. Re-check status (§7)
   afterward: a wrong password on the reader or admin connection shows up as
   `reachable: false` with the driver's authentication error in `error`.
5. If you use a BI tool over the SSH tunnel (§9), update its stored
   credential to the new reader password.

## 9. Connect a BI tool over SSH

GreptimeDB's Postgres wire port is never published on a public interface.
Reach it through a tunnel:

```bash
ssh -L 14003:127.0.0.1:14003 <user>@<your-vps-host>
```

(Use the deployment's actual `GREPTIME_BIND_PG_PORT` if it was changed from
the default `14003` — for example, because more than one deployment shares
the host.) Then point your tool at:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `14003` (or your tunnel's local port) |
| Database | `public` (or the deployment's `GREPTIME_DB`) |
| User | `GREPTIME_READER_USER`'s value |
| Password | `GREPTIME_READER_PASSWORD`'s value |
| SSL | off (the tunnel already encrypts the hop) |

Notes per tool:

- **Power BI.** Use the PostgreSQL connector. Prefer **Import** mode: a
  telemetry query result is a snapshot in time and GreptimeDB is not tuned
  for a report that re-queries live on every filter change.
  **DirectQuery** works but re-runs your SQL per interaction, so keep the
  underlying query narrow (a time-bounded view, not a raw table scan) and
  expect it to compete with `telemetry.query.timeoutSeconds` if it is slow.
- **Excel.** Data → Get Data → From Database → From PostgreSQL Database
  (Power Query), same connection fields.
- **DBeaver.** New PostgreSQL connection with the fields above; GreptimeDB's
  own SQL dialect (Apache DataFusion SQL, PostgreSQL-flavoured) mostly reads
  as ordinary SQL, but see the spec's spike findings for what differs
  (no bind parameters, flattened attribute columns need double quotes).
- The tunnel must stay open for the tool's session; a tool that reconnects
  automatically (most BI schedulers) needs the tunnel kept alive the same
  way, for example with `autossh` or a systemd unit wrapping the `ssh -L`
  command above.

The reader account can only `SELECT`/`SHOW`/`DESCRIBE` and read
`information_schema` — GreptimeDB itself refuses everything else for it, so
a BI tool cannot write to or alter the telemetry store no matter what it is
configured to do.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status reports `configured: false` | The telemetry overlay is not deployed, or `GREPTIME_HOST`/`GREPTIME_READER_*` are unset on the API | Add the overlay (§2) and confirm the `GREPTIME_*` variables reached the `api` service's environment |
| Status reports `configured: true`, `reachable: false` | GreptimeDB is down, still starting, or a password is wrong | Check `docker compose ps greptimedb` and its logs; re-check the reader/admin passwords (§8) |
| Explorer/assistant answer `TELEMETRY_NOT_CONFIGURED` (503) | Same as above, surfaced through the API | Same as above |
| Explorer/assistant answer `TELEMETRY_DISABLED` (409) | `telemetry.enabled` is `false` | Turn it on (§4); allow up to five seconds to take effect everywhere |
| `retentionDays` change does not seem applied | The `telemetry.retention.apply` job failed, or `GREPTIME_ADMIN_USER`/`PASSWORD` are not set | Check the job queue (`/admin/settings/jobs`) for a failed run; without an admin credential the job is a deliberate no-op — set one (§3) |
| Tables appear empty even though the app is being used | The export gate is still closed: `telemetry.enabled` was just turned on, or `OTEL_ENABLED` is not set on the `api` service | Wait a few seconds for the gate to open (§4); confirm `OTEL_ENABLED=true` is present on `api` (the overlay sets it, but a custom compose override can drop it) |
| A query or the assistant returns `TELEMETRY_QUERY_TIMEOUT` (504) | The statement outran `telemetry.query.timeoutSeconds` | Narrow the query (add a time filter, reduce the row cap) or raise the setting (≤ 120 s), then retry |
| The nginx assistant route hangs or drops mid-stream | A proxy in front of nginx is buffering the response | Confirm the deployment's own reverse proxy (in front of nginx, on a VPS) does not buffer `/api/admin/telemetry/assistant/stream`; nginx itself already forwards it unbuffered |

## 11. Summary checklist

**First enable**

- [ ] `GREPTIME_*` passwords set to real values, not the `.env.example` placeholders
- [ ] Overlay running (dev: `telemetry.compose.yml`; VPS: `observability` group)
- [ ] `GET /api/admin/telemetry/status` reports `configured: true`, `reachable: true`
- [ ] `telemetry.enabled` turned on; retention set deliberately
- [ ] A starter query in the explorer returns rows
- [ ] (Optional) assistant configured and answers a test question

**Password rotation**

- [ ] New passwords written to `.env`
- [ ] `greptimedb`, `otel-collector` and `api` recreated
- [ ] Status re-checked; `reachable: true` with the new credentials
- [ ] Any BI tool's stored credential updated

## See also

- [Telemetry spec](../specs/telemetry.md) — architecture, the two switches, security model
- [Deploy to a VPS](deploy-to-vps.md) — installing and updating a deployment, including `--group observability`
- [AI configuration](ai-configuration.md) — enabling AI before configuring the assistant
