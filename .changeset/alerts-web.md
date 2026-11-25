---
"@marinoscar/platform-web": minor
---

Add the alerts web slice (#1047): `@marinoscar/platform-web/alerts/headless` (`createAlertsApi`, `useAlertRules`, `useAlertRule`, `useAlertKinds`, `useAlertIncidents`, `useAlertIncident`, `useAlertSummary` polled every 30 seconds, `useAlertMetricCatalog`, `useAlertMutations`, the rule editor's draft model and alerts in words) and `@marinoscar/platform-web/alerts/ui` (`AlertsPage` with Rules and Incidents tabs, `AlertRuleDialog` with a form per built-in kind and a dry-run Test, `AlertRuleTestResult`, `AlertIncidentDrawer`, `FiringAlertsBanner` for the telemetry dashboard's `BeforeContent` slot, and the `alertsAdminCards` Observability card, `alerts:read`). Starter rules show "Built-in" and cannot be deleted from the UI.
