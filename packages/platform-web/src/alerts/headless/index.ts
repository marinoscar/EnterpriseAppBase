// `@marinoscar/platform-web/alerts/headless`: the alerts client, hooks and pure
// helpers (issue #1047): rules, kinds, incidents, the firing summary, the
// metric catalog the rule editor picks from, the editor's draft model and
// alerts in words. No UI. Documented in ../README.md.

export {
  ALERTS_BASE_PATH,
  ALERTS_METRIC_CATALOG_PATH,
  createAlertsApi,
  metricCatalogFromSchema,
} from './client.js';
export type {
  AlertIncidentPage,
  AlertIncidentsQuery,
  AlertMetricCatalogEntry,
  AlertRulesQuery,
  AlertsApi,
} from './client.js';
export {
  ALERT_AGGREGATION_LABELS,
  ALERT_COMPARATOR_LABELS,
  ALERT_SEVERITY_LABELS,
  ALERT_SEVERITY_TONES,
  ALERT_STATE_LABELS,
  ALERT_STATE_TONES,
  alertFiringTotal,
  alertKindLabel,
  alertTopSeverity,
  formatAlertLabels,
  formatAlertSeconds,
} from './format.js';
export type { AlertTone } from './format.js';
export {
  alertErrorMessage,
  useAlertIncident,
  useAlertIncidents,
  useAlertKinds,
  useAlertMetricCatalog,
  useAlertMutations,
  useAlertRule,
  useAlertRules,
  useAlertSummary,
  useAlertsApi,
} from './hooks.js';
export type {
  AlertIncidentState,
  AlertIncidentsState,
  AlertKindsState,
  AlertMetricCatalogState,
  AlertMutations,
  AlertRuleState,
  AlertRulesState,
  AlertSummaryState,
} from './hooks.js';
export {
  ALERT_FORM_KINDS,
  alertKindHasNoConfig,
  alertRuleDraftFromRule,
  buildAlertRuleConfig,
  buildAlertRulePayload,
  emptyAlertRuleDraft,
} from './rule-draft.js';
export type {
  AlertAttrDraft,
  AlertRuleDraft,
  AlertRulePayloadResult,
  MetricThresholdDraft,
  NodeEventDraft,
} from './rule-draft.js';
