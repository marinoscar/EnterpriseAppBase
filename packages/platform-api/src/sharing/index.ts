// `@marinoscar/platform-api/sharing`: the sharing slice (epic #666), first
// story: groups, their members and invites, the ownership contract and the
// principal enrichment (issue #728). Documented in ./README.md. Explicit named
// exports only.

// ---- the module and its options (rung 1) ------------------------------------------
export { SharingModule } from './sharing.module';
export {
  SHARING_GROUP_DEFAULTS,
  SHARING_OPTIONS,
  defaultSharingPrincipal,
  resolveSharingModuleOptions,
} from './sharing.options';
export type { ResolvedSharingModuleOptions, SharingGroupsOptions, SharingModuleOptions } from './sharing.options';

// ---- the host ports: one token per app capability ----------------------------------
export { SHARING_DATA, SHARING_EVENT_BUS, SHARING_EVENT_EMITTER, SHARING_NOTIFIER, SHARING_TENANCY } from './ports';
export type {
  SharingDataPort,
  SharingEventBus,
  SharingEventBusMeta,
  SharingEventEmitter,
  SharingNotifier,
  SharingSystemReason,
  SharingTenancy,
} from './ports';

// ---- permissions, metrics, errors, as data for the app's registries ---------------
export { SHARING_PERMISSIONS, SHARING_PERMISSION_DECLARATIONS } from './permissions';
export type { SharingPermissionDeclaration } from './permissions';
export { SHARING_APP_METRICS, SHARING_GROUP_MUTATIONS_METRIC, SHARING_MUTATION_OPS } from './metrics';
export type { SharingMutationOp } from './metrics';
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
export type { GroupEventPayload, GroupInviteEventPayload, GroupMemberEventPayload, SharingEventName } from './events';

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
export type { GroupRow } from './data/sharing-tx';
export { MemberLookupThrottle } from './groups/member-lookup-throttle';
export type { MemberLookupThrottleOptions } from './groups/member-lookup-throttle';
export { ORPHANED_GROUPS_SAMPLE, GroupsOrphanedDoctorCheck, decideOrphanedGroups } from './doctor/groups-orphaned.doctor-check';
