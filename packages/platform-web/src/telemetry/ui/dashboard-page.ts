// `@marinoscar/platform-web/telemetry/ui/dashboard-page`: the TelemetryDashboardPage
// route component alone (issue #704), as a default and a named export, so
// the app keeps `lazy(() => import('@marinoscar/platform-web/telemetry/ui/dashboard-page'))`
// and the page stays in a chunk of its own. Documented in ../README.md.

export { default, default as TelemetryDashboardPage } from './pages/TelemetryDashboardPage.js';
