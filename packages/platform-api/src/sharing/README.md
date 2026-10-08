# @marinoscar/platform-api/sharing

The platform's sharing primitives (epic #666): **groups** inside an organization, their **members** (roles `admin`, `editor`, `viewer`) and their **invites**, the **ownership contract** that lets an app table's row be owned by a user or by a group, and the **principal enrichment** that fills `Scope.groupIds` (#728); **grants** (one record shared with a user or a group, with a role and an optional expiry), the **resource-type registry**, **`AccessPolicy`** (`can(principal, action, resource)`), the **"resources I can see"** query helpers and the grant hygiene job (#729). Link shares (#730), the UI (#731) and the full README, reference examples and conformance suite (#732) follow.

## Purpose and scope

A group is a set of users inside ONE organization that can own and share content. It is never a tenant (spec decision D6): every row of the slice carries `org_id` under the organization row-level-security model of #725, and every request is served in the caller's ACTIVE organization.

What ships:

- `SharingModule.forRoot(options)`: the `/api/groups` routes, their services and the `sharing.groups.orphaned` Doctor check.
- The ownership contract: `ResourceOwner`, the column convention for app tables, the group-owned-resource registry (`registerGroupOwnedResource`) that refuses deleting a group that still owns rows, and `ownedByMeOrMyGroups()`, the "owned by me or by a group I belong to" `where` fragment.
- `PrincipalGroupsProvider`: the principal's memberships in its active organization, loaded lazily, cached on the principal cache's TTL and invalidated across replicas through the event bus. Never in the JWT.
- `GroupMembershipPurge`: the user-purge rule (promote the longest-standing member when the last admin goes).
- `registerResourceType(def)`: makes an app table shareable in one call (roles, the minimum role per action, the RBAC permission an action also needs, bypass permissions, ownership, default visibility, grantable roles, the batch `loadOwners`).
- `AccessPolicy`: the one decision point (`can`, `decide`, `require`, `roleFor`, `decideMany`), batched and memoised per request.
- `accessibleWhere` / `accessibleSql` / `sharedResourceIds`: "which records may I see", in one query.
- `/api/grants` (`GrantsService`): share, change, revoke, "shared with me"; `deleteForResources` for an app's delete transaction; the server-only `sharing.grants.prune` job.

The slice depends on `core`, `doctor` (the Doctor check) and `otel-core` only (`packages/platform-slices.json`), and never on the app or the identity slice: every app capability is a host port.

Out of scope here: nested groups, groups of groups and rule-based membership; criteria-based sharing rules, role hierarchies across organizations and field-level security.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath. The wire shapes are `@marinoscar/platform-contract/sharing`. The database tables come from the `sharing` fragment and migrations `0026_add_groups` and `0027_add_grants` of `@marinoscar/platform-db` (`npm run db:sync`). Peers: the package's own (`@nestjs/*`, `@prisma/client`, `nestjs-zod`, `zod`, `@opentelemetry/api`).

## Quick start

```ts
// apps/api/src/platform/sharing/sharing.config.ts
export const sharingModule = SharingModule.forRoot({
  host: platformHost,               // the app's @Auth(): a group route is never public
  imports: [SharingHostModule],     // binds SHARING_DATA and the optional ports
});
```

The reference app's binding is [`sharing.config.ts`](../../../../apps/api/src/platform/sharing/sharing.config.ts) with [`sharing-host.module.ts`](../../../../apps/api/src/platform/sharing/sharing-host.module.ts). The worked examples and the conformance suite are completed in #732.

Make a table shareable, then decide and list (the real-database version is [`grants.db.spec.ts`](../../../../apps/api/test/sharing/grants.db.spec.ts)):

```ts
registerResourceType({
  type: 'transcript',                                   // permanent once grants exist
  roles: ['viewer', 'editor'],                          // weakest first; 'owner' is implicit
  actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
  actionPermissions: { write: 'transcripts:write' },    // RBAC on top: 403 naming it, even for the owner
  ownership: 'user',
  loadOwners: async (ids, tx) => /* one query: id -> { owner, orgId } */,
});

await access.require(principal, 'write', { type: 'transcript', id });   // 404 unless allowed

const me = await principalGroups.enrich(principal);
const visible = await accessibleWhere(me, 'transcript', { tx, scope: 'shared' });
// { form: 'where', where } for findMany, or { form: 'exists', sql } above 1,000 shared records

await grants.deleteForResources(tx, 'transcript', [id]);  // in the transaction that deletes it
```

## Configuration

`SharingModule.forRoot(options)` merges `options.groups` over the defaults and freezes the result; an invalid value throws at boot naming the option. No environment variable.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host` | `PlatformHost` | required | The app's access decorators (`definePlatformHost`) |
| `imports` | Nest imports | `[]` | Modules that provide the host ports |
| `groups.maxGroupsPerCreator` | positive integer | `100` | Groups one user may create per organization (409 `GROUP_LIMIT_REACHED`) |
| `groups.maxMembersPerGroup` | positive integer | `1000` | Members per group (409 `GROUP_FULL`) |
| `groups.inviteTtlDays` | positive integer or `null` | `14` | Invite lifetime; `null` never expires. Expiry is judged when an invite is read, so no cron |
| `groups.autoAcceptInvitesOnSignup` | boolean | `false` | Experimental and a no-op (with a startup warning) until the identity slice emits a user-created event |
| `groups.membershipCacheTtlSeconds` | non-negative integer | `30` | How long a principal's memberships are cached; `0` turns the cache off. The reference app passes `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` |
| `grants.retentionDays` | positive integer | `90` | Days a revoked or expired grant is kept before `sharing.grants.prune` deletes it |
| `principal` | `(request) => Principal \| undefined` | `request.principal` | Where the routes read the caller |

Host ports (bind with Nest providers in `imports`):

| Token | Required | Reference binding |
|---|---|---|
| `SHARING_DATA` | yes | `runInOrg` = `PrismaService.runInOrg`; `runAsSystem` = `PrismaSystemService.runAsSystem` (reasons `purge`, `doctor`, `retention`) |
| `SHARING_EVENT_BUS` | no (process-local invalidation without it) | the app's `EVENT_BUS` |
| `SHARING_EVENT_EMITTER` | no (no events without it) | `EventEmitter2` |
| `SHARING_NOTIFIER` | no (no invitation notification without it) | `NotificationsService.notify` / `notifyAddress`, plus the sign-in URL |
| `SHARING_TENANCY` | no (assumes `single`) | `TenancyService` |
| `SHARING_JOBS` | no (no `sharing.grants.prune` without it) | `SharingJobsAdapter`: `JobHandlerRegistry.register`, `enqueueHousekeepingJob` |

Resource types (`registerResourceType`, rung 2) are validated at registration with a message naming the type: `roles` non-empty and unique (never `'owner'`), every `actions` value a role or `'owner'` (`share` defaults to `'owner'`), the permission maps naming declared actions, `groupRoleMap`, `orgRole` and `grantable` naming known roles, `orgRole` present with `defaultVisibility: 'org'`, `countOwnedByGroup` present when the ownership includes `group` (the type is then also a group-owned resource), and `maxGrantsPerResource` (default 500) in 1..10,000. Defaults: `groupRoleMap` admin gets `'owner'`, editor the strongest role, viewer the weakest; `grantable` gives users and groups every role and links none; `denyAs` is `'not_found'`. The registry freezes after bootstrap.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SharingModule.forRoot` | option | `forRoot(options: SharingModuleOptions): DynamicModule` | Mount the slice once in the app's root module | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.config.ts) |
| `SHARING_PERMISSION_DECLARATIONS` | registry | `{ GROUPS_READ; GROUPS_WRITE; GROUPS_ADMIN; SHARING_READ; SHARING_WRITE; SHARING_ADMIN }`, each `{ id; description; scope: 'org'; defaultGrants }` | Register the six permissions with the app's permission registry | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `SHARING_APP_METRICS` | registry | `readonly AppMetricDef[]` (`app.sharing.group_mutations`, label `op`; `app.sharing.access_decisions`, labels `resource_type`, `outcome`, `via`) | Register the counters with the app's metric-name registry | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `registerGroupOwnedResource` | registry | `registerGroupOwnedResource(def: GroupOwnedResourceDef): void` | Declare an app table whose rows a group can own, so group deletion is refused while it owns any | experimental | [example](../../../../apps/api/test/sharing/group-ownership.db.spec.ts) |
| `GROUPS_INVITATION_EVENT` | registry | `{ key: 'groups.invitation'; label; description; channels: ['email', 'browser']; defaultEnabled }` | Register the invitation with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `SHARING_USER_OWNED_MODELS` | registry | `readonly UserOwnedModelDef[]` (`GroupMember`, `GroupInvite`, `Group`, `Grant`) | Register the slice's user foreign keys with the user-owned data registry | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |
| `SHARING_MODEL_OWNERSHIP` | registry | `readonly ModelOwnershipDef[]` (four `org` models) | Register the slice's tables with the model ownership registry | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `SHARING_DATA` | token | `unique symbol` -> `SharingDataPort` | Bind the org-scoped and system transactions | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-data.adapter.ts) |
| `SHARING_EVENT_BUS` | token | `unique symbol` -> `SharingEventBus` | Bind the cross-replica bus the membership invalidations travel on | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENT_EMITTER` | token | `unique symbol` -> `SharingEventEmitter` | Bind the in-process emitter of `SHARING_EVENTS` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_NOTIFIER` | token | `unique symbol` -> `SharingNotifier` | Bind the notification dispatcher (`notify`, `notifyAddress`) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-notifier.adapter.ts) |
| `SHARING_TENANCY` | token | `unique symbol` -> `SharingTenancy` | Bind the tenancy mode (`multi` refuses invites outside the organization) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENTS` | event | `sharing.group.created`, `.deleted`, `.member_added`, `.member_removed`, `.member_role_changed`, `.invite_created`, `.invite_accepted`; `sharing.grant.created`, `.updated`, `.revoked` | Listen to group changes (after commit, ids only) | experimental | [example](../../../../apps/api/test/sharing/sharing-db.helper.ts) |
| `groupInvitationBrowserTemplate` | hook | `(data: GroupInvitationNotificationData) => { title; body; link }` | Bind the bell row and toast of `groups.invitation` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `renderGroupInvitationEmail` | hook | `(data, kit: GroupInvitationEmailKit) => RenderedGroupInvitationEmail` | Render the invitation e-mail with the app's layout and escaping helpers | experimental | [example](../../../../apps/api/src/email/templates/group-invitation.email.ts) |
| `registerResourceType` | registry | `registerResourceType<TRole>(def: ResourceTypeDef<TRole>): void` | Make one app table shareable: roles, actions, permissions, ownership, default visibility, `loadOwners`; at import time, before bootstrap | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `AccessPolicy` | token | `can`/`decide`/`require(principal, action, ref)`, `roleFor(principal, ref)`, `decideMany(principal, action, refs): Map<'type:id', AccessDecision>` | Inject it wherever a route acts on one record (or a page of them): the owner, group, grant and org-default decision | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `accessibleWhere` | hook | `accessibleWhere(principal, type, { tx, scope?, minRole?, ...fields }): Promise<{ form: 'where'; where } \| { form: 'exists'; sql }>` | List the records a caller may see with Prisma; above 1,000 shared records it hands back the EXISTS form | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `accessibleSql` | hook | `accessibleSql(principal, type, alias, { scope?, minRole?, ...columns }): Prisma.Sql` | The same condition for `$queryRaw` (the only sanctioned raw-SQL path to `grants`), e.g. to page ids in SQL | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `sharedResourceIds` | hook | `sharedResourceIds(principal, type, { tx, minRole?, limit? }): Promise<string[]>` | The ids shared with the caller through grants, bounded (default 1,000, at most 10,000) | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `GrantsService.deleteForResources` | hook | `deleteForResources(tx, type, ids): Promise<number>` | Inside the transaction that deletes records, so they leave no dangling grant (the prune job catches a forgotten call) | stable | [example](../../../../apps/api/test/sharing/grants-prune.db.spec.ts) |
| `SHARING_JOBS` | token | `unique symbol` -> `SharingJobsPort` | Bind the job queue that runs `sharing.grants.prune` (server-only) and its daily enqueue | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-jobs.adapter.ts) |
| `SHARED_WITH_YOU_EVENT` | registry | `{ key: 'sharing.shared_with_you'; label; description; channels: ['email', 'browser']; defaultEnabled }` | Register the share notification with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `sharedWithYouBrowserTemplate` | hook | `(data: SharedWithYouNotificationData) => { title; body; link }` | Bind the bell row and toast of `sharing.shared_with_you` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `renderSharedWithYouEmail` | hook | `(data, kit: GroupInvitationEmailKit) => RenderedSharedWithYouEmail` | Render the share e-mail with the app's layout and escaping helpers | experimental | [example](../../../../apps/api/src/email/templates/shared-with-you.email.ts) |

Supporting exports: the services the module exports (`GroupsService`, `GroupMembershipService`, `GroupInvitesService`, `PrincipalGroupsProvider`, `GroupMembershipPurge`), the ownership helpers (`ResourceOwner`, `ownedByMeOrMyGroups`, `ownerWhere`, `activeGroupsOf`, `groupRoleRank`, `groupRoleAtLeast`, `groupOwnedResourceRegistry`), `SHARING_PERMISSIONS`, `SHARING_ERROR_REASONS`, the event payload types, `MemberLookupThrottle`, the bus channel names and the Doctor check; for grants `GrantsService` (also exported by the module), `deleteGrantsForResources`, `toGrantDto`, `resourceTypeRegistry`, `resourceKey`, `accessDenial`, `SHARED_IDS_INLINE_LIMIT`, `GrantsPruneHandler`, `GrantsPruneTask` and `GRANTS_PRUNE_JOB_TYPE` (`sharing.grants.prune`, permanent). Completed with minimal examples in #732.

## Data

The `sharing` fragment of `@marinoscar/platform-db`, migrations `0026_add_groups` and `0027_add_grants`:

| Model (table) | Key columns | Notes |
|---|---|---|
| `Group` (`groups`) | `org_id`, `name`, `description`, `metadata` (JSONB, the app's extra fields), `created_by_id`, `version` | `// @extensible`: an app table that a group owns adds its back-relation with `extend model Group` |
| `GroupMember` (`group_members`) | `group_id`, `user_id`, `org_id`, `role`, `added_by_id` | unique `(group_id, user_id)` |
| `GroupInvite` (`group_invites`) | `group_id`, `org_id`, `email` (lower-cased), `role`, `invited_by_id`, `expires_at`, `accepted_at`, `accepted_by_id`, `declined_at`, `revoked_at` | one PENDING invite per `(group_id, email)`: `group_invites_pending_uniq_idx` (raw SQL) |
| `Grant` (`grants`) | `org_id`, `resource_type`, `resource_id` (no foreign key: polymorphic), `grantee_kind` (`user`, `group`, `link`), `grantee_user_id`, `grantee_group_id`, `role` (a plain string), `expires_at`, `revoked_at`, `revoked_by_id`, `granted_by_id`, `metadata`; link columns `link_token_hash` (unique), `link_token_ciphertext`, `link_label` (#730) | one ACTIVE grant per resource and user (`grants_active_user_uniq_idx`) and per resource and group (`grants_active_group_uniq_idx`), raw SQL; `grants_grantee_consistency_check` keeps the grantee columns consistent with the kind |

All four tables `ENABLE` and `FORCE ROW LEVEL SECURITY` with a `<table>_org_isolation` policy. Members and invites reach their group through the composite key `(group_id, org_id)` -> `groups (id, org_id)`, and a group grant through `(grantee_group_id, org_id)`, so a row can never name another organization's group. Enums `GroupRole { admin, editor, viewer }` and `GrantGranteeKind { user, group, link }`.

**Dangling grants.** A grant's record lives in an app table the platform cannot reference, so deleting a record does not delete its grants. Call `GrantsService.deleteForResources(tx, type, ids)` inside the transaction that deletes the records; the daily `sharing.grants.prune` job (server-only: it reads the app's tables through `loadOwners`) deletes what a forgotten call leaves, and grants revoked or expired more than `grants.retentionDays` ago, in chunks of 500.

