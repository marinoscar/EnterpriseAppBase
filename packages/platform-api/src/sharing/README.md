# @marinoscar/platform-api/sharing

The platform's sharing primitives (epic #666): **groups** inside an organization, their **members** (roles `admin`, `editor`, `viewer`) and their **invites**, the **ownership contract** that lets an app table's row be owned by a user or by a group, and the **principal enrichment** that fills `Scope.groupIds` (#728); **grants** (one record shared with a user or a group, with a role and an optional expiry), the **resource-type registry**, **`AccessPolicy`** (`can(principal, action, resource)`), the **"resources I can see"** query helpers and the grant hygiene job (#729); **link shares** (a grant to anyone holding a token, with an expiry and revocation) and the **public-route pattern** that serves them (#730); the UI is [`@marinoscar/platform-web/sharing`](../../../platform-web/src/sharing/README.md) (#731). Every extension point below has a compiled, tested example in the reference app's test tree, [`apps/api/test/examples/sharing/`](../../../../apps/api/test/examples/sharing/user-owned-resource.example.ts), and the conformance suite `@marinoscar/platform-api/sharing/testing` checks an adopting app (#732).

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
- Link shares (#730, `LinkGrantsService`): `/api/grants/links` mints (`lnk_` tokens, returned once; stored as a SHA-256 hash and a ciphertext) and lists links; `PATCH` / `DELETE /api/grants/:id` change and revoke them; the DELIBERATELY PUBLIC `GET /api/public/links/current` resolves the `X-Link-Token` header.
- The public-route pattern for an app's own link routes: `LinkGrantGuard`, `@LinkGrantResource(type, { action })`, `@CurrentLinkGrant()`, `LinkGrantsService.withLinkScope()` and `PublicLinkInterceptor`; `importLegacyToken` for data migrations.

The slice depends on `core`, `doctor` (the Doctor check) and `otel-core` only (`packages/platform-slices.json`), and never on the app or the identity slice: every app capability is a host port.

Out of scope here: nested groups, groups of groups and rule-based membership; criteria-based sharing rules, role hierarchies across organizations and field-level security.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath. The wire shapes are `@marinoscar/platform-contract/sharing`. The database tables come from the `sharing` fragment and migrations `0026_add_groups` and `0027_add_grants` of `@marinoscar/platform-db` (`npm run db:sync`); link shares need no migration of their own. Link creation needs `SECRETS_ENCRYPTION_KEY` (503 without it). Peers: the package's own (`@nestjs/*`, `@prisma/client`, `nestjs-zod`, `zod`, `@opentelemetry/api`). The conformance suite ships as `@marinoscar/platform-api/sharing/testing` (import it from tests only; it reads `@nestjs/common` metadata and the file system).

## Quick start

Mount the module once ([`sharing.config.ts`](../../../../apps/api/src/platform/sharing/sharing.config.ts) with [`sharing-host.module.ts`](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) in the reference app), register a resource type at import time, and protect a controller (the full version: [`user-owned-resource.example.ts`](../../../../apps/api/test/examples/sharing/user-owned-resource.example.ts) and [`notes.controller.example.ts`](../../../../apps/api/test/examples/sharing/notes.controller.example.ts)):

```ts
export const sharingModule = SharingModule.forRoot({ host: platformHost, imports: [SharingHostModule] });

registerResourceType({
  type: 'transcript',                                   // permanent once grants exist
  roles: ['viewer', 'editor'],                          // weakest first; 'owner' is implicit
  actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
  actionPermissions: { write: 'transcripts:write' },    // RBAC on top: 403 naming it, even for the owner
  ownership: 'user',
  loadOwners: async (ids, tx) => /* ONE query: id -> { owner: { kind: 'user', userId }, orgId } */,
});

@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly access: AccessPolicy, private readonly prisma: PrismaService) {}

  @Get(':id')
  @Auth()
  async get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.access.require(principal, 'read', { type: 'transcript', id });   // 404 unless allowed
    return this.prisma.runInOrg(principal.activeOrgId!, (tx) => tx.transcript.findUnique({ where: { id } }));
  }
}
```

Sharing itself needs no code: `POST /api/grants` (or the web slice's `ShareDialog`) shares a record of any registered type. Lists use `accessibleWhere`, deletes call `GrantsService.deleteForResources`, public pages use `LinkGrantGuard`: see the catalog.

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
| `links.appUrl` | `() => string \| undefined` | none (root-relative `/s#...`) | The public origin a link URL is built on; the reference app passes its `APP_URL` |
| `links.maxTtlDays` | positive integer or `null` | `365` | Longest lifetime of a link; a later or absent expiry is brought back to it. `null`: unlimited |
| `links.defaultTtlDays` | positive integer or `null` | `30` | Lifetime when the caller sends no `expiresAt`; `null`: no expiry (only with `maxTtlDays: null`) |
| `links.maxActivePerResource` | positive integer | `20` | Active links per record (409 `LINK_LIMIT_REACHED`), on top of the type's `maxGrantsPerResource` |
| `links.maxMissesPerIp` | positive integer | `30` | Failed public resolutions per client address per 10 minutes before 429 `LINK_RESOLUTION_THROTTLED` |
| `principal` | `(request) => Principal \| undefined` | `request.principal` | Where the routes read the caller |

Host ports (bind with Nest providers in `imports`):

| Token | Required | Reference binding |
|---|---|---|
| `SHARING_DATA` | yes | `runInOrg` = `PrismaService.runInOrg`; `runAsSystem` = `PrismaSystemService.runAsSystem` (reasons `purge`, `doctor`, `retention`, `link-resolution`) |
| `SHARING_EVENT_BUS` | no (process-local invalidation without it) | the app's `EVENT_BUS` |
| `SHARING_EVENT_EMITTER` | no (no events without it) | `EventEmitter2` |
| `SHARING_NOTIFIER` | no (no invitation notification without it) | `NotificationsService.notify` / `notifyAddress`, plus the sign-in URL |
| `SHARING_TENANCY` | no (assumes `single`) | `TenancyService` |
| `SHARING_JOBS` | no (no `sharing.grants.prune` without it) | `SharingJobsAdapter`: `JobHandlerRegistry.register`, `enqueueHousekeepingJob` |

Resource types (`registerResourceType`, rung 2) are validated at registration with a message naming the type: `roles` non-empty and unique (never `'owner'`), every `actions` value a role or `'owner'` (`share` defaults to `'owner'`), the permission maps naming declared actions, `groupRoleMap`, `orgRole` and `grantable` naming known roles, `orgRole` present with `defaultVisibility: 'org'`, `countOwnedByGroup` present when the ownership includes `group` (the type is then also a group-owned resource), and `maxGrantsPerResource` (default 500) in 1..10,000. Defaults: `groupRoleMap` admin gets `'owner'`, editor the strongest role, viewer the weakest; `grantable` gives users and groups every role and links none; `denyAs` is `'not_found'`. The registry freezes after bootstrap.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SharingModule.forRoot` | option | `forRoot(options: SharingModuleOptions): DynamicModule` | Mount the slice once in the app's root module; override `groups`, `grants` and `links` (the table above) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.config.ts), [overrides](../../../../apps/api/test/examples/sharing/sharing-options.example.ts) |
| `SHARING_PERMISSION_DECLARATIONS` | registry | `{ GROUPS_READ; GROUPS_WRITE; GROUPS_ADMIN; SHARING_READ; SHARING_WRITE; SHARING_ADMIN }`, each `{ id; description; scope: 'org'; defaultGrants }` | Register the six permissions with the app's permission registry | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `SHARING_APP_METRICS` | registry | `readonly AppMetricDef[]` (`app.sharing.group_mutations`, label `op`; `app.sharing.access_decisions`, labels `resource_type`, `outcome`, `via`; `app.sharing.link_resolutions`, labels `outcome`, `resource_type`) | Register the counters with the app's metric-name registry | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `registerGroupOwnedResource` | registry | `registerGroupOwnedResource(def: GroupOwnedResourceDef): void` | Declare an app table whose rows a group can own, so group deletion is refused while it owns any | experimental | [example](../../../../apps/api/test/examples/sharing/group-owned-count.example.ts) |
| `GROUPS_INVITATION_EVENT` | registry | `{ key: 'groups.invitation'; label; description; channels: ['email', 'browser']; defaultEnabled }` | Register the invitation with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `SHARING_USER_OWNED_MODELS` | registry | `readonly UserOwnedModelDef[]` (`GroupMember`, `GroupInvite`, `Group`, `Grant`) | Register the slice's user foreign keys with the user-owned data registry | experimental | [example](../../../../apps/api/src/prisma/ownership/user-owned-model.manifest.ts) |
| `SHARING_MODEL_OWNERSHIP` | registry | `readonly ModelOwnershipDef[]` (four `org` models) | Register the slice's tables with the model ownership registry | experimental | [example](../../../../apps/api/src/prisma/ownership/model-ownership.manifest.ts) |
| `SHARING_DATA` | token | `unique symbol` -> `SharingDataPort` | Bind the org-scoped and system transactions | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-data.adapter.ts) |
| `SHARING_EVENT_BUS` | token | `unique symbol` -> `SharingEventBus` | Bind the cross-replica bus the membership invalidations travel on | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENT_EMITTER` | token | `unique symbol` -> `SharingEventEmitter` | Bind the in-process emitter of `SHARING_EVENTS` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_NOTIFIER` | token | `unique symbol` -> `SharingNotifier` | Bind the notification dispatcher (`notify`, `notifyAddress`) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-notifier.adapter.ts) |
| `SHARING_TENANCY` | token | `unique symbol` -> `SharingTenancy` | Bind the tenancy mode (`multi` refuses invites outside the organization) | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-host.module.ts) |
| `SHARING_EVENTS` | event | `sharing.group.created`, `.deleted`, `.member_added`, `.member_removed`, `.member_role_changed`, `.invite_created`, `.invite_accepted`; `sharing.grant.created`, `.updated`, `.revoked` | Listen to group changes (after commit, ids only) | experimental | [example](../../../../apps/api/test/examples/sharing/grant-events.example.ts) |
| `groupInvitationBrowserTemplate` | hook | `(data: GroupInvitationNotificationData) => { title; body; link }` | Bind the bell row and toast of `groups.invitation` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `renderGroupInvitationEmail` | hook | `(data, kit: GroupInvitationEmailKit) => RenderedGroupInvitationEmail` | Render the invitation e-mail with the app's layout and escaping helpers | experimental | [example](../../../../apps/api/src/platform/email/templates/group-invitation.email.ts) |
| `registerResourceType` | registry | `registerResourceType<TRole>(def: ResourceTypeDef<TRole>): void` | Make one app table shareable: roles, actions, permissions, ownership, default visibility, `loadOwners`; at import time, before bootstrap | stable | [example](../../../../apps/api/test/examples/sharing/user-owned-resource.example.ts) |
| `AccessPolicy` | token | `can`/`decide`/`require(principal, action, ref)`, `roleFor(principal, ref)`, `decideMany(principal, action, refs): Map<'type:id', AccessDecision>` | Inject it wherever a route acts on one record (or a page of them): the owner, group, grant and org-default decision | stable | [example](../../../../apps/api/test/examples/sharing/notes.controller.example.ts) |
| `accessibleWhere` | hook | `accessibleWhere(principal, type, { tx, sqlKit, scope?, minRole?, ...fields }): Promise<{ form: 'where'; where } \| { form: 'exists'; sql }>` | List the records a caller may see with Prisma; above 1,000 shared records it hands back the EXISTS form | stable | [example](../../../../apps/api/test/examples/sharing/list-scope.example.ts) |
| `accessibleSql` | hook | `accessibleSql(principal, type, alias, { sqlKit, scope?, minRole?, ...columns }): Prisma.Sql` | The same condition for `$queryRaw` (the only sanctioned raw-SQL path to `grants`), e.g. to page ids in SQL; `sqlKit` is the app's `Prisma` namespace, so the package never loads Prisma | stable | [example](../../../../apps/api/test/examples/sharing/list-scope.example.ts) |
| `ownedByMeOrMyGroups` | hook | `ownedByMeOrMyGroups(principal, { ownerUserField, ownerGroupField }, { minGroupRole? }): where` | List what I or my groups own, without grants (MemoriaHub's circle-scoped lists); give it an enriched principal | experimental | [example](../../../../apps/api/test/examples/sharing/list-scope.example.ts) |
| `sharedResourceIds` | hook | `sharedResourceIds(principal, type, { tx, minRole?, limit? }): Promise<string[]>` | The ids shared with the caller through grants, bounded (default 1,000, at most 10,000) | stable | [example](../../../../apps/api/test/sharing/grants.db.spec.ts) |
| `GrantsService.deleteForResources` | hook | `deleteForResources(tx, type, ids): Promise<number>` | Inside the transaction that deletes records, so they leave no dangling grant (the prune job catches a forgotten call) | stable | [example](../../../../apps/api/test/examples/sharing/delete-resource.example.ts) |
| `SHARING_JOBS` | token | `unique symbol` -> `SharingJobsPort` | Bind the job queue that runs `sharing.grants.prune` (server-only) and its daily enqueue | experimental | [example](../../../../apps/api/src/platform/sharing/sharing-jobs.adapter.ts) |
| `SHARED_WITH_YOU_EVENT` | registry | `{ key: 'sharing.shared_with_you'; label; description; channels: ['email', 'browser']; defaultEnabled }` | Register the share notification with the app's notification registry | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `sharedWithYouBrowserTemplate` | hook | `(data: SharedWithYouNotificationData) => { title; body; link }` | Bind the bell row and toast of `sharing.shared_with_you` | experimental | [example](../../../../apps/api/src/platform/sharing/sharing.notifications.ts) |
| `renderSharedWithYouEmail` | hook | `(data, kit: GroupInvitationEmailKit) => RenderedSharedWithYouEmail` | Render the share e-mail with the app's layout and escaping helpers | experimental | [example](../../../../apps/api/src/platform/email/templates/shared-with-you.email.ts) |
| `LinkGrantGuard` | hook | `CanActivate`: `X-Link-Token` header -> `request.linkGrant`, else the one 404 (429 past the miss budget) | Guard an app's public link route (with the app's `@Public()`) | experimental | [example](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts) |
| `LinkGrantResource` | hook | `@LinkGrantResource(resourceType, { action? = 'read' })` | Declare which links a guarded route accepts: the type, and the action whose minimum role the link must reach | experimental | [example](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts) |
| `CurrentLinkGrant` | hook | `@CurrentLinkGrant(): ResolvedLinkGrant` (`grantId`, `orgId`, `resourceType`, `resourceId`, `role`, `expiresAt`) | Read the resolved link in the handler | experimental | [example](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts) |
| `LinkGrantsService.withLinkScope` | hook | `withLinkScope<R>(link, fn: (tx) => Promise<R>): Promise<R>` | Run the route's reads in ONE transaction scoped to the link's organization with no user, so RLS still applies; return presigned download URLs, never stream bytes | experimental | [example](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts) |
| `PublicLinkInterceptor` | hook | `NestInterceptor`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer` | Put the public-response headers on a public route the guard does not cover | experimental | [example](../../../../apps/api/test/sharing/link-grants.db.spec.ts) |
| `sharingConformanceSuite` | registry | `import '@marinoscar/platform-api/sharing/testing'`, then `runPlatformConformance({ suites: { sharing: SharingConformanceOptions } })` | Check the app keeps the slice's invariants (see Conformance suite) | experimental | [example](../../../../apps/api/test/sharing/sharing-conformance.spec.ts) |
| `importLegacyToken` | hook | `importLegacyToken(tx, { orgId, resourceType, resourceId, role, token, ... }): Promise<{ grantId; token }>` | In a DATA MIGRATION only: import an app's existing clear share token (`lnk_` + the old 43 characters), hashed and encrypted | experimental | [example](../../../../apps/api/test/examples/sharing/legacy-link-import.example.ts) |

Supporting exports: the services the module exports (`GroupsService`, `GroupMembershipService`, `GroupInvitesService`, `PrincipalGroupsProvider`, `GroupMembershipPurge`), the ownership helpers (`ResourceOwner`, `ownedByMeOrMyGroups`, `ownerWhere`, `activeGroupsOf`, `groupRoleRank`, `groupRoleAtLeast`, `groupOwnedResourceRegistry`), `SHARING_PERMISSIONS`, `SHARING_ERROR_REASONS`, the event payload types, `MemberLookupThrottle`, the bus channel names and the Doctor check; for grants `GrantsService` (also exported by the module), `deleteGrantsForResources`, `toGrantDto`, `resourceTypeRegistry`, `resourceKey`, `accessDenial`, `SHARED_IDS_INLINE_LIMIT`, `GrantsPruneHandler`, `GrantsPruneTask` and `GRANTS_PRUNE_JOB_TYPE` (`sharing.grants.prune`, permanent); for links `LinkGrantsService` (also exported by the module: `create`, `list`, `resolve`, `titleOf`), `LinkMissThrottle`, `ANY_LINK_RESOURCE_TYPE`, `resolveLinkExpiry`, `toLinkGrantView`, `setPublicLinkHeaders`, `PUBLIC_LINK_RESPONSE_HEADERS`, `LINK_GRANT_RESOURCE_KEY`, `LINK_GRANT_REQUEST_KEY`, `LINK_GRANT_SPAN_ATTRIBUTE` and `SHARING_LINK_DEFAULTS`; for the conformance suite (`@marinoscar/platform-api/sharing/testing`) the five check functions (`checkNoDirectSharingAccess`, `checkGroupOwnershipRegistered`, `checkLinkRoutesGuarded`, `checkSharingRawSqlIndexes`, `checkResourceTypeIdsStable`), `discoverSharingRoutes`, `modelsWithOwnerGroupColumn`, `SHARING_RAW_SQL_INDEXES` and the option and finding types.

### Minimal examples

Each block is the smallest working use; the linked file is the compiled, tested version (real Postgres under row-level security, the reference app's own binding: [`example-app.helper.ts`](../../../../apps/api/test/examples/sharing/example-app.helper.ts)).

Group-owned, link-shareable (MemoriaHub-style, [`group-owned-resource.example.ts`](../../../../apps/api/test/examples/sharing/group-owned-resource.example.ts)):

```ts
registerResourceType({
  type: 'album', roles: ['viewer', 'editor'], ownership: 'group',
  actions: { read: 'viewer', write: 'editor', share_link: 'editor', share: 'owner', delete: 'owner' },
  groupRoleMap: { admin: 'owner', editor: 'editor', viewer: 'viewer' },   // circle_admin, collaborator, viewer
  bypassPermissions: { read: 'albums:read_any' },
  grantable: { user: ['viewer'], group: ['viewer', 'editor'], link: ['viewer'] },
  loadOwners, countOwnedByGroup,                                           // also registers it as group-owned
});
```

A page of records in one decision, and lists ([`notes.controller.example.ts`](../../../../apps/api/test/examples/sharing/notes.controller.example.ts), [`list-scope.example.ts`](../../../../apps/api/test/examples/sharing/list-scope.example.ts)):

```ts
const decisions = await access.decideMany(principal, 'read', ids.map((id) => ({ type: 'note', id })));
const me = await principalGroups.enrich(principal);
await prisma.runInOrg(me.activeOrgId!, async (tx) => {
  const access = await accessibleWhere(me, 'note', { tx, sqlKit: Prisma, scope: 'shared' });
  return access.form === 'where' ? tx.note.findMany({ where: access.where }) : tx.$queryRaw`SELECT ... WHERE ${access.sql}`;
});
tx.$queryRaw`SELECT r.id FROM notes r WHERE ${accessibleSql(me, 'note', 'r', { sqlKit: Prisma, minRole: 'editor' })} LIMIT ${n}`;
tx.album.findMany({ where: ownedByMeOrMyGroups(me, { ownerUserField: 'ownerUserId', ownerGroupField: 'ownerGroupId' }) });
```

Delete without dangling grants ([`delete-resource.example.ts`](../../../../apps/api/test/examples/sharing/delete-resource.example.ts)):

```ts
await prisma.runInOrg(principal.activeOrgId!, async (tx) => {
  await access.requireIn(tx, principal, 'delete', { type: 'note', id });
  await grants.deleteForResources(tx, 'note', [id]);
  await tx.note.delete({ where: { id } });
});
```

A table a group owns but never shares ([`group-owned-count.example.ts`](../../../../apps/api/test/examples/sharing/group-owned-count.example.ts)):

```ts
registerGroupOwnedResource({ type: 'group_note', countOwnedByGroup: (groupId, tx) => tx.groupNote.count({ where: { ownerGroupId: groupId } }) });
```

A public route ([`public-album.controller.example.ts`](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts)), returning a presigned URL:

```ts
@Controller('public/albums') @Public() @UseGuards(LinkGrantGuard)
class PublicAlbumController {
  @Get('current') @LinkGrantResource('album', { action: 'read' })
  current(@CurrentLinkGrant() link: ResolvedLinkGrant) {
    return this.links.withLinkScope(link, (tx) => this.albums.publicView(tx, link.resourceId)); // presigned URLs, never bytes
  }
}
```

Events ([`grant-events.example.ts`](../../../../apps/api/test/examples/sharing/grant-events.example.ts)) and old tokens ([`legacy-link-import.example.ts`](../../../../apps/api/test/examples/sharing/legacy-link-import.example.ts), a data migration only):

```ts
@OnEvent(SHARING_EVENTS.GRANT_CREATED) onShared(payload: GrantEventPayload) { this.recent.push(payload.grantId); } // record or enqueue; no I/O
await system.runAsSystem('migration-tooling', (tx) => importLegacyToken(tx, { orgId, resourceType: 'album', resourceId, role: 'viewer', token }));
```

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
| `PATCH /api/grants/:id` | `sharing:write` | `share` on the grant's record (a link: `share_link` when the type declares it), else 404; a link's `label`, its expiry capped by `links.maxTtlDays`; `label` on another kind: 422 `NOT_A_LINK_GRANT` |
| `DELETE /api/grants/:id` | `sharing:read` | your own access; anyone else needs `sharing:write` and `share` on the record (else 404); soft revoke |
| `GET /api/grants/shared-with-me` | `sharing:read` | active, unexpired grants to you or your groups, newest first, with `describe()` labels |
| `POST /api/grants/links` | `sharing:write` | `share_link` (else `share`) on the record, else 404; the role in `grantable.link` (absent: the weakest; none listed: 422 `ROLE_NOT_GRANTABLE`); the caps (409 `LINK_LIMIT_REACHED`, `GRANT_LIMIT_REACHED`); `reuseActive` returns your active link with the same role; 503 `LINKS_UNAVAILABLE` without `SECRETS_ENCRYPTION_KEY`; the token in the response body only |
| `GET /api/grants/links?resourceType&resourceId` | `sharing:read` | the same action, else 404; not-revoked links, newest first, each `url` re-derived from its ciphertext |
| `GET /api/public/links/current` | none: **deliberately public** (the app's `@Public()` through `host.access.allowPublic`) | the `X-Link-Token` header is the credential; every failure the same 404; 429 past the per-address miss budget; `Cache-Control: no-store`, `Referrer-Policy: no-referrer` |

**The decision order** of `AccessPolicy`: an unknown type or action is a programming error (500); a missing record or one of another organization is denied; a required `actionPermissions[action]` the caller lacks is denied, even for the owner, and `require` answers 403 naming it; a held `bypassPermissions[action]` (or `sharing:admin` for `share`) is allowed (`via: 'bypass'`); otherwise the effective role is the maximum of owner, the owning group's mapped role, the strongest active unexpired user or group grant and the `org` default role, compared with `actions[action]`. A denial of a `denyAs: 'not_found'` type is the same 404 as a missing record.

No settings namespace.

## UI

None in this package. The UI is [`@marinoscar/platform-web/sharing`](../../../platform-web/src/sharing/README.md): `ShareDialog`, the group pages, pending invitations, "shared with me" and the public `/s` page, over these routes.

## Infra

None beyond one enqueue-only cron. No environment variable (link URLs are built on the app's existing `APP_URL`, passed as `links.appUrl`), no container. Invite expiry is judged at read time; `GrantsPruneTask` enqueues `sharing.grants.prune` daily at 03:00 through `SHARING_JOBS` (and does nothing without it).

## Observability

A span per service operation (`sharing.group.*`, `sharing.grant.*`, `sharing.link.create`, `sharing.link.list`, and `sharing.access.decide_many` with `sharing.batch_size`) with `org.id` as a span attribute, the counters `app.sharing.group_mutations` (label `op`), `app.sharing.access_decisions` (labels `resource_type`, `outcome`, `via`) and `app.sharing.link_resolutions` (labels `outcome`: `ok`, `not_found`, `expired`, `revoked`, `throttled`, `wrong_type`; `resource_type`), never an organization or record id on a label, audit rows `group:*`, `grant:create|update|revoke` and `grant:link:create|update|revoke` (`meta`: resource type and id, grantee kind and id, role, previous role; a link's expiry, never its token, hash or label) with `org_id`, and log lines without addresses. A successful link resolution puts `sharing.link.grant_id` on the request span; a failed one logs `reason=<enum> address=<keyed 12-hex tag>` at debug.

**Link resolutions are counted, never audited.** One public link can be opened thousands of times a day; the audit trail records who changed access (creating, changing and revoking a link are audited), and the counter answers "how often, and how did it end".

## Security notes

- **404, never 403, for a record or group the caller may not see.** A `denyAs: 'not_found'` type (the default) answers a denial with the same body as a missing record, so a status code is never an oracle; only a missing `actionPermissions` entry on a record the caller can already see is a 403 naming the permission (kvox's rule).
- **Row-level security on every table.** `groups`, `group_members`, `group_invites` and `grants` force RLS on `org_id` (`<table>_org_isolation`); every service runs in ONE org-scoped transaction, and composite keys keep a member, an invite or a group grant inside its group's organization.
- **The bypass is confined.** The slice uses the system client only for the user purge, the Doctor check, the prune job and the ONE link lookup by token hash (`link-resolution`); every read after it runs in the link's organization.
- **No direct access.** An app never reads or writes the sharing tables itself (the conformance suite's check 1): decisions come from `AccessPolicy`, lists from the query helpers.

In detail: 404 for a group the caller may not see; row-level security plus composite keys keep organizations apart; the member lookup by e-mail is throttled per account (10 misses per 10 minutes, approximate across replicas) to blunt address enumeration; memberships never travel in the JWT; audit meta, events and bus messages carry no e-mail address. Grants: a record the caller may not share is the same 404 as a missing one; a grantee is always of the record's organization (composite key for groups, an active-membership check for users); grant lookups by e-mail share the member-lookup throttle; decisions are never cached across requests, so a revoked grant stops working on the next request; `accessibleSql` interpolates only validated identifiers and binds every value, through the app's own `Prisma.sql` (`sqlKit`): the package imports no Prisma module.

Link shares (#730):

- **The token rides in the URL fragment** (`<APP_URL>/s#lnk_...`). A browser never sends a fragment, so the token never reaches nginx's access log (`$request`), the API's request log or the server span's `url.path`, and never leaks in a `Referer`. The SPA sends it in the `X-Link-Token` header; a token in a path or a query string is never read (a client that puts one there leaks it into those logs itself).
- **Stored as a hash plus a ciphertext.** `link_token_hash` (SHA-256, unique) is the lookup key; `link_token_ciphertext` is `encryptSecret(token, 'sharing.link:' + grantId)`, the grant id chosen before the insert so the cipher domain binds the row, which lets the sharer copy the link again. A database dump is useless without `SECRETS_ENCRYPTION_KEY`; without the key, creation fails closed (503) rather than store a token in clear. The token is returned once, in the create response; never logged, never on a span, an audit row, an event or an error body.
- **One cross-organization read.** A public request has no organization: resolution reads ONE `grants` row by its hash on the system bypass client (`link-resolution`); the record check (`loadOwners`) and every app read (`withLinkScope`) run in the grant's organization with no user id, so row-level security still applies.
- **One 404 for every failure** (unknown, malformed, revoked, expired, wrong type, a role too weak for the route, a type that no longer grants the role to links, a deleted record): `Link not found`, never a hint. Failures count against the client address (`request.ip`, honouring the proxy settings): past `links.maxMissesPerIp` (default 30) in 10 minutes, 429 with `Retry-After`, even for a valid token. Approximate across replicas, like the AI limits.
- **Revocation is immediate**: nothing caches a resolution, so the next request after `DELETE /api/grants/:id` is a 404. Expiry is capped (`links.maxTtlDays`, default 365) and defaulted (`links.defaultTtlDays`, default 30).
- **Public responses** carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; `MaintenanceGuard` still applies. File bytes are never streamed with the token: a public route returns presigned download URLs (an `<img src>` cannot send a header).
- **Deliberately public routes**: `GET /api/public/links/current`, and any app route behind `LinkGrantGuard`. They carry the app's `@Public()` marker (the platform's route through `host.access.allowPublic`; without one the module does not mount it) so the route inventory sees them as public on purpose.

## Conformance suite

`@marinoscar/platform-api/sharing/testing` registers the `sharing` suite with `runPlatformConformance()` (`@marinoscar/platform-api/testing`) when imported. An app runs it from one spec file in its Jest tree; the reference app's is [`test/sharing/sharing-conformance.spec.ts`](../../../../apps/api/test/sharing/sharing-conformance.spec.ts), and [`test/examples/sharing/conformance.example.spec.ts`](../../../../apps/api/test/examples/sharing/conformance.example.spec.ts) runs it over code that uses every seam:

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/sharing/testing';
import '../../src/app-registrations';   // fills the resource-type registries first

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    sharing: {
      schemaPath: join(API_ROOT, 'prisma', 'schema'),
      migrationsDir: join(API_ROOT, 'prisma', 'migrations'),
      rootModule: AppModule,
      isPublic: (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
      groupOwnedModels: { Album: 'album' },        // every model with owner_group_id -> its group-owned type
      resourceTypeIds: ['album', 'transcript'],    // the committed snapshot
    },
  },
});
```

| Check | Fails when | Protects |
|---|---|---|
| `no-direct-access` | a non-test `.ts` file under `apiSourceRoots` (default `sourceRoots`) calls `.grant`, `.group`, `.groupMember` or `.groupInvite` delegate methods, or names `grants`, `groups`, `group_members` or `group_invites` in raw SQL (`$queryRaw`/`$executeRaw`/`sql` templates, `*Unsafe` strings); `directAccessExempt` lets a file through with a reason, and a stale entry fails | One decision point: no app re-implements the policy, skips expiry or revocation, or reads another user's grants |
| `group-ownership-registered` | a model of the composed schema has an `owner_group_id` column (`@map("owner_group_id")`) but `groupOwnedModels` maps it to no type registered as group-owned (or a map entry is stale) | Group deletion is refused while a group owns rows, instead of orphaning them |
| `link-routes-guarded` | a route reachable from `rootModule` carries `@LinkGrantResource` without `LinkGrantGuard` (or the reverse), names a type that is unregistered or lists no `grantable.link` role, or (with `isPublic`) a guarded route lacks the public marker, or a public route of the slice is not a link route | A public route is authenticated by its link, nothing else is public by accident |
| `raw-sql-indexes` | `grants_active_user_uniq_idx`, `grants_active_group_uniq_idx` or `group_invites_pending_uniq_idx` is not created in the migration SQL under `migrationsDir` | One active grant per record and grantee, one pending invite per address: Prisma cannot express them |
| `resource-type-ids-stable` | a snapshot id is no longer registered (the message calls it a breaking change), or a registered id is missing from the snapshot | A type id is permanent once grants of it exist, like a job type string |

`minRoutes` (default 1) guards the route walk against a wrong root module. The suite's own tests plant each violation in a fixture: `packages/platform-api/test/sharing/conformance.spec.ts`. The row-level security of the four tables is checked by the identity suite's db tier (`RLS_POLICIES`).

## Upgrade notes

v1: none. First release of the slice. To adopt it: run `npm run db:sync` and `npm run prisma:migrate` for `0026_add_groups` and `0027_add_grants` (link shares add no migration; give the host `access.allowPublic` and pass `links.appUrl`), register the declarations (permissions, metrics, notifications, user-owned and ownership data), bind `SHARING_JOBS`, regenerate the permission catalog, and add the conformance spec.

### Migration recipe: from a per-record share table (kvox-style)

Reviewed against kvox at `6e44e43` (2026-09-29): `apps/api/prisma/schema.prisma` (`model TranscriptShare`, `enum TranscriptShareRole`, `model Transcript`'s `ownerId`), `apps/api/src/transcripts/transcript-access.service.ts`, `transcript-sharing.service.ts`, `share-lookup-throttle.service.ts` and `transcripts.service.ts` (`scopeWhere`, `sharedTranscriptIds`). The input of #758.

1. **Prerequisite: organizations.** kvox's tables carry no `org_id` yet; adopt the identity slice's organizations (#725) first, so `transcripts` has `org_id` under RLS.
2. **Register the type** (in `src/app-registrations/`): `type: 'transcript'`, `roles: ['viewer', 'editor']`, `actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' }`, `actionPermissions: { write: 'transcripts:write', delete: 'transcripts:write' }` (kvox's `assertWritePermission` also guards the owner's `own` level: retry, cancel, delete), `ownership: 'user'`, `denyAs: 'not_found'`. `loadOwners` reads `ownerId` and treats a soft-deleted row (`deletedAt` not null) as missing, as `require()` does today. Model on [`user-owned-resource.example.ts`](../../../../apps/api/test/examples/sharing/user-owned-resource.example.ts).
3. **Move the rows**, in one data migration on the bypass (`migration-tooling`): each `TranscriptShare` becomes a `grants` row with `grantee_kind = 'user'`, `resource_type = 'transcript'`, `resource_id = transcript_id`, `grantee_user_id = user_id`, `role` = the enum value as text (`viewer`/`editor`), `granted_by_id` and `created_at` preserved, `org_id` from the transcript. The `(transcript_id, user_id)` unique becomes `grants_active_user_uniq_idx`. Then drop the table.
4. **Replace the call sites.** `TranscriptAccessService.require(userId, id, 'view' | 'edit' | 'own', permissions)` becomes `AccessPolicy.require(principal, 'read' | 'write' | 'delete', { type: 'transcript', id })`; `roleFor` becomes `AccessPolicy.roleFor`; the list's `scopeWhere` and `sharedTranscriptIds` become `accessibleWhere(me, 'transcript', { tx, sqlKit: Prisma, scope, ownerUserField: 'ownerId' })` (kvox's `owned`/`shared`/`all` scopes are the slice's, and the 1,000-id threshold replaces loading every id); the transcript delete calls `GrantsService.deleteForResources` (the old `onDelete: Cascade` did this).
5. **Retire the sharing code.** `transcript-sharing.service.ts` and its routes become `/api/grants` (or the web slice's `ShareDialog`); `share-lookup-throttle.service.ts` is the slice's member-lookup throttle; the share notification is `sharing.shared_with_you` with the type's `describe()`. The audit actions become `grant:create|update|revoke`.
6. **Run the conformance suite** with `resourceTypeIds: ['transcript']`.

Re-run the drift report and refresh this inventory first.

### Migration recipe: from circles and public links (MemoriaHub-style)

Reviewed against MemoriaHub at `8cd1ff6` (2026-10-01): `apps/api/prisma/schema.prisma` (`model Circle`, `CircleMember`, `CircleInvite`, `enum CircleRole`, `model MediaShare`, `enum ShareTargetType`, and the 25 models with a `circleId` column), `apps/api/src/circles/` (`circle-membership.service.ts`, `guards/circle-member.guard.ts`, `circles.service.ts`), `apps/api/src/share/` (`share.service.ts`, `public-share.controller.ts`) and `apps/api/src/auth/auth.service.ts` (`claimPendingCircleInvites`). The input of #765.

1. **Prerequisite: organizations.** No MemoriaHub table carries `org_id`; adopt the identity slice's organizations (#725) first. Circles are sharing groups INSIDE an organization, never tenants (D6).
2. **Circles become groups.** Each non-personal `Circle` becomes a `groups` row (`name`, `description`, `created_by_id = ownerId`, timestamps kept); each `CircleMember` a `group_members` row with `circle_admin` -> `admin`, `collaborator` -> `editor`, `viewer` -> `viewer`. The personal circle (`isPersonal`) becomes no group: its rows become `owner_user_id = Circle.ownerId`.
3. **`circleId` columns become ownership.** On each content table (`MediaItem`, `Album`, `Tag`, `Person`, `Face`, `Memory`, ...: 22 once `CircleMember`, `CircleInvite` and `MediaShare` are gone) `circle_id` becomes `owner_group_id ... ON DELETE RESTRICT` (or `owner_user_id` for the personal circle's rows) with the `num_nonnulls(...) = 1` check. Register every one: `registerResourceType` with `ownership: 'group'` (or `'user_or_group'`) for the shareable `media_item` and `album`, `registerGroupOwnedResource` for the rest, and list each model in the conformance suite's `groupOwnedModels`. Model on [`group-owned-resource.example.ts`](../../../../apps/api/test/examples/sharing/group-owned-resource.example.ts) and [`group-owned-count.example.ts`](../../../../apps/api/test/examples/sharing/group-owned-count.example.ts).
4. **`CircleMemberGuard` becomes `AccessPolicy`.** The guard answers 403 for a non-member; the slice answers 404 (the record's existence is hidden). Circle-scoped lists become `ownedByMeOrMyGroups` (with `minGroupRole` where the guard required a role).
5. **`MediaShare` becomes link grants** through `importLegacyToken` (`targetType` picks `media_item` or `album`, `resource_id` the matching id, `role: 'viewer'`, `expiresAt`, `revokedAt`, `createdById` -> `grantedById`, `createdAt` kept), then the clear `token` column is dropped; see [`legacy-link-import.example.ts`](../../../../apps/api/test/examples/sharing/legacy-link-import.example.ts). Old URLs are `/s/<token>` with the token in the PATH: redirect `/s/:token` to `/s#lnk_:token` in the SPA (the first request of an old link is still logged once).
6. **The public routes change shape.** `public-share.controller.ts` reads the token from the path (`public/shares/:token`) and PROXIES the media bytes (`:token/media/:idx`, with Range). The slice's pattern reads `X-Link-Token` only and returns presigned download URLs, never bytes ([`public-album.controller.example.ts`](../../../../apps/api/test/examples/sharing/public-album.controller.example.ts)); `shares:manage` becomes `sharing:write` (and `share_link` on the type for collaborators).
7. **`CircleInvite` becomes `GroupInvite`.** Unclaimed rows (`claimedAt` null) become pending invites (`invited_by_id = addedById`, `created_at = addedAt`, `expires_at` null: MemoriaHub invites never expire); claimed rows are dropped (their member rows exist). `claimPendingCircleInvites` at sign-in has no slice equivalent yet: `groups.autoAcceptInvitesOnSignup` is experimental and a no-op until identity emits a user-created event (the seam request recorded on #728), so keep the app's claim step or let invitees accept from the pending list.
8. **Run the conformance suite** with `resourceTypeIds: ['album', 'media_item']`.

Re-run the drift report and refresh this inventory first.

## Troubleshooting

Every refusal carries `details.reason` (`SHARING_ERROR_REASONS`); switch on it, never on the message.

| Status, reason | Cause | Fix |
|---|---|---|
| 404 on a record you expect to see | the caller has no role reaching the action (or the record is in another organization, or `loadOwners` did not return it); deliberate for `denyAs: 'not_found'` | check the grant (`GET /api/grants?resourceType&resourceId` as the owner), the group role map, and that `loadOwners` returns the row and its `orgId` |
| 403 `MISSING_PERMISSION` | the action's `actionPermissions` entry is not held, even by the owner | grant the permission through the org role, or drop it from `actionPermissions` |
| 409 `GROUP_OWNS_RESOURCES` | the group still owns rows; `details.counts` per type | move the rows to another owner or delete them, then delete the group |
| 409 `LAST_GROUP_ADMIN` | the change leaves the group without an admin | promote another member first |
| 409 `GROUP_FULL`, `GROUP_LIMIT_REACHED`, `GRANT_LIMIT_REACHED`, `LINK_LIMIT_REACHED` | `maxMembersPerGroup`, `maxGroupsPerCreator`, the type's `maxGrantsPerResource`, `links.maxActivePerResource` | revoke unused grants or links, or raise the option |
| 409 `ALREADY_A_MEMBER`, `INVITE_PENDING`, `INVITE_NOT_PENDING`; 410 `INVITE_EXPIRED` | the invite or membership already exists, or the invite was answered or expired | refresh; invite again after expiry |
| 409 `VERSION_CONFLICT` | `If-Match` names an old group version | reload the group and retry |
| 422 `ROLE_NOT_GRANTABLE` | the role is not in the type's `grantable` for that grantee kind (`details.grantable`); a type lists no link role by default | pick a listed role, or add it to `grantable` |
| 422 `NOT_AN_ORG_MEMBER`, `GROUP_NOT_IN_ORG` | the person or group is not of the record's organization | invite the person to the organization first |
| 422 `NOT_A_LINK_GRANT`; 400 `SELF_GRANT`, `EXPIRY_IN_PAST` | `label` on a user or group grant; a grant to yourself; a past `expiresAt` | fix the request |
| 429 `LOOKUP_THROTTLED`, `LINK_RESOLUTION_THROTTLED` | too many failed e-mail lookups (per account) or link resolutions (per address) | wait `Retry-After` |
| 503 `LINKS_UNAVAILABLE` | `SECRETS_ENCRYPTION_KEY` is not configured | set it (links are never stored in clear) |
| 500 `LinkGrantGuard: ... declares no @LinkGrantResource(type)` | a guarded route without the decorator | add `@LinkGrantResource(type, { action })`; the conformance suite's check 3 catches it |
| `RegistryError FROZEN` from `registerResourceType` | a registration after bootstrap (a lazily imported module) | register in the app's registration modules, imported before `AppModule` boots |
| conformance `resource-type-ids-stable` fails after a rename | a type id disappeared | keep the old id registered, or migrate its grants' `resource_type` in the same change |

## Links

- [The contract slice](../../../platform-contract/src/sharing/README.md)
- [The web slice (sharing UI)](../../../platform-web/src/sharing/README.md)
- [The reference examples](../../../../apps/api/test/examples/sharing/example-app.helper.ts) (`apps/api/test/examples/sharing/`, and `apps/web/src/__tests__/examples/sharing/` for the UI)
- [Package documentation standard](../../../../docs/PACKAGES.md)
- [Platform packages spec, tenancy and access model](../../../../docs/specs/platform-packages.md#tenancy-and-access-model)
- [Tenant isolation (row-level security)](../../../../docs/SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)
