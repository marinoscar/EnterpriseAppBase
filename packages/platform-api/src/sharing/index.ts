// `@marinoscar/platform-api/sharing`: the sharing slice (epic #666): groups,
// their members and invites, the ownership contract and the principal
// enrichment (issue #728); grants, the resource-type registry, AccessPolicy,
// the "resources I can see" helpers and the grants prune job (issue #729);
// link grants, the public link route and the public-route pattern (#730).
// Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ------------------------------------------
export { SharingModule } from './sharing.module';
export {
  SHARING_GRANT_DEFAULTS,
  SHARING_GROUP_DEFAULTS,
  SHARING_LINK_DEFAULTS,
  SHARING_OPTIONS,
  defaultSharingPrincipal,
  resolveSharingModuleOptions,
} from './sharing.options';
export type {
  ResolvedSharingModuleOptions,
  SharingGrantsOptions,
  SharingGroupsOptions,
  SharingLinksOptions,
  SharingModuleOptions,
} from './sharing.options';

// ---- the host ports: one token per app capability ----------------------------------
export { SHARING_DATA, SHARING_EVENT_BUS, SHARING_EVENT_EMITTER, SHARING_JOBS, SHARING_NOTIFIER, SHARING_TENANCY } from './ports';
export type {
  SharingDataPort,
  SharingEventBus,
  SharingEventBusMeta,
  SharingEventEmitter,
  SharingJobExecutionProfile,
  SharingJobHandler,
  SharingJobRecord,
  SharingJobsPort,
  SharingNotifier,
  SharingSystemReason,
  SharingTenancy,
} from './ports';

// ---- permissions, metrics, errors, as data for the app's registries ---------------
export { SHARING_PERMISSIONS, SHARING_PERMISSION_DECLARATIONS } from './permissions';
export type { SharingPermissionDeclaration } from './permissions';
export {
  SHARING_ACCESS_DECISIONS_METRIC,
  SHARING_APP_METRICS,
  SHARING_DECISION_OUTCOMES,
  SHARING_DECISION_VIAS,
  SHARING_GROUP_MUTATIONS_METRIC,
  SHARING_LINK_RESOLUTIONS_METRIC,
  SHARING_LINK_RESOLUTION_OUTCOMES,
  SHARING_MUTATION_OPS,
} from './metrics';
export type { SharingLinkResolutionOutcome, SharingMutationOp } from './metrics';
export { SHARING_ERROR_REASONS } from './errors';

// ---- the ownership contract (rung 2: the group-owned-resource registry) -----------
export {
  activeGroupsOf,
  groupOwnedResourceRegistry,
  groupRoleAtLeast,
  groupRoleRank,
  ownedByMeOrMyGroups,
  ownerWhere,
  registerGroupOwnedResource,
} from './ownership';
export type { GroupOwnedResourceDef, ResourceOwner } from './ownership';

// ---- the resource-type registry (rung 2) and AccessPolicy (#729) -------------------
export { DEFAULT_MAX_GRANTS_PER_RESOURCE, registerResourceType, resourceTypeRegistry } from './access/resource-types';
export type { GrantableKind, PrismaTx, ResourceDescription, ResourceOwnerInfo, ResourceTypeDef } from './access/resource-types';
export { ACCESS_POLICY_CLOCK, AccessPolicy, accessDenial, resourceKey } from './access/access-policy.service';
export type { AccessDecision, AccessVia, EffectiveRole, ResourceRef } from './access/access-policy.service';
export { SHARED_IDS_INLINE_LIMIT, accessibleSql, accessibleWhere, sharedResourceIds } from './access/accessible';
export type {
  AccessibleColumnOptions,
  AccessibleFieldOptions,
  AccessibleSqlOptions,
  AccessibleWhere,
  AccessibleWhereOptions,
  SqlKit,
} from './access/accessible';

// ---- the principal enrichment -------------------------------------------------------
export {
  PRINCIPAL_GROUPS_CLOCK,
  PRINCIPAL_GROUPS_MAX_ENTRIES,
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalGroupsProvider,
  SHARING_GROUPS_INVALIDATE_CHANNEL,
} from './principal-groups.provider';
export type { PrincipalWithGroups } from './principal-groups.provider';

