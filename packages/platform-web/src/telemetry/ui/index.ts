// `@marinoscar/platform-web/telemetry/ui`: the three telemetry route
// components and the admin registry cards (issue #704). For lazy routes,
// import a page from its own subpath (`./settings-page`, `./explorer-page`,
// `./dashboard-page`) so each stays in a chunk of its own. Documented in
// ../README.md.

export { telemetryAdminCards } from './admin.js';
export type { TelemetryAdminCard } from './admin.js';
export { default as TelemetrySettingsPage } from './pages/TelemetrySettingsPage.js';
export type { TelemetrySettingsPageProps, TelemetrySettingsPageSlots } from './pages/TelemetrySettingsPage.js';
export { default as TelemetryExplorerPage } from './pages/TelemetryExplorerPage.js';
export type { TelemetryExplorerPageProps, TelemetryExplorerPageSlots } from './pages/TelemetryExplorerPage.js';
export { default as TelemetryDashboardPage } from './pages/TelemetryDashboardPage.js';
export type { TelemetryDashboardPageProps, TelemetryDashboardPageSlots } from './pages/TelemetryDashboardPage.js';
// The dashboard-panel view registry (PP-14.18). An app that wants it without the pages
// imports `./dashboard-panels` instead.
export { dashboardPanelViews, getDashboardPanelView, registerDashboardPanelView } from './components/dashboard/panels/dashboardPanelViews.js';
export type {
  DashboardPanelHost,
  DashboardPanelViewOptions,
  DashboardPanelViewProps,
  RegisteredDashboardPanelView,
} from './components/dashboard/panels/dashboardPanelViews.js';
