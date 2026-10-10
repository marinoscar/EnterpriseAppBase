# @marinoscar/platform-db

## 0.1.0-next.4

### Minor Changes

- deeb8b5: Add the notifications slice: `@marinoscar/platform-api/notifications` (`NotificationsModule.forRoot`, the event, channel and template registries with open channel ids and `registerNotificationChannel`, `NotificationsService` with org-aware policy, the `notifications` system namespace with an org layer that only tightens, runtime Web Push (VAPID) configuration on `SystemSettingsRowStore`, broadcasts with `targetOrgId` and the org-scoped `org_broadcasts:*` pair, the SSE stream on `NOTIFICATIONS_EVENT_BUS`, the email channel forwarding template attachments, the `notifications` conformance suite at `/notifications/testing`), `@Auth({ anyPermissions })` in the identity slice, a `SystemSettingsRowStore` row key that admits camelCase (`webPush`), `@marinoscar/platform-contract/notifications` (the wire shapes, `BROADCAST_CHUNK_SIZE`), `@marinoscar/platform-web/notifications/{headless,ui}` (`configureNotificationsWeb`, `NotificationProvider`, `usePushSubscriptionSync`, `NotificationBell` with slots, the banner and the four pages, the service-worker helpers `registerNotificationServiceWorkerHandlers`, `handlePushEvent`, `handleNotificationClick`, `handlePushSubscriptionChange`), any-of card permissions in the settings hub (`SettingsCardDef.permission: string | readonly string[]`, `cardPermissionGranted`), and the platform migration `0032_add_broadcast_target_org` (`notification_broadcasts.target_org_id`).
- da8a6f2: Add the `android-app` fragment (`AndroidAppRelease`, `sizeBytes` BigInt), `push_subscriptions.platform` and platform migration `0033_add_android_app` with the raw-SQL partial unique index `android_app_releases_one_current_uniq_idx` (listed in `raw-sql-indexes.json`) (#746).
- f9737d4: Jobs carry their organization (#734): `Job.orgId` (`jobs.org_id`, nullable, FK `organizations(id)` `ON DELETE SET NULL`; NULL is a deployment-wide system job) and `Organization.jobs` in the `jobs` fragment. Migration `0030_add_jobs_org_id` adds the column (metadata-only) and the foreign key (`NOT VALID`, then `VALIDATE`); `0031_add_jobs_org_id_status_index` builds `jobs_org_id_status_idx` `(org_id, status)` `CONCURRENTLY`, alone in its migration. No row-level security on `jobs`, and `jobs_active_dedup_uniq_idx` is unchanged.
- 10ac7be: Add `OrgCredential` (`org_credentials`) to the `credentials` fragment (#735): an organization's own encrypted credentials, addressed by `(org_id, purpose, name)`, cascading with the organization, the last editor kept as provenance (SetNull). Migration `0029_add_org_credentials` creates the table with the FORCEd `org_credentials_org_isolation` row-level-security policy (listed in `RLS_POLICIES`).
- 42151ac: Put `org_id` on the tenant-scoped tables and turn row-level security on (#725, platform migration `0025_org_scoped_rls`). `storage_objects`, `storage_object_chunks` and `ai_runs` get a NOT NULL `org_id` (foreign key `RESTRICT`), `ai_usage_events` a nullable one (`SET NULL`), `audit_events` a nullable one (`SET NULL`, no policy). The four `org` tables get `ENABLE` and `FORCE ROW LEVEL SECURITY` and a `<table>_org_isolation` policy keyed on the transaction-local `app.org_id` or `app.rls_bypass`; a chunk references its object through the composite key `(object_id, org_id)`. Existing rows are backfilled to the default organization (system audit actions and catalogue usage events keep NULL). The application role must be NOSUPERUSER NOBYPASSRLS or every policy is inert.

  `Organization` is now `// @extensible`. New: `RLS_POLICIES` (from the shipped `rls-policies.json`), `assertRlsPolicies`, `checkRlsPolicySources`, `scanRlsPolicies` and `checkRlsPolicies`; `platform db drift` asserts the policies against `pg_policies` and the forced flag against `pg_class` (the `rlsPolicies` list in `platform.lock` carries an app's own); `runDbConformance()` gains the policy tripwire. The manifest gains an optional `rls` flag (`platform db promote --rls --touches`), and `platform db baseline` stops with `RLS_OPT_IN_REQUIRED` before a migration flagged `rls` that sits above `--through` until the app passes `--allow-rls`; it also asserts the live policies up to `--through`.

- fc11b22: Add `OrgSettings` to the `settings` fragment and migration `0028_add_org_settings` (#733): one row per organization holding its settings overrides, with its own version, FORCEd row-level security and the `org_settings_org_isolation` policy (listed in `RLS_POLICIES`).
- b618459: Add `Organization`, `Membership` and `Invite` to the identity fragment (#721) and the nullable `org_id` columns on `refresh_tokens`, `personal_access_tokens` and `device_codes`, as platform migration `0023_add_organizations`. The migration backfills the default organization (slug `default`), one active membership per existing user and the default `org_id` on every existing credential row, and creates the raw-SQL partial unique index `organizations_default_uniq_idx` (exactly one default organization), now listed in `raw-sql-indexes.json`.

  `seedPlatform` (`@marinoscar/platform-db/seed`) gains an idempotent default-organization step: it creates the organization only when none is flagged default, found by `isDefault` rather than by slug. `PlatformSeedInput.defaultOrganization` is optional; `SeedPrisma` gains an `organization` delegate and `SeedSummary` a `defaultOrganizationCreated` field.

- 52eab37: Add the `Grant` model and platform migration `0027_add_grants` to the `sharing` fragment (#729): the `GrantGranteeKind` enum (`user`, `group`, `link`) and the `grants` table, a polymorphic `(resource_type, resource_id)` share with a role, an optional expiry and a soft revocation, the link columns #730 needs, a NOT NULL `org_id` under a forced `grants_org_isolation` policy, and a composite `(grantee_group_id, org_id)` key so a grant can never name another organization's group. The raw-SQL partial unique indexes `grants_active_user_uniq_idx` and `grants_active_group_uniq_idx` allow one active grant per resource and grantee, and `grants_grantee_consistency_check` keeps the grantee columns consistent with the kind; `RAW_SQL_INDEXES` and `RLS_POLICIES` list them.
- 1404a97: Add the `sharing` fragment and platform migration `0026_add_groups` (#728): the `GroupRole` enum and the `Group` (`// @extensible`), `GroupMember` and `GroupInvite` models (tables `groups`, `group_members`, `group_invites`), each with a NOT NULL `org_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY` and a `<table>_org_isolation` policy. Members and invites reach their group through the composite key `(group_id, org_id)` -> `groups (id, org_id)`, so a row can never name another organization's group. The raw-SQL partial unique index `group_invites_pending_uniq_idx` allows one pending invite per group and address; `RAW_SQL_INDEXES` and `RLS_POLICIES` list the new index and the three policies.
- 7f175f0: Split RBAC into system roles and org roles (#723), as platform migration `0024_split_system_org_roles`. The identity fragment gains the `RoleScope` enum (`system`, `org`), `Role.scope` and `Permission.scope` (default `system`), `Membership.roleId` (required, `onDelete: Restrict`) and `Invite.roleId` (nullable: NULL means the default org role). The migration creates the `org_admin` role, scopes `contributor`, `viewer` and the org permissions to `org`, moves the `admin` role's org-permission grants to `org_admin`, sets every membership's role from the user's global roles (`admin` to `org_admin`, else the highest of `contributor` and `viewer`, else `viewer`) and deletes the `user_roles` rows of org-scoped roles.

  `seedPlatform` writes and refreshes the `scope` of a role or permission entry that declares one; `SeedNamedEntry` gains an optional `scope` and the package exports `SeedScope`.

- 74c4aff: Declare peer dependencies per slice (`packages/platform-slice-peers.json`, checked by `npm run check:slice-peers`) and make every peer that the universal slice does not need optional. `platform-api` now requires only what `core` needs (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `@opentelemetry/api`, `@prisma/client`, `nestjs-zod`, `reflect-metadata`, `rxjs`, `zod`); `@nestjs/config`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/terminus` and `@prisma/client-runtime-utils` become optional peers an app installs for the slices that use them. `platform-web` requires only `@mui/material`, Emotion, `react` and `react-dom`; `@mui/icons-material`, `react-router-dom` and `zod` become optional. `platform-db` no longer lists `@prisma/client` (its seed takes the app's client structurally) and `prisma` becomes optional; `platform-cli`'s `react` becomes optional. An app that installed every peer needs no change; an app that imports only some slices can now install only their peers. The datatable no longer imports the undeclared transitive `@mui/utils`.

### Patch Changes

- f6e319b: Documentation only: every slice README's Extension-point catalog links the new extension author guide (`docs/EXTENDING.md`); the email README no longer promises that a provider of `SmtpEmailProvider` in the app module replaces the transport (it does not reach the package's consumers; a transport registry is not supported yet); the AI READMEs say that a provider cannot be enabled from an app yet; the platform-db README documents `rlsPolicies` in `platform.lock` with the migration SQL for an app table protected by row-level security.
- fe73d7a: Documentation only: the overview READMEs list every shipped slice and subpath, and the stale "version 0.0.0" status lines are replaced.

## 0.1.0-next.3

## 0.1.0-next.2

### Minor Changes

- c91cf7b: Add the `@marinoscar/platform-db/seed` slice: `seedPlatform(prisma, input)` upserts the platform's roles, permissions, default grants, the `global` system settings row and the initial administrator's allowlist entry (never deleting, never overwriting an admin-edited value), with `platformSeedInputFrom` and `readSeedSnapshot` to build the input from the registries' committed catalogs.
- 9734a55: `platform db baseline`: adopt the package migration history in a database that already has its schema, without re-running a migration. Dry run by default; `--apply` maps the app's directories to the platform migrations (exact hash, comment-stripped hash, or a `--map` file), refuses on a failed `_prisma_migrations` row, a live schema difference no declared deviation explains, or a missing raw-SQL index, then writes `platform.lock` and marks the migrations that have no directory applied with `prisma migrate resolve --applied`. `--through` adopts a database that is behind. Adds `runBaseline`, `proposeMapping`, `planBaseline`, `renderReport` and `createBaselineDeps`.

### Patch Changes

- 2235f8a: `platform.lock` and `manifest.json` accept semantic versions with a prerelease or build suffix (`0.1.0-next.1`), so `platform db sync` at a prerelease package version writes a lock `parseLock` reads back. `compareVersions` orders versions by semver precedence (a prerelease is below its release, numeric identifiers compare numerically), and `nextPlatformVersion` gives a prerelease package the release it leads to. Adds `SEMVER_PATTERN`.

## 0.1.0-next.1

### Minor Changes

- 31c6b2a: Platform history v1: the base's 22 migrations ship in `migrations/` (`0001_initial` to `0022_add_retention_created_at_indexes`, byte-identical to the app copies) with a filled `manifest.json` (an entry may list the other slices it `touches`), and the raw-SQL index list becomes the exported `RAW_SQL_INDEXES` with a tripwire (`assertRawSqlIndexes`) that fails on an unlisted partial or expression index.

### Patch Changes

- 521f3d2: Schema comments name `@marinoscar/platform-api/core` as the home of the secret cipher (comments only; no model change).

## 0.1.0-next.0

### Minor Changes

- ebaabe2: Ship the base Prisma schema as slice fragments with `// @extensible` models and `extend model`, plus the `platform db compose [--check]` composer that generates an app's `prisma/schema/` folder.
- a66fef1: First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

  - `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
  - `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
  - `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
  - `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
  - `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
  - `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.

- a630d75: Migration tooling: the `platform` bin gains `platform db sync` (byte-copy package migrations into the app's `prisma/migrations` under app-local timestamps and record them in `prisma/platform.lock`), `platform db check` (offline lock verification; `--database` also compares `_prisma_migrations` checksums), `platform db promote` (turn an app-generated migration into a package migration) and `platform db drift` (migration history vs schema through a shadow database, plus the raw-SQL index assertion). Adds the `PlatformLock` and manifest models, `planSync`, `applySync`, `checkLock`, `checkLedger`, `promote` and `raw-sql-indexes.json`.
