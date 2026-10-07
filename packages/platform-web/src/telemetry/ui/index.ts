// `@marinoscar/platform-web/telemetry/ui`: the three telemetry route
// components and the admin registry cards (issue #704). For lazy routes,
// import a page from its own subpath (`./settings-page`, `./explorer-page`,
// `./dashboard-page`) so each stays in a chunk of its own. Documented in
// ../README.md.

export { telemetryAdminCards } from './admin.js';
export type { TelemetryAdminCard } from './admin.js';
export { default as TelemetrySettingsPage } from './pages/TelemetrySettingsPage.js';
export { default as TelemetryExplorerPage } from './pages/TelemetryExplorerPage.js';
export { default as TelemetryDashboardPage } from './pages/TelemetryDashboardPage.js';
