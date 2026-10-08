// `@marinoscar/platform-cli/testing`: helpers for an app's CLI tests and the
// CLI's conformance suites (#715).
export {
  PLATFORM_DOCUMENTED_OPTIONAL_KEYS,
  TEST_CLI_IDENTITY,
  checkExecutorCredentialHygiene,
  commentedAssignments,
  composeEnvSpecs,
  resetCliForTests,
  runPlatformConformance,
  useTestCliIdentity,
} from '../engine/index.js';
export type {
  CliConformanceOptions,
  CliPlatformConformanceOptions,
  CliPlatformConformanceSuites,
  ConformanceMatchers,
  ConformanceTestApi,
  CredentialHygieneOptions,
  CredentialHygieneReport,
  EnvTemplateFragment,
} from '../engine/index.js';
