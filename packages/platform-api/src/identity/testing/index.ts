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
  IdentityConformanceOptions,
  IdentityConformanceRlsOptions,
  IdentityConformanceRlsTable,
  IdentityRoute,
} from './conformance';
export { createStubIdentityHost } from './stub-host';
export type { StubIdentityHostOptions, StubIdentityHostState } from './stub-host';
