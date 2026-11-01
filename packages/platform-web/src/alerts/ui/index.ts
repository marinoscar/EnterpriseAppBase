// `@marinoscar/platform-web/alerts/ui`: the Alerts page (Rules and Incidents
// tabs), the rule editor, the dry-run result, the incident drawer, the firing
// banner for the telemetry dashboard and the admin card as data, built on
// `/alerts/headless` (issue #1047). Documented in ../README.md.

export { ALERTS_PAGE_COPY } from './copy.js';
export { alertsAdminCards } from './settings.js';
export type { AlertsAdminCard } from './settings.js';
export { AlertIncidentDrawer } from './AlertIncidentDrawer.js';
export type { AlertIncidentDrawerProps } from './AlertIncidentDrawer.js';
export { AlertRuleDialog } from './AlertRuleDialog.js';
export type { AlertRuleDialogProps } from './AlertRuleDialog.js';
export { AlertRuleTestResult } from './AlertRuleTestResult.js';
export type { AlertRuleTestResultProps } from './AlertRuleTestResult.js';
export { AlertsPage } from './AlertsPage.js';
export type { AlertsPageProps, AlertsPageSlots } from './AlertsPage.js';
export { FiringAlertsBanner } from './FiringAlertsBanner.js';
export type { FiringAlertsBannerProps } from './FiringAlertsBanner.js';