**Owned app tables** follow the column convention:

```sql
owner_user_id  uuid NULL REFERENCES users(id),
owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
```

and register a `GroupOwnedResourceDef` (`type`, `countOwnedByGroup(groupId, tx)`); `DELETE /api/groups/:id` answers 409 `GROUP_OWNS_RESOURCES` with `details.counts` per type while any is non-zero.

**User data.** `GroupMember.userId` is owned (the purge deletes it; the export includes it); `GroupMember.addedById`, `GroupInvite.invitedById`, `GroupInvite.acceptedById` and `Group.createdById` are actors (set null). `Grant.granteeUserId` is owned (deleted with the user; the export includes it, without the link token columns); `Grant.grantedById` and `Grant.revokedById` are actors (set null). `GroupMembershipPurge.purgeUser(userId)` promotes the longest-standing remaining member where the user was the last admin, deletes an emptied group that owns nothing and keeps one that owns resources (the Doctor check `sharing.groups.orphaned` lists groups without an admin).

## Permissions and settings

Six ORG-scope permissions, declared through `SHARING_PERMISSION_DECLARATIONS`:

| Permission | org_admin | contributor | viewer | Grants |
|---|---|---|---|---|
| `groups:read` | ✓ | ✓ | ✓ | list and read the groups you belong to, answer your invitations, leave a group |
| `groups:write` | ✓ | ✓ | | create groups; manage members and invites of groups you are an `admin` of |
| `groups:admin` | ✓ | | | read and administer every group of the organization (the override) |
| `sharing:read` | ✓ | ✓ | ✓ | list a record's grants (with `share` on it), list what is shared with you, remove your own access |
| `sharing:write` | ✓ | ✓ | | share records you may share; change and revoke their grants |
| `sharing:admin` | ✓ | | | the `share` action on every record of every type (revoke a leak) |

