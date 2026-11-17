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
