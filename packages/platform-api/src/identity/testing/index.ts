// `@marinoscar/platform-api/identity/testing`: the identity slice's test seams
// (issue #727): the test-only login an e2e suite signs in with, and the
// identity conformance suite (importing this entry registers it with
// `runPlatformConformance`). Never import it from production code; mount the
// login with `IdentityModule.forRoot({ enableTestAuth })`, which refuses it in
// production. Documented in ../README.md.

export { TestAuthModule } from './test-auth.module';
export { TestAuthService } from './test-auth.service';
export type { TestAuthTokenResponse } from './test-auth.service';
export { TestEnvironmentGuard } from './guards/test-environment.guard';

// The identity conformance suite: importing this entry registers the `identity`
// suite with `runPlatformConformance` (@marinoscar/platform-api/testing).
export {
  checkPermissionsRegistered,
  checkRls,
  checkRouteAccess,
  checkScopeGrants,
  checkTokenConfinement,
  discoverControllers,
  discoverIdentityRoutes,
  identityConformanceSuite,
} from './conformance';
export type {
  IdentityConformanceAccessEntry,
  IdentityConformanceGrant,
  IdentityConformanceGuardClass,
  IdentityConformanceOptions,
  IdentityConformanceRlsOptions,
  IdentityConformanceRlsTable,
  IdentityRoute,
} from './conformance';
// OAuth server helpers (PP-15.4): a PKCE pair and a client row with a known secret.
export { createOAuthTestClient, createOAuthTestPkce, exchangeOAuthCode, mintOAuthTestToken, pkcePair, runOAuthAuthorizationCodeFlow } from './oauth';
export type {
  MintOAuthTestTokenInput,
  MintedOAuthTestToken,
  OAuthCodeFlowInput,
  OAuthCodeFlowResult,
  OAuthTestApp,
  OAuthTestClient,
  OAuthTestClientDb,
  OAuthTestClientCreated,
  OAuthTestClientDelegate,
  OAuthTestClientOptions,
  OAuthTestPkcePair,
  OAuthTestTokenDb,
} from './oauth';
// The OAuth server conformance suite (PP-15.8): importing this entry registers `oauth-server`.
export {
  OAUTH_CONFORMANCE_CHECKS,
  checkChallengeOn401,
  checkMetadataShape,
  checkNoRolesOnlyAdmission,
  checkOAuthSecretEgress,
  checkOAuthTokenConfinement,
  checkResourcePrefixExclusive,
  checkResourceScopesRegistered,
  checkScopeNarrowing,
  checkScopePermissionsRegistered,
  checkSessionOnlyRoutes,
  defaultSessionOnlyHandlers,
  discoverOAuthRoutes,
  oauthServerConformanceSuite,
  parseBearerChallenge,
} from './oauth-server-conformance';
export type {
  OAuthConformanceCheck,
  OAuthConformanceJwtGuardClass,
  OAuthRoute,
  OAuthSecretEgressEvidence,
  OAuthServerConformanceOptions,
  OAuthSessionOnlyHandler,
} from './oauth-server-conformance';
export { createStubIdentityHost } from './stub-host';
export type { StubIdentityHost, StubIdentityHostOptions, StubIdentityHostState, StubIdentityNotification } from './stub-host';

// The sign-in provider conformance kit (PP-14.9).
export { describeAuthProviderConformance } from './auth-provider-conformance';
export type {
  AuthProviderConformanceHarness,
  AuthProviderConformanceHost,
  AuthProviderConformanceOptions,
  AuthProviderConformanceScenario,
} from './auth-provider-conformance';