Routes, with the group rule the services apply inside the request's org-scoped transaction:

| Route | Permission | Group rule |
|---|---|---|
| `GET /api/groups?scope=mine\|all` | `groups:read` (`all`: + `groups:admin`) | `mine` = groups I belong to |
| `POST /api/groups` | `groups:write` | the creator becomes `admin`, in the same transaction |
| `GET /api/groups/invites/mine` | `groups:read` | pending, unexpired invites to my address, in every organization I belong to |
| `POST /api/groups/invites/:inviteId/accept`, `.../decline` | `groups:read` | the address must be mine (else 404); expired: 410 `INVITE_EXPIRED` |
| `GET /api/groups/:id` | `groups:read` | member or `groups:admin`; anyone else 404, never 403 |
| `PATCH /api/groups/:id` (`If-Match`) | `groups:write` | group `admin` or `groups:admin` |
| `DELETE /api/groups/:id` | `groups:write` | group `admin` or `groups:admin`; 409 `GROUP_OWNS_RESOURCES` |
| `GET /api/groups/:id/members` | `groups:read` | member or `groups:admin` |
| `POST /api/groups/:id/members` | `groups:write` | group `admin`; the person must be an active member of the organization (422 `NOT_AN_ORG_MEMBER`) |
| `PATCH /api/groups/:id/members/:userId` | `groups:write` | group `admin`; the last `admin` cannot be demoted (409 `LAST_GROUP_ADMIN`) |
| `DELETE /api/groups/:id/members/:userId` | `groups:read` | yourself; anyone else needs `groups:write` and the group `admin` role; the last `admin` cannot leave |
| `GET`/`POST /api/groups/:id/invites`, `DELETE .../:inviteId` | `groups:read` / `groups:write` | group `admin` |
| `GET /api/grants?resourceType&resourceId` | `sharing:read` | `share` on the record (else 404) |
| `POST /api/grants` | `sharing:write` | `share` on the record; the role grantable to the grantee kind (422 `ROLE_NOT_GRANTABLE`); a user an active member of the organization (422 `NOT_AN_ORG_MEMBER`), a group of it (422 `GROUP_NOT_IN_ORG`); no self-grant (400 `SELF_GRANT`); the cap (409 `GRANT_LIMIT_REACHED`); upsert: one role per grantee |
| `PATCH /api/grants/:id` | `sharing:write` | `share` on the grant's record (else 404) |
| `DELETE /api/grants/:id` | `sharing:read` | your own access; anyone else needs `sharing:write` and `share` on the record (else 404); soft revoke |
| `GET /api/grants/shared-with-me` | `sharing:read` | active, unexpired grants to you or your groups, newest first, with `describe()` labels |

