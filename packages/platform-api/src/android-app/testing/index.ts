// `@marinoscar/platform-api/android-app/testing`: the android-app slice's
// conformance suite (issue #746). Importing this entry registers the
// `android-app` suite with `runPlatformConformance`
// (@marinoscar/platform-api/testing). Never import it from production code.
// Documented in ../README.md.

export { androidAppConformanceSuite, checkAndroidApp, discoverAndroidAppRoutes } from './conformance';
export type { AndroidAppConformanceOptions, AndroidAppRoute } from './conformance';
