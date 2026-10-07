// `@marinoscar/platform-api/identity`: the identity slice (issue #727, PP-6.6).
// Authentication, the guards and decorators every route uses, users, the
// allowlist, personal access tokens, the device authorization flow,
// organizations and tenancy. Documented in ./README.md. Explicit named exports only.

// ---- the module, its options and its configuration (rung 1) -----------------------
export { IdentityModule } from './identity.module';
export {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  resolveIdentityModuleOptions,
} from './identity.options';
export type { IdentityModuleOptions, ResolvedIdentityModuleOptions } from './identity.options';
export { identityConfiguration, requireJwtSecret } from './identity.configuration';
export type { IdentityConfiguration } from './identity.configuration';

// ---- the host ports (rung 3): one token per app capability --------------------------
export {
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  NOOP_IDENTITY_METRICS,
  USER_DEFAULTS,
} from './ports';
export type {
  AllowlistInvitationNotice,
  IdentityEventBus,
  IdentityEventBusHealth,
  IdentityEventBusMeta,
  IdentityJobHandler,
  IdentityJobRecord,
  IdentityJobsPort,
  IdentityLoginOutcome,
  IdentityMetrics,
  IdentityNodeCredentials,
  IdentityNotifier,
  IdentityPrisma,
  IdentityProfileImages,
  IdentityRefreshOutcome,
  OrgInvitationNotice,
  RoleChangedNotice,
  UserDefaults,
  UserWelcomeNotice,
} from './ports';

// ---- domain events (rung 4) -----------------------------------------------------------
export { IDENTITY_EVENTS } from './identity.events';
export type {
  IdentityMembershipChange,
  IdentityMembershipChangedEvent,
  IdentityOrgSwitchedEvent,
  IdentityUserCreatedEvent,
} from './identity.events';

// ---- sign-in providers (rung 2) -------------------------------------------------------
export { authProviderRegistry, registerAuthProvider } from './auth/providers/auth-provider.registry';
export type { AuthProviderRegistration } from './auth/providers/auth-provider.registry';

// ---- roles and permissions, as data for the app's permission registry -----------------
export {
  DEFAULT_ORG_ROLE,
  IDENTITY_PERMISSION_DECLARATIONS,
  IDENTITY_PERMISSION_IDS,
  IDENTITY_ROLES,
  IDENTITY_ROLE_IDS,
  ORG_ADMIN_ROLE,
} from './identity.permissions';
export type {
  IdentityPermissionDeclaration,
  IdentityPermissionDeclarationMap,
  IdentityPermissionIds,
  IdentityPermissionScope,
  IdentityRoleDeclaration,
  IdentityRoleDeclarationMap,
  IdentityRoleIds,
  PermissionName,
  RoleName,
} from './identity.permissions';
export { USERS_PERMISSIONS } from './users/users.permissions';
export { ALLOWLIST_PERMISSIONS } from './allowlist/allowlist.permissions';
export { ORGANIZATIONS_PERMISSIONS } from './organizations/organizations.permissions';
export { ORGANIZATIONS_APP_METRICS } from './organizations/organizations.metrics';

// ---- route access: decorators and guards (stable) -------------------------------------
export { Auth, RBAC_EXTENSION_KEY } from './auth/decorators/auth.decorator';
export type { AuthOptions, RbacExtension } from './auth/decorators/auth.decorator';
export { IS_PUBLIC_KEY, Public } from './auth/decorators/public.decorator';
export { ROLES_KEY, Roles } from './auth/decorators/roles.decorator';
export { PERMISSIONS_KEY, Permissions } from './auth/decorators/permissions.decorator';
export { CurrentUser } from './auth/decorators/current-user.decorator';
export { CurrentPrincipal, principalOf } from './auth/decorators/current-principal.decorator';
export type { RequestWithPrincipal } from './auth/decorators/current-principal.decorator';
export { CurrentOrg, activeOrgIdOf } from './auth/decorators/current-org.decorator';
export { AuthCredential, authCredentialOf } from './auth/decorators/auth-credential.decorator';
export type { AuthCredentialInfo, RequestWithAuthCredential } from './auth/decorators/auth-credential.decorator';
export { JwtAuthGuard, NODE_ROUTE_PREFIX } from './auth/guards/jwt-auth.guard';
export { RolesGuard } from './auth/guards/roles.guard';
export { PermissionsGuard } from './auth/guards/permissions.guard';
export { GoogleOAuthGuard } from './auth/guards/google-oauth.guard';

