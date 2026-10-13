// `@marinoscar/platform-web/telemetry/ui/dashboard-panels` (PP-14.18): the
// dashboard-panel view registry alone, with none of the three pages. An app
// registers the views of the dashboard panels its API registered
// (`registerDashboardPanelView`) from a file its entry point loads at boot; a
// page chunk loaded later reads the same registry. Importing this entry pulls no
// page into the app's main chunk (the `ui` index would). Documented in ../README.md.

export {
  dashboardPanelViews,
  getDashboardPanelView,
  registerDashboardPanelView,
} from './components/dashboard/panels/dashboardPanelViews.js';
export type {
  DashboardPanelHost,
  DashboardPanelViewOptions,
  DashboardPanelViewProps,
  RegisteredDashboardPanelView,
} from './components/dashboard/panels/dashboardPanelViews.js';
export type { PanelAction } from './components/dashboard/DashboardPanel.js';
export type { DashboardLayout } from './components/dashboard/DashboardFilterBar.js';
