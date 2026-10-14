// `@marinoscar/platform-api/credentials/testing`: the credentials slice's test
// seams (issue #735): the conformance suite (importing this entry registers it
// with `runPlatformConformance`) and a helper that declares purposes for one
// test. Never import it from production code. Documented in ../README.md.

export {
  PLATFORM_CREDENTIAL_OWNERS,
  checkCredentialAddresses,
  checkCredentialInfoSchemas,
  checkCredentialOwners,
  credentialsConformanceSuite,
} from './conformance';
export type { CredentialsConformanceOptions, CredentialsConformanceSchema } from './conformance';
export { withCredentialPurposes } from './with-credential-purposes';
export type { TemporaryCredentialPurposes } from './with-credential-purposes';
