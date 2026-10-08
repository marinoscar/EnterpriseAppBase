# Runbook: Factory Reset a Deployment, Offboard an Organization

Operator procedures for the two deployment-level destructive flows of the user-data slice ([spec](../specs/user-data-reset.md)). Both are queue jobs, both are irreversible, and both refuse a wrong typed phrase.

## Before you start

- You need `system:factory_reset` (factory reset) or `orgs:offboard` (offboarding). Both are granted to the Admin role only.
- **Take a database backup first.** It is the only way back. Open `/admin/settings/db-backup`, run a backup and wait for it to complete. The factory reset keeps backup runs, their archives (`database-backups/`) and their jobs, so the backup survives the reset it protects against.
- The factory reset is disabled in `DEPLOYMENT_MODE=saas` (`403 FACTORY_RESET_DISABLED_IN_SAAS`). Offboard organizations instead.
- Offboarding needs `TENANCY_MODE=multi`; the default organization can never be offboarded.

## Factory reset

1. Open `/admin/settings/factory-reset` (the last card of the admin settings hub, group **Danger Zone**).
2. Read the counts: other users, organizations other than the default one, stored files outside the surviving prefixes, job rows, rows per data category.
3. Click **Factory reset**, tick the acknowledgement, type `FACTORY RESET` exactly, confirm. The dialog stays open until the job finishes.
4. From a shell instead:

   ```bash
   curl -X POST "$APP_URL/api/admin/factory-reset" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"confirmation":"FACTORY RESET"}'
   curl "$APP_URL/api/admin/factory-reset/<jobId>" -H "Authorization: Bearer $TOKEN"
   ```

   A second request while one is pending or running returns the same job.

What it does, in order: deletes job history (not running jobs, not this job, not backup jobs), every user's data, app-registered `before-users` steps, reassigns worker nodes to you (a node whose name you already use is removed), deletes organization data and every other user, the deployment leftovers (broadcasts, device codes, the job rollup, the allowlist except your entry), every stored file outside the surviving prefixes, and every organization except the default one (you stay its `org_admin`).

Consequences to announce: every personal access token stops working (`401`), device logins in flight are lost, and other people need a new allowlist entry to sign in.

## Verify

- `GET /api/admin/factory-reset/summary` returns zero users and organizations, zero storage objects and zero rows per category.
- `GET /api/admin/factory-reset/<jobId>`: `status` is `succeeded`; `result.counts.storageObjectsFailed` is `0`.
- You are still signed in; `/admin/settings/db-backup` still lists your backups.
- The audit log (`audit_events`) holds `admin.factory_reset.requested` and `admin.factory_reset.completed`.

## Recover

- **`storageObjectsFailed` above zero**: the storage provider refused those deletes and their rows were kept. Fix the provider (credentials, bucket policy), then run the reset again: it deletes what is left and nothing else.
- **The job failed**: read `error` from the status route (also `jobs.last_error`). Every step is idempotent and its counts committed with its rows, so the queue's retries (3 attempts) resume where it stopped. After the last attempt, fix the cause and request the reset again.
- **The reset was a mistake**: restore the backup you took ([database restore](../specs/database-restore.md)). Stored files deleted from the bucket are gone unless the bucket is versioned.

## Offboard an organization

1. Optionally export the organization's data first (the data export slice registers a precondition: "an export completed in the last 7 days").
2. Open `/admin/settings/organizations`, find the organization, click **Offboard**.
3. Read what goes (rows per model, members, invitations, stored files) and how many members are left without any organization. Choose:
   - **Keep their accounts** (default): they remain and cannot sign in until invited somewhere;
   - **Delete their data and their accounts**: their own data everywhere and the user rows go.
4. If a precondition fails, the dialog shows why; going ahead needs a reason, recorded in the audit event (`skipExport.reason`).
5. Tick the acknowledgement and type the organization's **slug**, then confirm.

From a shell:

```bash
curl -X POST "$APP_URL/api/admin/orgs/<orgId>/offboarding" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"confirmation":"<slug>","userDisposition":"keep"}'
curl "$APP_URL/api/admin/orgs/<orgId>/offboarding/<jobId>" -H "Authorization: Bearer $TOKEN"
```

Verify: the organization is gone from the list; `result.counts` lists the rows, memberships and invitations deleted; the audit log holds `org.offboard.requested` and `org.offboard.completed` with the `orgId`.

Recover: a job that fails with "storage object(s) could not be deleted" keeps the organization on purpose (its objects still reference it). Fix the provider; the queue retries and finishes the media, then the organization. A mistaken offboarding needs a database restore.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `400` on the request | The phrase is not exact | Type it exactly, case and spacing included (`FACTORY RESET`, or the slug) |
| `403 FACTORY_RESET_DISABLED_IN_SAAS` | `DEPLOYMENT_MODE=saas` | Offboard organizations instead |
| `403` without a code | The caller lacks the permission | Use an Admin account |
| `409 OFFBOARDING_REQUIRES_MULTI_ORG` | `TENANCY_MODE=single` | Offboarding exists only in multi-organization mode |
| `409 DEFAULT_ORG_NOT_OFFBOARDABLE` | The default organization | It can never be offboarded |
| `409 OFFBOARDING_PRECONDITION_FAILED` | A precondition failed (`details.preconditions`) | Meet it (take the export) or give `skipExport.reason` |
| The API fails to start with `UserDataPlanError` | A cycle in the delete order, or a hint naming an unknown category | See the [package README](../../packages/platform-api/src/user-data/README.md#troubleshooting) |
