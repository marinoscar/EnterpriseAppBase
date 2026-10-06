# Data retention

This runbook lists every control that deletes old data in a deployment, and shows how to change one. Use it to answer "how long do we keep X?", to shorten or lengthen a window, or to turn audit-log retention on.

Every control below is a system setting, changed at runtime through `PATCH /api/system-settings` (permission `system_settings:write`). None has an environment variable. Each one is enforced by a background job that a scheduled `@Cron` only enqueues, so every run appears in the admin job list (`/admin/settings/jobs`) with its own retries and its own failure.

## Every retention control

| Setting | Default | What it deletes | Job type | Schedule |
|---|---|---|---|---|
| `retention.notifications` | on, 180 days | In-app inbox rows (`notifications`) older than the window, read or unread | `notifications.inbox.purge` | Daily, 01:00 |
| `retention.notificationDeliveries` | on, 90 days | Delivery log rows (`notification_deliveries`) older than the window, `sent` or `failed` only. A `queued` row is never deleted. | `notifications.deliveries.purge` | Daily, 01:00 |
| `retention.auditEvents` | **off**, 365 days | Audit log rows (`audit_events`) older than the window | `audit.events.purge` | Daily, 01:00 (only while on) |
| `retention.aiRuns` | on, 90 days | Background AI runs (`ai_runs`, including the stored prompt) older than the window, `succeeded`, `failed` or `cancelled` only. A `pending` or `running` run is never deleted. | `ai.runs.purge` | Daily, 01:00 |
| `jobs.history` (`retentionDays`, `purgeEnabled`) | on, 30 days | Finished jobs (`jobs`), after folding them into `job_stats_rollup`. Pending and running jobs are never deleted. | `job.history.purge` | Daily, midnight |
| `ai.usageRetentionDays` | 180 days | AI accounting rows (`ai_usage_events`) | `ai.usage.purge` | Daily, 05:00 |
| `nodes.offlineRetentionDays` | 30 days | Worker-node records offline longer than the window | `nodes.fleet.prune` | Daily, 03:00 |
| `databaseBackup.retentionCount` | 7 backups | Backup archives and their runs beyond the newest N (plus the pre-restore age rule) | `db.backup.sweep` | Every 10 minutes, with the backup scheduler |
| `telemetry.retentionDays` | 30 days | GreptimeDB data, through the database's TTL (telemetry itself ships off) | `telemetry.retention.apply` | Daily, 04:00, and after every telemetry settings save |

The four `retention.*` policies each take `{ "enabled": boolean, "days": 1–3650 }`. All times are the API server's local time (UTC in the shipped containers).

### How the `retention.*` purges run

- The 01:00 task (`apps/api/src/common/retention/retention-purge.task.ts`) reads the four policies and enqueues one low-priority job for each enabled one. It deletes nothing itself.
- Each job deletes in batches of at most 5000 rows, oldest first, by the exact ids it read. A run stops after 1000 batches (5 million rows) and logs a warning; the next night continues from the same cutoff.
- Each job re-reads its policy when it runs. A job for a disabled policy (an admin rerun, say) logs that it is a no-op and deletes nothing.
- Each run logs one summary line: rows deleted, cutoff, retention days, batches and job id.
- The AI run purge runs while AI is switched off. Retention is data hygiene, not AI use: it makes no provider call and reads no key.
- Deleting an AI run does not delete files the run produced (`ai-outputs/...`). Those are the user's storage objects, with their own lifecycle.

## Change a control

Send only the leaf you are changing. A PATCH merges field by field, so the other policies keep their values.

With `curl` (an admin access token in `$TOKEN`):

```bash
curl -X PATCH https://app.example.com/api/system-settings \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "retention": { "aiRuns": { "days": 30 } } }'
```

With `appctl` (signed in with `appctl login`):

```bash
appctl api PATCH /api/system-settings --data '{ "retention": { "notifications": { "enabled": false } } }'
appctl api GET /api/system-settings --raw | jq '.data.retention'
```

The other controls in the table work the same way, under their own namespace, for example `{ "jobs": { "history": { "retentionDays": 14 } } }` or `{ "ai": { "usageRetentionDays": 90 } }`.

A `days` value outside 1–3650, a fractional one, or a non-boolean `enabled` is rejected with `400` and nothing is stored. Send `If-Match: <version>` to make the write conditional (see [API.md](../API.md#optimistic-concurrency-if-match)).

A change applies at the next 01:00 run. To apply it sooner, retry the latest job of that type from the admin job list; it re-reads the policy when it runs.

There is no settings card for the `retention` namespace yet; until one ships, change it through the API as above.

## Upgrade note: old rows are deleted on the first night

Before this release, the inbox, the delivery log, the audit log and AI runs were kept forever. Three of the four new policies ship **enabled**. On the first 01:00 run after you upgrade, the purges delete every existing inbox row older than 180 days, every settled delivery record older than 90 days, and every finished AI run older than 90 days.

If you need that history, do one of these **before** upgrading, or before 01:00 on the day you upgrade:

- take a database backup, or
- after deploying, disable the policies you want to keep and re-enable them once you have exported what you need:

  ```bash
  appctl api PATCH /api/system-settings --data '{ "retention": {
    "notifications": { "enabled": false },
    "notificationDeliveries": { "enabled": false },
    "aiRuns": { "enabled": false } } }'
  ```

A large backlog is deleted over several nights if it exceeds 5 million rows per table.

## Why audit retention ships off

The audit log is a compliance record: who changed a setting, a role, the allowlist, an AI key. How long it must be kept is set by your organisation's policy or a regulator, not by this template, and deleting it cannot be undone. So `retention.auditEvents` ships disabled, and no audit row is ever deleted until an operator turns it on.

To turn it on, with the window your policy requires:

```bash
appctl api PATCH /api/system-settings --data '{ "retention": { "auditEvents": { "enabled": true, "days": 730 } } }'
```

The settings change itself is recorded in the audit log (`system_settings:patch`).

## Troubleshooting

| Symptom | Check |
|---|---|
| Old rows are still there | Is the policy enabled (`GET /api/system-settings`, `data.retention`)? Did a job of that type run at 01:00, and did it succeed? Its log line says how many rows it deleted and the cutoff it used. |
| A purge job logs "is disabled … is a no-op" | The policy was off when the job ran. Turn it on; the next run purges. |
| A purge logs "stopped at its 1000-batch safety limit" | More than 5 million rows were due. Nothing is wrong; the next run continues. |
| A purge job failed | It is retried up to three times. A database error is in the job's `lastError`. The next night's run starts again from the same cutoff. |

## Related

- [specs/job-queue.md](../specs/job-queue.md): how housekeeping jobs are enqueued and run
- [specs/ai-platform.md](../specs/ai-platform.md): `ai.runs.purge` and `ai.usage.purge`
- [specs/database-backup.md](../specs/database-backup.md): backup retention
- [runbooks/telemetry.md](telemetry.md): telemetry retention
