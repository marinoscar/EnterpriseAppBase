// `@marinoscar/platform-api/settings/testing`: the settings slice's conformance
// suite (issue #733). Importing this entry registers the `settings` suite with
// `runPlatformConformance` (@marinoscar/platform-api/testing). Never import it
// from production code. Documented in ../README.md.

export { checkNamespaceDeclarations, checkNoSecretFields, settingsConformanceSuite } from './conformance';
export type { SettingsConformanceOptions } from './conformance';