**The decision order** of `AccessPolicy`: an unknown type or action is a programming error (500); a missing record or one of another organization is denied; a required `actionPermissions[action]` the caller lacks is denied, even for the owner, and `require` answers 403 naming it; a held `bypassPermissions[action]` (or `sharing:admin` for `share`) is allowed (`via: 'bypass'`); otherwise the effective role is the maximum of owner, the owning group's mapped role, the strongest active unexpired user or group grant and the `org` default role, compared with `actions[action]`. A denial of a `denyAs: 'not_found'` type is the same 404 as a missing record.

No settings namespace.

## UI

Completed in #731 (the sharing UI in `@marinoscar/platform-web`).

## Infra

None beyond one enqueue-only cron. No environment variable, no container. Invite expiry is judged at read time; `GrantsPruneTask` enqueues `sharing.grants.prune` daily at 03:00 through `SHARING_JOBS` (and does nothing without it).

## Observability

Completed in #732. In short: a span per service operation (`sharing.group.*`, `sharing.grant.*`, and `sharing.access.decide_many` with `sharing.batch_size`) with `org.id` as a span attribute, the counters `app.sharing.group_mutations` (label `op`) and `app.sharing.access_decisions` (labels `resource_type`, `outcome`, `via`), never an organization or record id on a label, audit rows `group:*` and `grant:create|update|revoke` (`meta`: resource type and id, grantee kind and id, role, previous role) with `org_id`, and log lines without addresses.

## Security notes

Completed in #732. In short: 404 for a group the caller may not see; row-level security plus composite keys keep organizations apart; the member lookup by e-mail is throttled per account (10 misses per 10 minutes, approximate across replicas) to blunt address enumeration; memberships never travel in the JWT; audit meta, events and bus messages carry no e-mail address. Grants: a record the caller may not share is the same 404 as a missing one; a grantee is always of the record's organization (composite key for groups, an active-membership check for users); grant lookups by e-mail share the member-lookup throttle; decisions are never cached across requests, so a revoked grant stops working on the next request; `accessibleSql` interpolates only validated identifiers and binds every value.

## Conformance suite

Completed in #732.

## Upgrade notes

New in this version: run `npm run db:sync` and `npm run prisma:migrate` for `0026_add_groups` and `0027_add_grants`, register the declarations (permissions, metrics, notifications, user-owned and ownership data), bind `SHARING_JOBS`, and regenerate the permission catalog.

## Troubleshooting

Completed in #732.

## Links

- [The contract slice](../../../platform-contract/src/sharing/README.md)
- [Platform packages spec, tenancy and access model](../../../../docs/specs/platform-packages.md#tenancy-and-access-model)
- [Tenant isolation (row-level security)](../../../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)
