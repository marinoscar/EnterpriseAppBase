// `@marinoscar/platform-api/alerts/testing`: the `alerts` conformance suite,
// the in-memory fakes and a scripted rule kind for an app's own tests. Importing
// it registers the suite with `runPlatformConformance`.

export { alertsConformanceSuite, checkAlertsStatic, discoverAlertsRoutes } from './conformance';
export type { AlertsConformanceOptions, AlertsRoute } from './conformance';
export { createFakeContext, createFakeKind, createInMemoryAlertsPrisma } from './fakes';
export type { FakeKind, FakeKindScript, InMemoryAlertsPrisma } from './fakes';
