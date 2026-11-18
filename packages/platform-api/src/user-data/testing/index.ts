// `@marinoscar/platform-api/user-data/testing`: the user-data slice's test
// seams (issue #743): the conformance suite (importing this entry registers it
// with `runPlatformConformance`). Never import it from production code.
// Documented in ../README.md.

export { checkUserDataDecisions, checkUserDataHints, checkUserDataPlan, userDataConformanceSuite } from './conformance';
export type { UserDataConformanceOptions } from './conformance';
