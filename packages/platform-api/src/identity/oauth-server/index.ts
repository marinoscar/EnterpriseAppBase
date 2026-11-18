// The OAuth server's resource-server half (PP-15.3, docs/specs/oauth-server.md).
// Explicit named exports only.

export {
  FORBIDDEN_OAUTH_ROUTE_PREFIXES,
  findOAuthRegistryProblems,
  oauthResourceRegistry,
  registerOAuthProtectedResource,
  resourceForPath,
} from './oauth-resource.registry';
export type { OAuthProtectedResourceDefinition, OAuthRegistryProblem } from './oauth-resource.registry';
export {
  OAUTH_SCOPE_ID_MAX_LENGTH,
  OAUTH_SCOPE_ID_PATTERN,
  OFFLINE_ACCESS_SCOPE,
  oauthScopeRegistry,
  permissionsOfScopes,
  registerOAuthScope,
} from './oauth-scope.registry';
export type { OAuthScopeDefinition, OAuthScopeRisk } from './oauth-scope.registry';
export { OAUTH_CREDENTIAL_KIND } from './oauth-credential-kind';
export { OAuthGrant, oauthGrantOf } from './oauth-grant.decorator';
export { OAuthServerModule } from './oauth-server.module';
export { OAUTH_SETTINGS_CACHE_MS, OAuthServerSettingsReader } from './oauth-server-settings.reader';
export {
  OAUTH_SERVER_SETTINGS_DEFAULTS,
  oauthServerSettingsPatchSchema,
  oauthServerSettingsSchema,
} from './oauth-server-settings.schemas';
export type { OAuthServerSettingsValue } from './oauth-server-settings.schemas';
export { OAUTH_LAST_USED_INTERVAL_MS, OAuthTokenResolver, oauthResourceIdentifier } from './oauth-token.resolver';
export type { ResolvedOAuthToken } from './oauth-token.resolver';
export { IPD_BEARER_PREFIX, IPD_TTL_MS, InProcessDelegation } from './in-process-delegation.service';
export type { InProcessDelegationEntry } from './in-process-delegation.service';

// ---- the authorization server core (PP-15.4) --------------------------------------------
export { OAUTH_CLIENT_RESOLVER, StoredClientResolver } from './client-resolver';
export type { ClientRefused, ClientResolution, ClientResolved, ClientResolver, OAuthClientRecord } from './client-resolver';
export { InMemoryOAuthRateLimiter, OAUTH_RATE_LIMITER, OAuthRateLimitService } from './oauth-rate-limiter';
export type { OAuthRateLimitVerdict, OAuthRateLimiter } from './oauth-rate-limiter';
export { OAuthServerContext, OAuthServerFeatures } from './oauth-server-context';
export { OAUTH_AUDIT_ACTIONS, OAUTH_AUDIT_TARGET_TYPE, OAUTH_CLIENT_AUDIT_TARGET_TYPE, OAuthGrantService } from './oauth-grant.service';
export type { OAuthAuditEntry, OAuthGrantRef } from './oauth-grant.service';
export { OAuthProtocolError, invalidClient, oauthError, rateLimited } from './oauth-protocol.error';
export { OAuthProtocolExceptionFilter } from './oauth-protocol.filter';
export { buildAuthorizationServerMetadata } from './oauth-metadata';
export type { OAuthAuthorizationServerMetadata } from './oauth-metadata';
export { isLoopbackRedirectUri, matchesRedirectUri, normalizeResourceIdentifier, redirectHostOf } from './redirect-uri';
export { isWellFormedChallenge, isWellFormedVerifier, s256Challenge, verifyPkce } from './pkce';
export {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_BODY_LIMIT_BYTES,
  OAUTH_CODE_PREFIX,
  OAUTH_CODE_TTL_MS,
  OAUTH_RATE_LIMITS,
  OAUTH_REFRESH_GRACE_MS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REQUEST_TTL_MS,
  OAUTH_PUBLIC_CORS_PATHS,
  OAUTH_ROUTE_PREFIX,
} from './oauth-server.constants';
export type { OAuthRateLimitSpec } from './oauth-server.constants';
export { OAuthAuthorizationService } from './oauth-authorization.service';
export { OAuthTokenService, parseOAuthForm } from './oauth-token.service';
export { OAuthConsentController, OAuthGrantsController } from './oauth-consent.controller';
export { OAuthProtocolController } from './oauth-protocol.controller';
export { OAuthResourceMetadataController } from './oauth-resource-metadata.controller';
export { buildProtectedResourceMetadata } from './oauth-resource-metadata';
export type { OAuthProtectedResourceMetadata } from './oauth-resource-metadata';
export { buildBearerChallenge, protectedResourceMetadataUrl, quoteChallengeValue } from './oauth-challenge';
export type { BearerChallengeInput, OAuthChallengeError } from './oauth-challenge';
export { InsufficientScopeException, assertOAuthScopes } from './oauth-insufficient-scope';
export { requireSessionCredential } from './session-only';
export * from './clients/index';
export { OAUTH_CLIENTS_PERMISSIONS } from './oauth-clients.permissions';

// ---- token housekeeping, metrics and Doctor checks (PP-15.8) -------------------------------
export { OAUTH_TOKEN_CLEANUP_TYPE, OAUTH_TOKEN_RETENTION, OAuthTokenCleanupHandler } from './oauth-token-cleanup.handler';
export type { OAuthTokenCleanupResult } from './oauth-token-cleanup.handler';
export { OAuthTokenCleanupTask } from './oauth-token-cleanup.task';
export { OAUTH_APP_METRICS } from './oauth.metrics';
export {
  OAUTH_SETTINGS_PATH,
  OAUTH_TOKEN_CLEANUP_GRACE_MS,
  OAuthClientPolicyDoctorCheck,
  OAuthPublicUrlDoctorCheck,
  OAuthResourcesDoctorCheck,
  OAuthTokenCleanupDoctorCheck,
  OAuthWellKnownDoctorCheck,
  decideOAuthClientPolicy,
  decideOAuthPublicUrl,
  decideOAuthResources,
  decideOAuthTokenCleanup,
  decideOAuthWellKnown,
  isNonPublicHostName,
} from './doctor/oauth-server.doctor-checks';
export type { WellKnownProbe } from './doctor/oauth-server.doctor-checks';
