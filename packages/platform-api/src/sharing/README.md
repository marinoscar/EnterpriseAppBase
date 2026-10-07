# @marinoscar/platform-api/sharing

The platform's sharing primitives (epic #666), first slice (#728): **groups** inside an organization, their **members** (roles `admin`, `editor`, `viewer`) and their **invites**, the **ownership contract** that lets an app table's row be owned by a user or by a group, and the **principal enrichment** that fills `Scope.groupIds`. Grants and `AccessPolicy` (#729), link shares (#730), the UI (#731) and the full README, reference examples and conformance suite (#732) follow.

## Purpose and scope

A group is a set of users inside ONE organization that can own and share content. It is never a tenant (spec decision D6): every row of the slice carries `org_id` under the organization row-level-security model of #725, and every request is served in the caller's ACTIVE organization.

What ships:

- `SharingModule.forRoot(options)`: the `/api/groups` routes, their services and the `sharing.groups.orphaned` Doctor check.
- The ownership contract: `ResourceOwner`, the column convention for app tables, the group-owned-resource registry (`registerGroupOwnedResource`) that refuses deleting a group that still owns rows, and `ownedByMeOrMyGroups()`, the "owned by me or by a group I belong to" `where` fragment.
- `PrincipalGroupsProvider`: the principal's memberships in its active organization, loaded lazily, cached on the principal cache's TTL and invalidated across replicas through the event bus. Never in the JWT.
- `GroupMembershipPurge`: the user-purge rule (promote the longest-standing member when the last admin goes).

The slice depends on `core`, `doctor` (the Doctor check) and `otel-core` only (`packages/platform-slices.json`), and never on the app or the identity slice: every app capability is a host port.

Out of scope here: nested groups, groups of groups and rule-based membership.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath. The wire shapes are `@marinoscar/platform-contract/sharing`. The database tables come from the `sharing` fragment and migration `0026_add_groups` of `@marinoscar/platform-db` (`npm run db:sync`). Peers: the package's own (`@nestjs/*`, `@prisma/client`, `nestjs-zod`, `zod`, `@opentelemetry/api`).

## Quick start

```ts
// apps/api/src/platform/sharing/sharing.config.ts
export const sharingModule = SharingModule.forRoot({
  host: platformHost,               // the app's @Auth(): a group route is never public
  imports: [SharingHostModule],     // binds SHARING_DATA and the optional ports
});
```

The reference app's binding is [`sharing.config.ts`](../../../../apps/api/src/platform/sharing/sharing.config.ts) with [`sharing-host.module.ts`](../../../../apps/api/src/platform/sharing/sharing-host.module.ts). The worked examples and the conformance suite are completed in #732.

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
| `principal` | `(request) => Principal \| undefined` | `request.principal` | Where the routes read the caller |

Host ports (bind with Nest providers in `imports`):

| Token | Required | Reference binding |
|---|---|---|
| `SHARING_DATA` | yes | `runInOrg` = `PrismaService.runInOrg`; `runAsSystem` = `PrismaSystemService.runAsSystem` (reasons `purge`, `doctor`) |
| `SHARING_EVENT_BUS` | no (process-local invalidation without it) | the app's `EVENT_BUS` |
| `SHARING_EVENT_EMITTER` | no (no events without it) | `EventEmitter2` |
| `SHARING_NOTIFIER` | no (no invitation notification without it) | `NotificationsService.notify` / `notifyAddress`, plus the sign-in URL |
| `SHARING_TENANCY` | no (assumes `single`) | `TenancyService` |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SharingModule.forRoot` | option | `forRoot(options: SharingModuleOptions): DynamicModule` | Mount the slice once in the app's root module | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.config.ts) |
| `SHARING_PERMISSION_DECLARATIONS` | registry | `{ GROUPS_READ; GROUPS_WRITE; GROUPS_ADMIN }`, each `{ id; description; scope: 'org'; defaultGrants }` | Register the three permissions with the app's permission registry | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `SHARING_APP_METRICS` | registry | `readonly AppMetricDef[]` (`app.sharing.group_mutations`, label `op`) | Register the counter with the app's metric-name registry | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `registerGroupOwnedResource` | registry | `registerGroupOwnedResource(def: GroupOwnedResourceDef): void` | Declare an app table whose rows a group can own, so group deletion is refused while it owns any | experimental | [example](../../../../apps/api/test/sharing/group-ownership.db.spec.ts) |
| `GROUPS_INVITATION_EVENT` | registry | `{ key: 'groups.invitation'; label; description; channels: ['email', 'browser']; defaultEnabled }` | Register the invitation with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `SHARING_USER_OWNED_MODELS` | registry | `readonly UserOwnedModelDef[]` (`GroupMember`, `GroupInvite`, `Group`) | Register the slice's user foreign keys with the user-owned data registry | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |
| `SHARING_MODEL_OWNERSHIP` | registry | `readonly ModelOwnershipDef[]` (three `org` models) | Register the slice's tables with the model ownership registry | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `SHARING_DATA` | token | `unique symbol` -> `SharingDataPort` | Bind the org-scoped and system transactions | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-data.adapter.ts) |
| `SHARING_EVENT_BUS` | token | `unique symbol` -> `SharingEventBus` | Bind the cross-replica bus the membership invalidations travel on | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENT_EMITTER` | token | `unique symbol` -> `SharingEventEmitter` | Bind the in-process emitter of `SHARING_EVENTS` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_NOTIFIER` | token | `unique symbol` -> `SharingNotifier` | Bind the notification dispatcher (`notify`, `notifyAddress`) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-notifier.adapter.ts) |
| `SHARING_TENANCY` | token | `unique symbol` -> `SharingTenancy` | Bind the tenancy mode (`multi` refuses invites outside the organization) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENTS` | event | `sharing.group.created`, `.deleted`, `.member_added`, `.member_removed`, `.member_role_changed`, `.invite_created`, `.invite_accepted` | Listen to group changes (after commit, ids only) | experimental | [example](../../../../apps/api/test/sharing/sharing-db.helper.ts) |
| `groupInvitationBrowserTemplate` | hook | `(data: GroupInvitationNotificationData) => { title; body; link }` | Bind the bell row and toast of `groups.invitation` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `renderGroupInvitationEmail` | hook | `(data, kit: GroupInvitationEmailKit) => RenderedGroupInvitationEmail` | Render the invitation e-mail with the app's layout and escaping helpers | experimental | [example](../../../../apps/api/src/email/templates/group-invitation.email.ts) |

Supporting exports: the services the module exports (`GroupsService`, `GroupMembershipService`, `GroupInvitesService`, `PrincipalGroupsProvider`, `GroupMembershipPurge`), the ownership helpers (`ResourceOwner`, `ownedByMeOrMyGroups`, `ownerWhere`, `activeGroupsOf`, `groupRoleRank`, `groupRoleAtLeast`, `groupOwnedResourceRegistry`), `SHARING_PERMISSIONS`, `SHARING_ERROR_REASONS`, the event payload types, `MemberLookupThrottle`, the bus channel names and the Doctor check. Completed with minimal examples in #732.

## Data

The `sharing` fragment of `@marinoscar/platform-db`, migration `0026_add_groups`:

| Model (table) | Key columns | Notes |
|---|---|---|
| `Group` (`groups`) | `org_id`, `name`, `description`, `metadata` (JSONB, the app's extra fields), `created_by_id`, `version` | `// @extensible`: an app table that a group owns adds its back-relation with `extend model Group` |
| `GroupMember` (`group_members`) | `group_id`, `user_id`, `org_id`, `role`, `added_by_id` | unique `(group_id, user_id)` |
| `GroupInvite` (`group_invites`) | `group_id`, `org_id`, `email` (lower-cased), `role`, `invited_by_id`, `expires_at`, `accepted_at`, `accepted_by_id`, `declined_at`, `revoked_at` | one PENDING invite per `(group_id, email)`: `group_invites_pending_uniq_idx` (raw SQL) |

All three tables `ENABLE` and `FORCE ROW LEVEL SECURITY` with a `<table>_org_isolation` policy. Members and invites reach their group through the composite key `(group_id, org_id)` -> `groups (id, org_id)`, so a row can never name another organization's group. Enum `GroupRole { admin, editor, viewer }`.

**Owned app tables** follow the column convention:

```sql
owner_user_id  uuid NULL REFERENCES users(id),
owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
```

and register a `GroupOwnedResourceDef` (`type`, `countOwnedByGroup(groupId, tx)`); `DELETE /api/groups/:id` answers 409 `GROUP_OWNS_RESOURCES` with `details.counts` per type while any is non-zero.

**User data.** `GroupMember.userId` is owned (the purge deletes it; the export includes it); `GroupMember.addedById`, `GroupInvite.invitedById`, `GroupInvite.acceptedById` and `Group.createdById` are actors (set null). `GroupMembershipPurge.purgeUser(userId)` promotes the longest-standing remaining member where the user was the last admin, deletes an emptied group that owns nothing and keeps one that owns resources (the Doctor check `sharing.groups.orphaned` lists groups without an admin).

## Permissions and settings

Three ORG-scope permissions, declared through `SHARING_PERMISSION_DECLARATIONS`:

| Permission | org_admin | contributor | viewer | Grants |
|---|---|---|---|---|
| `groups:read` | ✓ | ✓ | ✓ | list and read the groups you belong to, answer your invitations, leave a group |
| `groups:write` | ✓ | ✓ | | create groups; manage members and invites of groups you are an `admin` of |
| `groups:admin` | ✓ | | | read and administer every group of the organization (the override) |

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

No settings namespace.

## UI

Completed in #731 (the sharing UI in `@marinoscar/platform-web`).

## Infra

None. No environment variable, no container, no cron (invite expiry is judged at read time).

## Observability

Completed in #732. In short: a span per service operation (`sharing.group.*`) with `org.id` as a span attribute, the counter `app.sharing.group_mutations` (label `op`, never an organization), audit rows `group:*` with `org_id` and ids and roles only, and log lines without addresses.

## Security notes

Completed in #732. In short: 404 for a group the caller may not see; row-level security plus composite keys keep organizations apart; the member lookup by e-mail is throttled per account (10 misses per 10 minutes, approximate across replicas) to blunt address enumeration; memberships never travel in the JWT; audit meta, events and bus messages carry no e-mail address.

## Conformance suite

Completed in #732.

## Upgrade notes

New in this version: run `npm run db:sync` and `npm run prisma:migrate` for `0026_add_groups`, register the declarations (permissions, metrics, notification, user-owned and ownership data) and regenerate the permission catalog.

## Troubleshooting

Completed in #732.

## Links

- [The contract slice](../../../platform-contract/src/sharing/README.md)
- [Platform packages spec, tenancy and access model](../../../../docs/specs/platform-packages.md#tenancy-and-access-model)
- [Tenant isolation (row-level security)](../../../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)
