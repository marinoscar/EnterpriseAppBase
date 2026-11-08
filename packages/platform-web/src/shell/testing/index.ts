// `@marinoscar/platform-web/shell/testing`: the shell slice's conformance
// suites. Importing this entry registers `shell-local-host` and
// `shell-layout-variants` with
// `runPlatformWebConformance`. Test-only: never import it from production code.
// Needs `@testing-library/react`. Documented in ../README.md.

export { shellLocalHostSuite } from './shell-local-host.suite.js';
export { shellLayoutVariantsSuite } from './shell-layout-variants.suite.js';