// ---- the request user and the principal ------------------------------------------------
export { toRequestUser } from './auth/interfaces/authenticated-user.interface';
export type { AuthenticatedUser, RequestUser } from './auth/interfaces/authenticated-user.interface';
export {
  PRINCIPAL_USER_INCLUDE,
  PrincipalFactory,
  principalFactory,
  resolveEffectiveAccess,
  selectCurrentMembership,
  toPrincipal,
} from './auth/principal.factory';
export type {
  EffectiveAccess,
  PrincipalMembership,
  PrincipalRole,
  PrincipalSource,
} from './auth/principal.factory';
export { bindCredential, hasActiveMembership, stampCredential } from './auth/credential-binding';
export type { BoundUser, CredentialBinding } from './auth/credential-binding';
export type { GoogleProfile } from './auth/strategies/google.strategy';
export type { JwtPayload } from './auth/strategies/jwt.strategy';

// ---- the principal cache --------------------------------------------------------------
export {
  DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS,
  parsePrincipalCacheTtlSeconds,
} from './auth/principal-cache/principal-cache.config';
export {
  PRINCIPAL_CACHE_CLOCK,
  PRINCIPAL_CACHE_MAX_ENTRIES,
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalCache,
} from './auth/principal-cache/principal-cache.service';
export type {
  PrincipalCacheKey,
  PrincipalCacheStats,
  PrincipalInvalidation,
} from './auth/principal-cache/principal-cache.service';
export { PrincipalCacheModule } from './auth/principal-cache/principal-cache.module';

// ---- sign-in errors ------------------------------------------------------------------
export {
  AUTH_ERROR_CODES,
  AuthLoginDeniedException,
  DEFAULT_AUTH_ERROR_CODE,
  buildAuthErrorRedirectUrl,
  isOAuthAccessDenied,
  resolveAuthErrorCode,
} from './auth/auth-error-codes';
export type { AuthErrorCode, AuthLoginDeniedReason } from './auth/auth-error-codes';

// ---- tenancy and organization scope -----------------------------------------------------
export {
  DEFAULT_TENANCY_MODE,
  TENANCY_MODES,
  TENANCY_MODE_ENV_VAR,
  describeTenancyMode,
  parseTenancyMode,
  tenancyCapabilitiesFor,
  verifyTenancyModeAtStartup,
} from './organizations/tenancy-mode';
export type { TenancyCapabilities } from './organizations/tenancy-mode';
export { currentTenancyMode, recordTenancyMode } from './auth/tenancy-mode';
export { TenancyService } from './organizations/tenancy.service';
export { MissingOrgScopeError, orgIdFromPayload, resolveJobOrgId, resolveOrgId } from './organizations/org-scope';
export { DefaultOrganizationMissingException } from './organizations/organizations.errors';

// ---- the modules and the services they export -----------------------------------------
export { AuthModule } from './auth/auth.module';
export { AuthService, ORG_SWITCHED_AUDIT_ACTION } from './auth/auth.service';
export type { FullTokenResponse } from './auth/auth.service';
export { AdminBootstrapService } from './auth/admin-bootstrap.service';
export { UsersModule } from './users/users.module';
export { UsersService } from './users/users.service';
export { AllowlistModule } from './allowlist/allowlist.module';
export { AllowlistService } from './allowlist/allowlist.service';
export { PatModule } from './pat/pat.module';
export { PatService } from './pat/pat.service';
export { DeviceAuthModule } from './device-auth/device-auth.module';
export { DeviceAuthService } from './device-auth/device-auth.service';
export { OrganizationsModule } from './organizations/organizations.module';
export { OrganizationsService } from './organizations/organizations.service';
export { OrgMembersService } from './organizations/org-members.service';
export { OrgInvitesService } from './organizations/org-invites.service';
export { OrganizationsAdminService } from './organizations/organizations-admin.service';

// ---- the job types (permanent strings; both server-only) --------------------------------
export { AUTH_TOKEN_CLEANUP_TYPE } from './auth/handlers/token-cleanup.handler';
export { DEVICE_CODE_CLEANUP_TYPE } from './device-auth/handlers/device-code-cleanup.handler';
