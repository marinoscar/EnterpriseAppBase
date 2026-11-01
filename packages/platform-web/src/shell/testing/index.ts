// `@marinoscar/platform-web/shell/testing`: the shell slice's conformance
// suite. Importing this entry registers `shell-local-host` with
// `runPlatformWebConformance`. Test-only: never import it from production code.
// Needs `@testing-library/react`. Documented in ../README.md.

export { shellLocalHostSuite } from './shell-local-host.suite.js';
