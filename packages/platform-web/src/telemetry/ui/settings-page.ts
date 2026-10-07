// `@marinoscar/platform-web/telemetry/ui/settings-page`: the TelemetrySettingsPage
// route component alone (issue #704), as a default and a named export, so
// the app keeps `lazy(() => import('@marinoscar/platform-web/telemetry/ui/settings-page'))`
// and the page stays in a chunk of its own. Documented in ../README.md.

export { default, default as TelemetrySettingsPage } from './pages/TelemetrySettingsPage.js';
