// `@marinoscar/platform-web/identity/headless`: the identity slice's behaviour
// without markup (issue #727, PP-6.6): the auth context and its hooks, the
// route guards, the identity API client and data hooks, the sign-in provider
// registry and the device-activation credential logic. Documented in
// ../README.md. Explicit named exports only.

export { AuthContext, AuthProvider, useAuth, useOptionalAuth } from './auth-context.js';
export type { AuthProviderProps } from './auth-context.js';
export type {
  AuthContextValue,
  AuthProviderInfo,
  AuthRole,
  AuthSessionClient,
  AuthUser,
  LoginOptions,
  OrgMembershipSummary,
  OrgSummary,
} from './types.js';
export { usePermissions } from './use-permissions.js';
export type { UsePermissionsReturn } from './use-permissions.js';
export { RequireAuth, RequireMultiOrg, RequirePermission, useOrgsFeature } from './guards.js';
export type { RequireAuthProps, RequireMultiOrgProps, RequirePermissionProps } from './guards.js';
export {
  getRegisteredAuthProvider,
  listRegisteredAuthProviders,
  registerAuthProvider,
} from './auth-provider-registry.js';
export type { AuthProviderDescriptor } from './auth-provider-registry.js';
export { ORG_ROLES, createIdentityApi } from './api.js';
export type {
  AllowedEmailEntry,
  AllowlistParams,
  AllowlistResponse,
  AllowlistSortField,
  CreatePatInput,
  DeviceActivationInfo,
  DeviceAuthorizationResponse,
  IdentityApi,
  IdentityUserRef,
  OrgInvite,
  OrgInviteListParams,
  OrgInviteStatus,
  OrgMember,
  OrgMemberListParams,
  OrgMemberStatus,
  OrgRole,
  Organization,
  OrganizationListParams,
  Paginated,
  PatCreatedResponse,
  PatDurationUnit,
  PersonalAccessToken,
  UserListItem,
  UserListParams,
  UserSortField,
  UsersResponse,
} from './api.js';
export { IdentityWebAdaptersProvider, useIdentityApi, useIdentityWebAdapters } from './adapters.js';
export type { IdentitySpinnerProps, IdentityWebAdapters } from './adapters.js';
export type {
  IdentityDataTableComponent,
  IdentityDataTableProps,
  IdentityTableColumn,
  IdentityTableColumnPriority,
  IdentityTableEnumValue,
  IdentityTableFilter,
  IdentityTableFilterModelOperator,
  IdentityTableFilterOperator,
  IdentityTableRowAction,
  IdentityTableSortState,
} from './table.js';
export { useUsers } from './hooks/use-users.js';
export type { UseUsersReturn } from './hooks/use-users.js';
export { useAllowlist } from './hooks/use-allowlist.js';
export type { UseAllowlistReturn } from './hooks/use-allowlist.js';
export { usePersonalAccessTokens } from './hooks/use-personal-access-tokens.js';
export type { UsePersonalAccessTokensReturn } from './hooks/use-personal-access-tokens.js';
export { useOrgInvites, useOrgMembers, useOrganizations } from './hooks/use-organizations.js';
export type { UseOrgInvitesReturn, UseOrgMembersReturn, UseOrganizationsReturn } from './hooks/use-organizations.js';
export {
  DEVICE_NAME_MAX_DISPLAY,
  DEVICE_PAT_APPROX_DAYS,
  IP_ADDRESS_MAX_DISPLAY,
  USER_AGENT_MAX_DISPLAY,
  readCredentialKind,
  sanitizeDeviceText,
} from './device-credential.js';
export type { DeviceCredentialKind } from './device-credential.js';
