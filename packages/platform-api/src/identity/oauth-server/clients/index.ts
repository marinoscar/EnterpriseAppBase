// OAuth client identity and the trust policy (PP-15.5, docs/specs/oauth-server.md §2.15).
// Explicit named exports only.

export {
  CIMD_DEFAULT_CACHE_MS,
  CIMD_FETCH_TIMEOUT_MS,
  CIMD_MAX_BYTES,
  CIMD_MAX_CACHE_MS,
  CIMD_MIN_CACHE_MS,
  CIMD_OVERALL_DEADLINE_MS,
  CimdError,
  CimdFetcher,
  OAUTH_CIMD_HOST_RESOLVER,
  OAUTH_CIMD_TRANSPORT,
  cimdExpiry,
  parseCimdClientId,
  validateCimdDocument,
} from './cimd.fetcher';
export type { CimdFailureCode, CimdFetchResult, CimdMetadata } from './cimd.fetcher';
export { ClientIdentityResolver } from './client-identity.resolver';
export {
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_REDIRECT_URIS_MAX,
  CLIENT_REDIRECT_URI_MAX_LENGTH,
  LOOPBACK_CLIENT_HOST,
  redirectUriHost,
  sharedRedirectHost,
  validateRedirectUris,
} from './client-redirects';
export type { RedirectUriProblem } from './client-redirects';
export { CLIENT_REFUSAL_WINDOW_MS, ClientRefusalRecorder } from './client-refusal.recorder';
export { ClientRegistrationService } from './client-registration.service';
export { ClientTrustPolicy, evaluateClientTrust, isHostAdmitted } from './client-trust.policy';
export type { TrustRefusalReason, TrustSettings, TrustSubject, TrustVerdict } from './client-trust.policy';
export { OAUTH_CLIENT_CLEANUP_TYPE, OAuthClientCleanupHandler } from './oauth-client-cleanup.handler';
export { OAuthClientCleanupTask } from './oauth-client-cleanup.task';
export { OAuthAdminHintsController, OAuthClientsAdminController } from './oauth-clients-admin.controller';
export { OAuthClientsAdminService } from './oauth-clients-admin.service';