// ---- events (rung 4) ----------------------------------------------------------------
export { SHARING_EVENTS } from './events';
export type { GrantEventPayload, GroupEventPayload, GroupInviteEventPayload, GroupMemberEventPayload, SharingEventName } from './events';

// ---- notifications --------------------------------------------------------------------
export {
  GROUPS_INVITATION_EVENT,
  GROUPS_INVITATION_EVENT_KEY,
  GROUP_INVITATIONS_PATH,
  GROUP_INVITATION_EMAIL_TEMPLATE,
  groupInvitationBrowserTemplate,
  renderGroupInvitationEmail,
} from './notifications/group-invitation.templates';
export type {
  GroupInvitationBrowserContent,
  GroupInvitationEmailKit,
  GroupInvitationNotificationData,
  RenderedGroupInvitationEmail,
  SafeHtmlLike,
} from './notifications/group-invitation.templates';
export {
  SHARED_WITH_ME_PATH,
  SHARED_WITH_YOU_EMAIL_TEMPLATE,
  SHARED_WITH_YOU_EVENT,
  SHARED_WITH_YOU_EVENT_KEY,
  renderSharedWithYouEmail,
  sharedWithYouBrowserTemplate,
} from './notifications/shared-with-you.templates';
export type {
  RenderedSharedWithYouEmail,
  SharedWithYouBrowserContent,
  SharedWithYouNotificationData,
} from './notifications/shared-with-you.templates';

// ---- the user-owned data and model ownership declarations, and the purge ----------
export { GroupMembershipPurge, SHARING_MODEL_OWNERSHIP, SHARING_USER_OWNED_MODELS } from './user-data';
export type { GroupPurgeSummary } from './user-data';

// ---- the services the module exports (what the app may inject) -------------------
export { GroupsService } from './groups/groups.service';
export { GroupMembershipService } from './groups/group-membership.service';
export type { GroupAccess } from './groups/group-membership.service';
export { GROUP_INVITES_CLOCK, GroupInvitesService, inviteStatus } from './groups/group-invites.service';
export { SharingEffects } from './groups/sharing-effects';
export type { CommittedChange, SharingEmittedEvent } from './groups/sharing-effects';
export type { GrantRow, GroupRow } from './data/sharing-tx';
export { MemberLookupThrottle } from './groups/member-lookup-throttle';
export type { MemberLookupThrottleOptions } from './groups/member-lookup-throttle';
export { ORPHANED_GROUPS_SAMPLE, GroupsOrphanedDoctorCheck, decideOrphanedGroups } from './doctor/groups-orphaned.doctor-check';
export { GRANTS_CLOCK, GrantsService, deleteGrantsForResources, toGrantDto } from './grants/grants.service';
export type { GrantWithGrantee } from './grants/grants.service';

// ---- the grants prune job (server-only) and its enqueue-only cron (#729) ------------
export { GRANTS_PRUNE_CHUNK, GRANTS_PRUNE_CLOCK, GRANTS_PRUNE_JOB_TYPE, GrantsPruneHandler } from './jobs/grants-prune.handler';
export type { GrantsPruneSummary } from './jobs/grants-prune.handler';
export { GrantsPruneTask } from './jobs/grants-prune.task';

// ---- link grants and the public-route pattern (#730) --------------------------------
export {
  ANY_LINK_RESOURCE_TYPE,
  LINK_GRANTS_CLOCK,
  LinkGrantsService,
  importLegacyToken,
  linkFailureOutcome,
  resolveLinkExpiry,
  toLinkGrantView,
} from './links/link-grants.service';
export type {
  ImportedLegacyLink,
  LegacyLinkImport,
  LinkResolution,
  LinkResolutionExpectation,
  LinkResolutionFailure,
  ResolvedLinkGrant,
} from './links/link-grants.service';
export { LINK_GRANT_SPAN_ATTRIBUTE, LinkGrantGuard } from './links/link-grant.guard';
export { CurrentLinkGrant, LINK_GRANT_REQUEST_KEY, LINK_GRANT_RESOURCE_KEY, LinkGrantResource } from './links/link-grant.decorators';
export { LinkMissThrottle } from './links/link-miss-throttle';
export { PUBLIC_LINK_RESPONSE_HEADERS, PublicLinkInterceptor, setPublicLinkHeaders } from './links/public-link.interceptor';
