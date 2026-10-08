# User Data Reset, Factory Reset and Organization Offboarding

> **Status:** shipped (#743, PP-9.1) · **Code:** `packages/platform-api/src/user-data/`, `packages/platform-web/src/user-data/`, `packages/platform-contract/src/user-data/`; reference app binding `apps/api/src/platform/user-data/` · **API:** `/api/user-data/*`, `/api/admin/factory-reset/*`, `/api/admin/orgs/:orgId/offboarding/*` (see `/api/docs`) · **UI:** `/settings/danger-zone`, `/admin/settings/factory-reset`, the Offboard action of `/admin/settings/organizations` · **Runbook:** [factory-reset.md](../runbooks/factory-reset.md)

Three destructive flows on one decision table. A user deletes what they own and keeps their account; an administrator returns the deployment to a fresh install; an operator of a multi-organization deployment deletes one organization. Merged from EvoPath's `user-data-reset.md` and `factory-reset.md` and kvox's `user-data-deletion.md`.

## 1. Purpose

- **Is:** a registry-driven "delete my data" with scopes (kvox's narrow scopes, EvoPath's single `everything`), a deployment-wide factory reset, and organization offboarding ("export, then purge the org", [platform-packages.md](platform-packages.md)).
- **Is not:** account deletion (no app ships it; the `User` row stays), a restore, or the data export ([data-export.md](data-export.md), #744; its `org-data` export is the offboarding precondition).
- **Why:** both source apps hand-maintained the keep-or-delete decision for every model (EvoPath's `user-data-purge.ts`, about 25 tables, "no test discovers a new model, so the decision is manual"; kvox's `scopeIncludes()`). A forker either left data behind or failed on a foreign key. Here the decision is registry data, the order is computed, and a conformance suite fails when a model with an owner column has no decision.

## 2. How it works

### 2.1 The decision table

| Layer | Where | Says |
|---|---|---|
| Ownership | `userOwnedModelRegistry` (`core`, #688/#699) | which models hold a user's rows (`ownerField`) |
| Model hint | `registerUserDataModels` | `keep` (with the reason) or the `category` the rows are deleted in, plus `storageObjectColumns`, `keepWhenReferenced`, `delegate`, `storageObjects`, `factoryReset` |
| Category | `registerUserDataCategory` | a unit the Danger Zone counts; `content: false` for credentials and settings; `clearUserFields` (the `settings` category clears `User.displayName` and `profileImageUrl`) |
| Scope | `registerUserDataScope` | the categories one request deletes, its exact phrase, its layer (`specific` or `danger`) |

Built-in scopes: `everything` (all categories, `DELETE MY DATA`) and `content` (categories with `content: true`, `DELETE MY CONTENT`). Re-registering a built-in id needs `overrideBuiltIn: true` (kvox's `content` with phrase `CONTENT`); never silent. Scope ids are permanent once a job carried one.

Platform categories and decisions:

| Category | Models | Content |
|---|---|:-:|
| `files` | `StorageObject` (bytes and rows) | yes |
| `notifications` | `Notification`, `NotificationDelivery`, `PushSubscription` | yes |
| `ai` | `AiRun`, `AiUsageEvent`, `UserAiKey` | yes |
| `credentials` | `PersonalAccessToken`, `DeviceCode`, `UserCredential` | no |
| `settings` | `UserSettings`; clears `displayName`, `profileImageUrl` | no |
| `other` | any owner model without a hint (run time); the conformance suite still demands a hint | yes |

Kept by every data reset: `User`, `UserIdentity`, `UserRole`, `RefreshToken` (the session survives), `AllowedEmail`, `AuditEvent`, `Membership`, `GroupMember`, `Grant`, `WorkerNode`, `NodeCredential`, and every deployment model (system settings, credentials, AI models, broadcasts, backup runs). The kept list is asserted by `user-data-purge.db.spec.ts`, derived from the registry.

### 2.2 The delete order

The purge planner reads the composed Prisma schema (`readSchemaDatamodel`; Prisma 7's generated `Prisma.dmmf` carries no `onDelete`) and orders the models of a purge so that, for every relation between two of them whose `onDelete` is `Cascade`, `Restrict` or `NoAction`, the child goes first. `Restrict`/`NoAction`: the parent cannot go first. `Cascade`: a child taken by the cascade would go uncounted (EvoPath's activity entries before workouts). `SetNull` constrains nothing. Ties break by model name. A nullable self-restrict (a revision chain) is unlinked first; a cycle or a required self-restrict throws `UserDataPlanError` at bootstrap, naming the models. This replaces the hand-ordered `deleteUserOwnedRows`.

### 2.3 Per-user deletion (`user.data.purge`)

1. `GET /api/user-data/summary` lists the categories with the caller's counts (and bytes for files) and the scopes with their phrases.
2. `POST /api/user-data/deletions { scope, confirmation }` checks the scope (`400 UNKNOWN_SCOPE`) and the phrase as a zod literal (`400 CONFIRMATION_MISMATCH`), enqueues `user.data.purge` (subject `user:<userId>`, payload `{ userId, scope }`, `orgId: null`) and audits `user_data.purge.requested`. The queue's active dedup (`jobs_active_dedup_uniq_idx`) gives one pending or running purge per user: a second request returns the job in flight (with its own scope). There is no `findFirst` pre-check.
3. The job, on the bypass client (row-level security must not hide a user's rows in another organization):
   1. **Collect** every storage object id the included categories reach (the user's own objects, the `storageObjectColumns`) into `payload.objectIds`, unioned with an earlier attempt's, BEFORE the rows go;
   2. **Rows**, one transaction (5 minutes): pending jobs whose subject is a row about to go are deleted (never this one, never a running one), self-references unlinked, rows deleted in plan order (`keepWhenReferenced` adds `<backRelation>: { none: {} }` per back-relation), `User` columns cleared; the counts commit on `payload.deleted` in the same transaction, added to what an earlier attempt committed;
   3. **Delegates**: a delegated model's job is enqueued (subject `user:<userId>`; dedup makes a retry harmless);
   4. **Media**: bytes first (an unfinished multipart upload aborted), then the row; a provider failure keeps the row, is counted in `storageObjectsFailed`, logged, and never fails the job.
4. `payload.result` holds the counts per category and model; `user_data.purge.completed` closes the run. `GET /api/user-data/deletions/:jobId` answers `404` unless it is the caller's purge job.

A user's own rows are deleted in every organization they belong to. Org-owned rows without a user owner are never touched by a user purge.

### 2.4 Factory reset (`admin.factory_reset`)

Generalised from EvoPath's seven steps. Each is idempotent and commits on its own; counts commit with their rows.

| # | Step |
|---|---|
| 1 | Every non-running job except this one and the jobs `factoryReset.keepJobsReferencedBy` rows link to (the backups'), in chunks |
| 2 | The `everything` rows of every user, the actor included, one transaction per user |
| 3 | Registered `FactoryResetStep`s, phase `before-users` (EvoPath's custom catalog) |
| 4 | Worker nodes and node credentials move to the actor; a node whose name the actor already uses is deleted and counted `workerNodesRemoved` |
| 5 | Every `org` model's rows (except those hinted `factoryReset: 'keep'`: organization settings and credentials), then the user removal hooks and every user but the actor, in chunks |
| 6 | User-less rows of the purged owner models, then the `deployment` steps (the platform's: broadcasts, every device code, the job statistics rollup, the allowlist except the actor's entry) |
| 7 | Every storage object outside the prefixes the key-prefix registry marks `survivesFactoryReset` (`database-backups/`), bytes then row, paging forward by id |
| 8 | Every organization but the default one (a surviving object moves to the default organization first); the actor stays an `org_admin` member of the default one |

Kept: the actor and their session, roles and permissions, configuration, backups (runs, archives, linked jobs), the audit log, running jobs. `DEPLOYMENT_MODE=saas` disables it: `POST` and status routes answer `403 FACTORY_RESET_DISABLED_IN_SAAS`, the summary reports `disabledReason`, and the page says why. A SaaS operator offboards organizations instead.

### 2.5 Organization offboarding (`org.offboard`)

Multi-organization mode only (`409 OFFBOARDING_REQUIRES_MULTI_ORG` otherwise); the default organization is never offboarded (`409 DEFAULT_ORG_NOT_OFFBOARDABLE`). The phrase is the organization's slug. Every registered `OffboardingPrecondition` must pass unless `skipExport.reason` is given (`409 OFFBOARDING_PRECONDITION_FAILED` with `details.preconditions`); the reason and the skipped ids go in the audit `meta`.

The reference app registers `RECENT_ORG_EXPORT_PRECONDITION` ("export, then purge", [data-export.md](data-export.md)): an `export.run` job of the organization, `succeeded`, finished in the last 7 days (the export file's retention), whose payload names the `org-data` source and carries a committed result. An app without the exports slice does not register it. The offboarding deletes the organization's export files too (`exports/orgs/<orgId>/`), so download the export before confirming.

1. Pending jobs with this `org_id` (except this one);
2. The members left with no other membership are recorded on the payload (once);
3. Every `org` model's rows of the organization, in plan order, one transaction per model;
4. The organization's storage objects: bytes, then the row. A kept object fails the job after the step, because the organization row cannot go while an object references it; the queue retries;
5. Invites and memberships (`OrgCredential`, org-bound sessions and tokens cascade with the organization);
6. The recorded users: `keep` (default; they cannot sign in until invited) or `purge` (their `everything` purge, the removal hooks, then the user row);
7. The organization row.

### 2.6 Retry safety

EvoPath's rules, unchanged: every delete is a `deleteMany` by condition; counts commit with the rows they count and are read back and added to; object ids are collected first and unioned; a storage failure keeps the row; running jobs are never cancelled; the raw-SQL partial unique indexes are relieved by these deletes and never touched.

### 2.7 Confirmation UX

- User Danger Zone (`UserDangerZonePage`): what the user owns (live counts), what is always kept, then the `specific` scopes as rows with counts (disabled at zero), a divider and an error-coloured heading, then the `danger` scopes.
- Factory reset (`FactoryResetPage`): an error-bordered warning, the backup-first link to `/admin/settings/db-backup`, live counts, the static deleted and kept lists.
- Every action opens `TypedConfirmDialog`: acknowledgement checkbox plus the exact phrase; non-dismissable while the job runs; on success the non-zero counts and a warning when stored files were kept, and the page's `onCompleted` (the app refreshes its cached user); on failure the error and a retry. The static lists render even if the summary fails.

## 3. Configuration and permissions

No environment variable and no settings key. `UserDataModule.forRoot({ datamodel, imports, legacyJobTypes?, userRemovalHooks?, factoryReset?: { keepJobsReferencedBy }, txTimeoutMs? })`; options in the [package README](../../packages/platform-api/src/user-data/README.md#configuration).

| Item | Value |
|---|---|
| Permissions | `user_settings:write` (every role) on `/api/user-data/*`; `system:factory_reset` (system, Admin only) on `/api/admin/factory-reset/*`; `orgs:offboard` (system, Admin only) on the offboarding routes. `system:factory_reset` is never implied by `system_settings:write` |
| Cards | `Delete my data`: no `permission`, no `feature` (reachable while AI is off). `Factory reset`: `permission: 'system:factory_reset'`. Both in a `Danger Zone` group pinned last ([settings-ui.md](settings-ui.md)) |
| Job types | `user.data.purge` (15 min, 3), `admin.factory_reset` (30 min, 3), `org.offboard` (60 min, 3); permanent, server-only |
| Audit | `user_data.purge.requested`/`.completed`, `admin.factory_reset.requested`/`.completed`, `org.offboard.requested`/`.completed` |
| Metrics | `app.user_data.purges` (`scope`, `outcome`), `app.factory_reset.runs` (`outcome`), `app.org.offboardings` (`outcome`, `user_disposition`); never a user or org id |

## 4. Extending it in an app

**When you add a model with an owner column, give it a hint.** The hint replaces "edit `user-data-purge.ts`".

1. Register the model in the user-owned registry (`app-registrations/user-owned-models.ts`), as before.
2. Decide: the user's own data (a `category`, existing or new) or account, access, audit or deployment state (`keep: '<why>'`), in `app-registrations/user-data.ts` (`APP_USER_DATA_MODELS`).
3. A column naming a storage object: `storageObjectColumns: ['photoObjectId']`. A shared catalog row another user may still use: `keepWhenReferenced: true`. Rows another job purges: `delegate: { jobType, payload }`.
4. A narrow deletion: a category plus a scope with `layer: 'specific'` (`APP_USER_DATA_SCOPES`).
5. Deployment-level rows with no owner: a `FactoryResetStep` (`APP_FACTORY_RESET_STEPS`). A check before offboarding: an `OffboardingPrecondition`.
6. Run the conformance suite (`test/user-data/user-data-conformance.spec.ts`) and extend a `*.db.spec.ts` with a row of the new model.
7. An app adopting the platform with its own pre-platform job type passes it in `legacyJobTypes` (EvoPath: `{ type: 'user.data_reset', toPayload: (old) => ({ userId: old.userId, scope: 'everything' }) }`).

Adoption map:

| App | Calls |
|---|---|
| EvoPath | hints for its ~25 domain models with `category`, `storageObjectColumns` (photos, documents, voice notes) and `keepWhenReferenced` (custom exercises and equipment); `registerFactoryResetStep({ id: 'custom-catalog', phase: 'before-users' })`; `legacyJobTypes` for `user.data_reset`; the `everything` scope only |
| kvox | categories `transcripts`, `notes`, `noteTemplates`, `graph`, `ask`, `onboarding`; scopes `transcripts`, `notes`, `files`, `content` (`overrideBuiltIn`) with `confirmation: scope.toUpperCase()`; `delegate` hints for `kg.purge`, `transcript.purge`, `note.purge`; the job type and route already match |
| MemoriaHub | hints for its models; the default scopes |

Worked, tested examples of every extension point: `apps/api/src/examples/user-data/`.

## 5. Guardrails

- `packages/platform-api/test/user-data/`: the planner (order, ties, cascade-before-parent, cycles, self-restrict), scopes and built-in overrides, the purge flows (collect first, pending-job cleanup, kept rows, storage tolerance, retry accumulation, delegates, the legacy alias, removal hooks), the factory reset and offboarding steps, the services (phrase literals, saas gate, single-mode and default-org 409s, preconditions), the handler contracts (types, profiles, server-only).
- `apps/api/test/user-data/*.db.spec.ts` on a database owned by an ordinary role (row-level security live): `user-data-purge` (foreign keys hold, kept list, other users intact, both organizations), `factory-reset` (full run, re-run, resume after a partial run, backups kept), `org-offboard` (two organizations, only one purged).
- `apps/api/test/user-data/user-data.integration.spec.ts`: 401, 403, 400 phrase, 202 and dedup, 404 foreign job, the saas gate, the single-mode 409, the exact permission on every route.
- `apps/api/test/user-data/user-data-conformance.spec.ts`: the `user-data` suite (every owner model decided and reachable by `everything`, hints and scopes valid, an order exists).
- `apps/web/src/__tests__/config/settingsCards.test.ts`: both Danger Zone groups last (`dangerZoneLastViolations`), the exact card permissions. `packages/platform-web/test/user-data/`: the dialog gates, the two pages, offboarding.
- `apps/api/test/jobs/job-type-snapshot.spec.ts`, `cron-enqueue-only.spec.ts` (no `@Cron` is added) and `test/tenancy/system-injection-boundary.spec.ts` (the bypass-client adapter is allowlisted).

## 6. Design decisions

- **Registry hints, not a hand list.** The hand list is the root cause the platform spec names. Rejected: porting `user-data-purge.ts` as is.
- **The order from the schema, not from the code.** A new `Restrict` edge reorders the purge by itself; a cycle fails at startup instead of halfway through a user's purge. Rejected: relying on `ON DELETE CASCADE` from `User`, which misses `Restrict` edges and `SetNull` user data, and the reset keeps the `User` row anyway.
- **Scopes are a registry.** kvox's narrow scopes are a real need and cost EvoPath nothing. Rejected: one scope only.
- **Offboarding is its own job.** A factory reset is deployment-wide by definition; offboarding needs preconditions and a user disposition. Rejected: a factory reset filtered by organization.
- **The bypass client for every statement**, with explicit owner or organization filters: a tenant client would silently delete one organization's rows and report success.
- **Keep the session, revoke tokens.** The user reads the result; a CLI with a `pat_` token gets `401`. **Keep the audit log.** **Never cancel running jobs**: handlers tolerate vanished rows.
- **Phrases in the API, as zod literals**: a `curl` caller and a browser get the same guarantee.
- **Group memberships are removed only with the user row** (the sharing slice's last-admin rule runs as a removal hook): a data reset keeps access state, like organization memberships.

## 7. Verification

```bash
npx jest --config packages/platform-api/test/jest.config.js --rootDir packages/platform-api test/user-data
npm run test:db --workspace=api -- user-data
npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/user-data
npm run test:run --workspace=web -- settingsRegistry userSettingsSections
```

Then, on a throwaway deployment: open `/settings/danger-zone`, confirm the button stays disabled until the checkbox is ticked and the phrase typed exactly, and that `/api/user-data/summary` returns zeros afterwards while the session stays valid.

## History

- #743 (PP-9.1): the slice, harvested from EvoPath (#202, #211) and kvox.
