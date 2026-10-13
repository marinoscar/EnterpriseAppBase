// `@marinoscar/platform-infra/testing`: conformance checks an app runs over its
// own infra/ (overlays, nginx include points).
export { runInfraConformance } from './infra-conformance.js';
export type { InfraConformanceOptions, InfraConformanceTestApi, InfraExec } from './infra-conformance.js';
